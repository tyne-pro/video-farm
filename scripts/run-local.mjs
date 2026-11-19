// Прогон пайплайна без UI: node scripts/run-local.mjs <голова> <планшет|-> <формат> "<название>" [модель] [--no-claude]
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { runPipeline, ROOT } from '../lib/pipeline.mjs'

const [head, tablet, format = 'vertical', title = '3 ошибки новичков', model = 'small'] = process.argv.slice(2)
const id = `cli-${Date.now()}`
const dir = path.join(ROOT, 'work', id)
fs.mkdirSync(dir, { recursive: true })
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/root\//, '')))
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end() }
  const st = fs.statSync(f)
  const r = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
  if (r) {
    const s = Number(r[1]); const e = r[2] ? Number(r[2]) : st.size - 1
    res.writeHead(206, { 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' })
    fs.createReadStream(f, { start: s, end: e }).pipe(res)
  } else {
    res.writeHead(200, { 'Content-Length': st.size, 'Accept-Ranges': 'bytes' })
    fs.createReadStream(f).pipe(res)
  }
}).listen(4748, '127.0.0.1')
const job = {
  id, dir,
  files: { head: path.resolve(head), ...(tablet && tablet !== '-' ? { tablet: path.resolve(tablet) } : {}) },
  options: { title, format, whisperModel: model, useClaude: !process.argv.includes('--no-claude') },
  log: (m) => console.log(m),
}
const t0 = Date.now()
try {
  await runPipeline(job, {
    assetUrl: (abs) => `http://127.0.0.1:4748/root/${path.relative(ROOT, abs).split(path.sep).map(encodeURIComponent).join('/')}`,
  })
  console.log(`Время: ${((Date.now() - t0) / 1000).toFixed(0)} с`)
} finally {
  srv.close()
}
