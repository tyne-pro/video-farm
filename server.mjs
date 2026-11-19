// ============================================================================
// Локальный генератор фермы роликов: http://127.0.0.1:4747
// Принимает голову + планшет, монтирует по правилам и отдаёт готовый MP4.
// Страница портала cp.tyne.pro/farm ходит сюда же (CORS + Private Network).
// ============================================================================

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { runPipeline, renderJob, ROOT, DATA } from './lib/pipeline.mjs'
import { applyEdits } from './lib/plan.mjs'
import { loadMemes } from './lib/memes.mjs'
import { PORTAL } from './lib/memes.mjs'

const PORT = Number(process.env.FARM_PORT || 4747)
const HOST = '127.0.0.1'
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const WORK = path.join(DATA, 'work')
// Исходники и промежуточные файлы ролика живут на этом компьютере не дольше суток после последней правки;
// готовые ролики остаются в папке «Готово»
const KEEP_MS = 24 * 60 * 60 * 1000
function cleanWork() {
  try {
    for (const name of fs.readdirSync(WORK)) {
      const dir = path.join(WORK, name)
      const st = fs.statSync(dir)
      if (st.isDirectory() && Date.now() - st.mtimeMs > KEEP_MS) fs.rmSync(dir, { recursive: true, force: true })
    }
  } catch { /* папки ещё нет */ }
}
cleanWork()
setInterval(cleanWork, 60 * 60 * 1000).unref()
const ALLOWED_ORIGINS = new Set([
  PORTAL, 'https://cp.tyne.pro', 'http://localhost:3000', `http://${HOST}:${PORT}`, `http://localhost:${PORT}`,
])
const FORMATS = new Set(['vertical', 'horizontal', 'talking'])
const MODELS = new Set(['small', 'medium', 'large-v3'])

fs.mkdirSync(WORK, { recursive: true })

// --- Задачи ------------------------------------------------------------------

const jobs = new Map()
const queue = []
let running = false

function publicJob(j) {
  return {
    id: j.id, state: j.state, step: j.step, progress: j.progress, error: j.error,
    title: j.options?.title, format: j.options?.format, createdAt: j.createdAt,
    log: j.logs.slice(-40), result: j.result ? path.basename(j.result) : null, draft: !!j.isDraft,
    hasPlan: fs.existsSync(path.join(j.dir, 'plan.json')),
    uploaded: Object.keys(j.files),
  }
}

function newJob() {
  const id = crypto.randomBytes(6).toString('hex')
  const dir = path.join(WORK, id)
  fs.mkdirSync(dir, { recursive: true })
  const job = {
    id, dir, files: {}, options: null, state: 'uploading', step: null, progress: 0,
    createdAt: Date.now(), logs: [], result: null, error: null,
    log(msg) { job.logs.push(`${new Date().toLocaleTimeString('ru-RU')} ${msg}`); console.log(`[${id}] ${msg}`) },
  }
  jobs.set(id, job)
  return job
}

function assetUrl(abs) {
  const rel = path.relative(DATA, abs).split(path.sep).map(encodeURIComponent).join('/')
  return `http://${HOST}:${PORT}/root/${rel}`
}

async function pump() {
  if (running) return
  const job = queue.shift()
  if (!job) return
  running = true
  job.state = 'running'
  try {
    if (job.rerender) await renderJob(job, { plan: job.rerender, assetUrl, draft: job.rerenderDraft })
    else await runPipeline(job, { assetUrl })
    job.state = 'done'
    job.progress = 1
  } catch (e) {
    job.state = 'error'
    job.error = e.message
    job.log(`Ошибка: ${e.message}`)
    console.error(e)
  } finally {
    job.rerender = null
    running = false
    pump()
  }
}

// --- HTTP ----------------------------------------------------------------------

function cors(req, res) {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    // Chrome Private Network Access: публичный сайт → localhost
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
  }
  return !origin || ALLOWED_ORIGINS.has(origin)
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function readJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 5_000_000) throw new Error('слишком большой запрос')
  }
  return body ? JSON.parse(body) : {}
}

const MIME = {
  '.mp4': 'video/mp4', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.webm': 'video/webm',
  '.json': 'application/json', '.html': 'text/html; charset=utf-8',
}

function sendFile(req, res, file, { download } = {}) {
  if (!fs.existsSync(file)) return json(res, 404, { error: 'нет файла' })
  const stat = fs.statSync(file)
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes' }
  if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
  if (range) {
    const start = range[1] ? Number(range[1]) : stat.size - Number(range[2])
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 })
    fs.createReadStream(file, { start, end }).pipe(res)
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size })
    fs.createReadStream(file).pipe(res)
  }
}

let claudeOk = null
function checkClaude() {
  return new Promise((resolve) => {
    const p = spawn('claude', ['--version'], { shell: process.platform === 'win32', windowsHide: true })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => resolve(false))
    p.on('close', (code) => resolve(code === 0 ? out.trim() || true : false))
  })
}

