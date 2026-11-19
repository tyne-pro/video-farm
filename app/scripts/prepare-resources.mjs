// Puts everything the app carries next to the Tauri project before a build:
//   src-tauri/binaries/node-<target>, ffmpeg-<target>, ffprobe-<target>  (Tauri "externalBin")
//   src-tauri/resources/generator/   the generator from frontend/farm-generator with its production packages
//   src-tauri/resources/NOTICE.txt   licences of the bundled programs
// Usage: node scripts/prepare-resources.mjs [target-triple]   (default: the host, from rustc -vV)
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(app, '..')
const tauri = join(app, 'src-tauri')
const NODE_VERSION = '22.12.0'

const target = process.argv[2] || execFileSync('rustc', ['-vV']).toString().match(/host: (\S+)/)[1]
const os = target.includes('apple') ? 'mac' : target.includes('windows') ? 'win' : 'linux'
const arm = target.startsWith('aarch64')
const ext = os === 'win' ? '.exe' : ''
console.log(`[resources] target ${target}`)

const tmp = mkdtempSync(join(tmpdir(), 'farm-res-'))
const bins = join(tauri, 'binaries')
mkdirSync(bins, { recursive: true })

async function download(url, file) {
  console.log(`[resources] ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return file
}
const untar = (file, dir) => { mkdirSync(dir, { recursive: true }); execFileSync('tar', ['-xf', file, '-C', dir]) }
function find(dir, name) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) { const hit = find(p, name); if (hit) return hit } else if (entry === name) return p
  }
  return null
}
function place(src, name) {
  const out = join(bins, `${name}-${target}${ext}`)
  cpSync(src, out)
  if (os !== 'win') chmodSync(out, 0o755)
  console.log(`[resources] ${out}`)
}

// 1. Node.js (official build)
{
  const arch = arm ? 'arm64' : 'x64'
  const plat = os === 'mac' ? 'darwin' : os === 'win' ? 'win' : 'linux'
  const name = `node-v${NODE_VERSION}-${plat}-${arch}`
  const file = await download(`https://nodejs.org/dist/v${NODE_VERSION}/${name}.${os === 'win' ? 'zip' : 'tar.xz'}`, join(tmp, `node.${os === 'win' ? 'zip' : 'tar.xz'}`))
  untar(file, join(tmp, 'node'))
  place(find(join(tmp, 'node'), `node${ext}`), 'node')
}

// 2. ffmpeg and ffprobe: static builds listed on ffmpeg.org (macOS: Martin Riedl, Windows/Linux: BtbN)
if (os === 'mac') {
  const arch = arm ? 'arm64' : 'amd64'
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const file = await download(`https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch}/release/${tool}.zip`, join(tmp, `${tool}.zip`))
    untar(file, join(tmp, tool))
    place(find(join(tmp, tool), tool), tool)
  }
} else {
  const plat = os === 'win' ? (arm ? 'winarm64' : 'win64') : (arm ? 'linuxarm64' : 'linux64')
  const archive = `ffmpeg-n7.1-latest-${plat}-gpl-7.1.${os === 'win' ? 'zip' : 'tar.xz'}`
  const file = await download(`https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${archive}`, join(tmp, archive))
  untar(file, join(tmp, 'ffmpeg'))
  for (const tool of ['ffmpeg', 'ffprobe']) place(find(join(tmp, 'ffmpeg'), `${tool}${ext}`), tool)
}

// 3. The generator with its production packages (installed for this platform)
{
  // In this repository the generator is frontend/farm-generator; in the public tyne-pro/video-farm copy it is the repository root
  const src = process.env.FARM_GENERATOR_DIR ? join(app, process.env.FARM_GENERATOR_DIR) : join(repo, 'frontend', 'farm-generator')
  const out = join(tauri, 'resources', 'generator')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const item of ['package.json', 'package-lock.json', 'server.mjs', 'lib', 'remotion', 'ui', 'scripts']) cpSync(join(src, item), join(out, item), { recursive: true })
  // «Мої ролики» и редактор: страница самой программы (127.0.0.1:4747/studio), собирается здесь
  {
    const studio = join(src, 'studio')
    const npmS = os === 'win' && process.platform === 'win32' ? 'npm.cmd' : 'npm'
    execFileSync(npmS, ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: studio, stdio: 'inherit', shell: process.platform === 'win32' })
    execFileSync(npmS, ['run', 'build'], { cwd: studio, stdio: 'inherit', shell: process.platform === 'win32' })
    cpSync(join(studio, 'dist'), join(out, 'studio', 'dist'), { recursive: true })
  }
  const npm = os === 'win' && process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execFileSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: out, stdio: 'inherit', shell: process.platform === 'win32' })
  // Caches that npm or a local run could leave behind
  for (const junk of ['node_modules/.cache', 'node_modules/.remotion']) rmSync(join(out, junk), { recursive: true, force: true })
}

// 4. Licences of what the app carries
writeFileSync(join(tauri, 'resources', 'NOTICE.txt'), `Ферма роликів · tyne.pro
© tyne.pro. The app and the generator code: https://github.com/tyne-pro/video-farm

The app includes these programs, each under its own licence:

Node.js ${NODE_VERSION} — MIT licence. https://nodejs.org
FFmpeg (ffmpeg, ffprobe) — GPL licence, unmodified static builds listed on https://ffmpeg.org/download.html
  (macOS: https://ffmpeg.martin-riedl.de, Windows and Linux: https://github.com/BtbN/FFmpeg-Builds).
  The source code of FFmpeg is available at https://ffmpeg.org and from those build pages.
Remotion — Remotion licence. Free for individuals and companies of up to 3 people; larger companies need a
  company licence: https://remotion.dev/license
whisper.cpp (downloaded on first run) — MIT licence. https://github.com/ggml-org/whisper.cpp
Chrome Headless Shell (downloaded on first run) — https://developer.chrome.com
`)

rmSync(tmp, { recursive: true, force: true })
console.log('[resources] ready')
