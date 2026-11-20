// Самопроверка установленной программы (без кабинета и без интернета для монтажа):
// звуки, движок сборки, распознавание речи и короткий ролик 1080×1920 из живого фона с текстом.
// Запуск: node scripts/selftest.mjs  (FARM_DATA — папка данных). Итог: selftest.json в папке данных.
import fs from 'node:fs'
import path from 'node:path'
import { ensureBrowser } from '@remotion/renderer'
import { ensureSfx, probe, ffmpeg } from '../lib/media.mjs'
import { ensureWhisper, transcribeWords } from '../lib/transcribe.mjs'
import { renderProject, DATA, CACHE } from '../lib/pipeline.mjs'
import { storeProject } from '../lib/projects.mjs'

const report = { started: new Date().toISOString(), platform: process.platform, arch: process.arch, steps: {} }
const step = async (name, fn) => {
  const t0 = Date.now()
  try { const r = await fn(); report.steps[name] = { ok: true, sec: Math.round((Date.now() - t0) / 100) / 10, ...(r || {}) } } catch (e) {
    report.steps[name] = { ok: false, sec: Math.round((Date.now() - t0) / 100) / 10, error: String(e?.stack || e).slice(0, 2000) }
  }
  console.log(name, report.steps[name].ok ? 'ok' : 'FAIL', report.steps[name].sec + 's')
}

await step('sfx', () => ensureSfx(path.join(CACHE, 'sfx')))
await step('render-engine', () => ensureBrowser())
await step('speech', async () => {
  // Маленькая модель хватает, чтобы проверить, что распознавание запускается на этой системе
  await ensureWhisper(CACHE, 'tiny')
  const dir = path.join(DATA, 'work', 'selftest')
  fs.mkdirSync(dir, { recursive: true })
  const wav = path.join(dir, 'tone.wav')
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '16000', '-ac', '1', wav])
  const words = await transcribeWords({ audioFile: wav, workDir: dir, cacheDir: CACHE, model: 'tiny', language: 'en', onProgress() {}, log() {} })
  return { words: words.length }
})
await step('clip', async () => {
  const id = 'abcdef123456'
  const dir = path.join(DATA, '.projects', id)
  fs.mkdirSync(dir, { recursive: true })
  const word = (text, s, e, accent = false) => ({ text, start: s, end: e, accent })
  const project = {
    v: 1, id, title: 'Selftest', mode: 'script', lang: 'en', createdAt: Date.now(), updatedAt: Date.now(),
    limits: { watermark: false, music: false, fonts: false, ownStickers: false, maxSec: 60 }, maxSec: 60, landscape: false, captionColor: '#FFFFFF', emoji: '',
    plan: {
      hook: { words: ['SELF', 'TEST'], chunks: [['SELF'], ['TEST']], chunkDur: 0.4, end: 1.2 },
      captions: [{ start: 1.3, end: 3.8, style: 'block', pos: 'center', words: [word('The', 1.3, 1.8), word('farm', 1.8, 2.4, true), word('works', 2.4, 3.8)] }],
      headings: [], memes: [], zooms: [], sfx: [], palette: 'ocean', title: 'Selftest',
    },
    clips: [{ id: 'a', kind: 'bg', src: null, srcIn: 0, base: 0, dur: 2, bg: 0 }, { id: 'b', kind: 'bg', src: null, srcIn: 0, base: 2, dur: 2, bg: 1 }],
    voice: null, music: null, original: null, outputs: [], credits: [], stickers: { packs: [], adult: false },
  }
  storeProject(DATA, project)
  const job = { id: 'selftest', dir, options: { lang: 'en', title: 'Selftest' }, say() {}, log() {}, tier: 'pro' }
  const out = await renderProject(job, project, { assetUrl: (abs) => 'file://' + abs.split(path.sep).join('/'), draft: false })
  const p = await probe(out)
  if (p.width !== 1080 || p.height !== 1920 || p.duration < 3.5) throw new Error(`unexpected clip ${p.width}x${p.height} ${p.duration}s`)
  fs.rmSync(dir, { recursive: true, force: true })
  return { file: path.basename(out), width: p.width, height: p.height, duration: Math.round(p.duration * 10) / 10 }
})

report.ok = Object.values(report.steps).every((s) => s.ok)
report.finished = new Date().toISOString()
fs.writeFileSync(path.join(DATA, 'selftest.json'), JSON.stringify(report, null, 2))
console.log(report.ok ? 'SELFTEST OK' : 'SELFTEST FAILED')
process.exit(report.ok ? 0 : 1)