const server = http.createServer(async (req, res) => {
  try {
    if (!cors(req, res)) return json(res, 403, { error: 'чужой сайт' })
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    const url = new URL(req.url, `http://${HOST}`)
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

    if (req.method === 'GET' && url.pathname === '/') {
      return sendFile(req, res, path.join(ROOT, 'ui', 'index.html'))
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      if (claudeOk === null) claudeOk = await checkClaude()
      return json(res, 200, { ok: true, version: VERSION, claude: claudeOk, busy: running, queue: queue.length })
    }

    // Файлы генератора для рендера (только внутри его папки)
    if (req.method === 'GET' && parts[0] === 'root') {
      const file = path.resolve(DATA, ...parts.slice(1))
      const allowed = ['.cache', 'work', 'music', 'assets'].some((d) => file.startsWith(path.join(DATA, d) + path.sep))
      if (!allowed) return json(res, 403, { error: 'нельзя' })
      return sendFile(req, res, file)
    }

    if (parts[0] !== 'api' || parts[1] !== 'jobs') return json(res, 404, { error: 'не найдено' })

    if (req.method === 'GET' && parts.length === 2) {
      return json(res, 200, { jobs: [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map(publicJob) })
    }
    if (req.method === 'POST' && parts.length === 2) {
      return json(res, 200, publicJob(newJob()))
    }

    const job = jobs.get(parts[2])
    if (!job) return json(res, 404, { error: 'задача не найдена' })

    // PUT /api/jobs/:id/upload/head|tablet — сырое тело файла
    if (req.method === 'PUT' && parts[3] === 'upload' && ['head', 'tablet'].includes(parts[4])) {
      if (job.state !== 'uploading') return json(res, 409, { error: 'задача уже запущена' })
      const name = String(url.searchParams.get('name') || parts[4])
      const ext = (path.extname(name) || '.mp4').toLowerCase().replace(/[^.\w]/g, '')
      const file = path.join(job.dir, `src-${parts[4]}${ext}`)
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(file)
        req.pipe(ws)
        ws.on('finish', resolve)
        ws.on('error', reject)
        req.on('error', reject)
      })
      job.files[parts[4]] = file
      job.log(`Загружен файл (${parts[4]}): ${name}, ${(fs.statSync(file).size / 1e6).toFixed(1)} МБ`)
      return json(res, 200, publicJob(job))
    }

    if (req.method === 'POST' && parts[3] === 'start') {
      if (job.state !== 'uploading') return json(res, 409, { error: 'задача уже запущена' })
      const body = await readJson(req)
      const format = FORMATS.has(body.format) ? body.format : 'vertical'
      const title = String(body.title || '').trim().slice(0, 200)
      if (!title) return json(res, 400, { error: 'Нужно название видео' })
      if (!job.files.head) return json(res, 400, { error: 'Нужна запись головы' })
      if (format !== 'talking' && !job.files.tablet) return json(res, 400, { error: 'Нужна запись планшета' })
      job.options = {
        title,
        format,
        emoji: String(body.emoji || '🍓').slice(0, 8),
        whisperModel: MODELS.has(body.whisperModel) ? body.whisperModel : 'medium',
        useClaude: body.useClaude !== false,
        // Свои стикерпаки Telegram: ссылка t.me/addstickers/<имя> или имя, до 5 паков
        adultMemes: body.adultMemes === true,
        stickerPacks: (Array.isArray(body.stickerPacks) ? body.stickerPacks : []).map((s) => String(s).trim().replace(/^.*addstickers\//, '').replace(/[/?#].*$/, '')).filter((s) => /^[A-Za-z0-9_]{3,64}$/.test(s)).slice(0, 5),
        notes: String(body.notes || '').trim().slice(0, 1500),
        memeDensity: ['rare', 'normal', 'often'].includes(body.memeDensity) ? body.memeDensity : 'normal',
        memeMood: ['smart', 'mix', 'absurd'].includes(body.memeMood) ? body.memeMood : 'mix',
        zooms: body.zooms !== false,
        musicVolume: [0, 0.03, 0.05].includes(Number(body.musicVolume)) ? Number(body.musicVolume) : 0.03,
        draft: body.draft === true,
      }
      job.state = 'queued'
      queue.push(job)
      pump()
      return json(res, 200, publicJob(job))
    }

    if (req.method === 'GET' && parts.length === 3) return json(res, 200, publicJob(job))

    if (req.method === 'GET' && parts[3] === 'result') {
      if (!job.result) return json(res, 404, { error: 'ещё не готово' })
      return sendFile(req, res, job.result, { download: url.searchParams.get('inline') !== '1' })
    }

    if (req.method === 'GET' && parts[3] === 'plan') {
      return sendFile(req, res, path.join(job.dir, 'plan.json'))
    }

    // Правка плана (текст субтитров, мемы) и быстрый перерендер
    if (req.method === 'POST' && parts[3] === 'rerender') {
      if (!['done', 'error'].includes(job.state) || !fs.existsSync(path.join(job.dir, 'plan.json'))) {
        return json(res, 409, { error: 'перерендер доступен после первого рендера' })
      }
      const body = await readJson(req)
      let plan = body.plan || JSON.parse(fs.readFileSync(path.join(job.dir, 'plan.json'), 'utf8'))
      if (body.edits) {
        const catalog = await loadMemes(path.join(DATA, '.cache'), job.log, { packs: job.options?.stickerPacks, adult: job.options?.adultMemes })
        plan = applyEdits(plan, body.edits, {
          memeIds: new Set(catalog.map((m) => m.id)),
        })
      }
      job.rerenderDraft = body.draft === true
      job.log(body.draft ? 'Перерендер черновика по правленому плану' : 'Финальный рендер по плану')
      fs.writeFileSync(path.join(job.dir, 'plan.json'), JSON.stringify(plan, null, 1))
      job.rerender = plan
      job.state = 'queued'
      job.error = null
      queue.push(job)
      pump()
      return json(res, 200, publicJob(job))
    }

    return json(res, 404, { error: 'не найдено' })
  } catch (e) {
    console.error(e)
    if (!res.headersSent) json(res, 500, { error: e.message })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`\nФерма роликів tyne.pro запущен: http://${HOST}:${PORT}`)
  console.log(`Готовые ролики: ${path.join(DATA, 'Готово')}`)
  console.log('Окно не закрывай, пока идёт монтаж.\n')
  if (process.argv.includes('--open')) {
    const url = `http://${HOST}:${PORT}`
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref()
  }
})
