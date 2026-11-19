// ============================================================================
// Локальный генератор фермы роликів: http://127.0.0.1:4747
// Принимает видео, кліпи или картинки, монтирует на этом компьютере и отдаёт MP4.
// Страница кабинета cp.tyne.pro/tools/farm ходит сюда (CORS + Private Network);
// окно программы читает /api/status. Видео никуда не отправляются.
// ============================================================================

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { runPipeline, renderJob, ROOT, DATA } from './lib/pipeline.mjs'
import { applyEdits } from './lib/plan.mjs'
import { loadMemes } from './lib/memes.mjs'
import { PORTAL, savedKey, portalMe, portalRefund } from './lib/portal.mjs'
import { t } from './lib/i18n.mjs'

const PORT = Number(process.env.FARM_PORT || 4747)
const HOST = '127.0.0.1'
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const WORK = path.join(DATA, 'work')
const MODES = new Set(['cut', 'clips', 'script'])
const LANGS = new Set(['uk', 'ru', 'en'])
const MAX_ITEMS = 20

// Исходники и промежуточные файлы живут не дольше суток после последней правки; ролики остаются в «Готово»
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
fs.mkdirSync(WORK, { recursive: true })
cleanWork()
setInterval(cleanWork, 60 * 60 * 1000).unref()

const ALLOWED_ORIGINS = new Set([PORTAL, 'https://cp.tyne.pro', 'http://localhost:3000', 'http://localhost:3313', `http://${HOST}:${PORT}`, `http://localhost:${PORT}`])

// --- Задачи ------------------------------------------------------------------

const jobs = new Map()
const queue = []
let running = false
const appLog = []
let meCache = null
const stampNow = () => new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
const note = (line) => { line = `${stampNow()} ${line}`; appLog.push(line); if (appLog.length > 200) appLog.shift(); console.log(line) }

function publicJob(j) {
  return {
    id: j.id, state: j.state, step: j.step, progress: j.progress, error: j.error, code: j.code || null,
    title: j.options?.title, mode: j.options?.mode, createdAt: j.createdAt,
    tier: j.run?.tier || null, left: j.run?.left ?? null,
    log: j.logs.slice(-40), result: j.result ? path.basename(j.result) : null, draft: !!j.isDraft,
    hasPlan: fs.existsSync(path.join(j.dir, 'plan.json')),
    uploaded: (j.files.video ? 1 : 0) + j.files.items.length,
  }
}

function newJob() {
  const id = crypto.randomBytes(6).toString('hex')
  const dir = path.join(WORK, id)
  fs.mkdirSync(dir, { recursive: true })
  const job = {
    id, dir, files: { items: [] }, options: null, state: 'uploading', step: null, progress: 0,
    createdAt: Date.now(), logs: [], result: null, error: null,
    log(msg) {
      job.logs.push(`${stampNow()} ${msg}`)
      note(`${job.options?.title ? `«${job.options.title.slice(0, 40)}» ` : ''}${msg}`)
    },
    say(key, vars) { job.log(t(job.options?.lang, key, vars)) },
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
    if (job.rerender) { job.say('rerender'); await renderJob(job, { plan: job.rerender, assetUrl, draft: job.rerenderDraft }) }
    else await runPipeline(job, { assetUrl })
    job.state = 'done'
    job.progress = 1
  } catch (e) {
    job.state = 'error'
    // Технические подробности — только в консоль разработчика; пользователю — понятная фраза
    const known = ['auth', 'limit', 'busy', 'offline', 'needVideo', 'needItems', 'needTopic'].find((c) => e.message === t(job.options?.lang, c))
    job.code = known || 'error'
    job.error = known ? e.message : t(job.options?.lang, 'error', { msg: String(e.message || '').split('\n')[0].slice(0, 160) })
    job.log(job.error)
    if (!known) console.error(e)
    // Сорвавшийся ролик возвращаем в лимит (кроме ошибок самого ключа и лимита)
    if (job.run?.runId && !job.rerender) { await portalRefund(job.options?.k, job.run.runId); job.run.left += 1; meCache = null }
  } finally {
    job.rerender = null
    meCache = null
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
    if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true')
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
    if (body.length > 5_000_000) throw new Error('too big')
  }
  return body ? JSON.parse(body) : {}
}

const MIME = {
  '.mp4': 'video/mp4', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.webm': 'video/webm', '.json': 'application/json',
  '.html': 'text/html; charset=utf-8', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
}

function sendFile(req, res, file, { download } = {}) {
  if (!fs.existsSync(file)) return json(res, 404, { error: 'no file' })
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

const cleanName = (name) => String(name || 'file').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80)

const server = http.createServer(async (req, res) => {
  try {
    if (!cors(req, res)) return json(res, 403, { error: 'origin' })
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    const url = new URL(req.url, `http://${HOST}`)
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

    if (req.method === 'GET' && url.pathname === '/') return sendFile(req, res, path.join(ROOT, 'ui', 'index.html'))

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, version: VERSION, busy: running, queue: queue.length, connected: !!savedKey() })
    }

    // Для окна программы: тариф по ключу, понятный журнал
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const key = savedKey()
      if (!meCache || meCache.key !== key || Date.now() - meCache.at > (running ? 15_000 : 60_000)) meCache = { key, at: Date.now(), me: await portalMe(key) }
      const me = meCache.me
      return json(res, 200, { ok: true, version: VERSION, busy: running, connected: !!me, me, log: appLog.slice(-60) })
    }

    // Файлы для рендера (только внутри папки данных)
    if (req.method === 'GET' && parts[0] === 'root') {
      const file = path.resolve(DATA, ...parts.slice(1))
      const allowed = ['.cache', 'work', 'music', 'assets', 'fonts', 'stickers'].some((d) => file.startsWith(path.join(DATA, d) + path.sep))
      if (!allowed) return json(res, 403, { error: 'forbidden' })
      return sendFile(req, res, file)
    }

    if (parts[0] !== 'api' || parts[1] !== 'jobs') return json(res, 404, { error: 'not found' })

    if (req.method === 'GET' && parts.length === 2) {
      return json(res, 200, { jobs: [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map(publicJob) })
    }
    if (req.method === 'POST' && parts.length === 2) return json(res, 200, publicJob(newJob()))

    const job = jobs.get(parts[2])
    if (!job) return json(res, 404, { error: 'no job' })

    // PUT /api/jobs/:id/upload/video|item — сырое тело файла; item можно несколько раз (порядок сохраняется)
    if (req.method === 'PUT' && parts[3] === 'upload' && ['video', 'item'].includes(parts[4])) {
      if (job.state !== 'uploading') return json(res, 409, { error: 'started' })
      if (parts[4] === 'item' && job.files.items.length >= MAX_ITEMS) return json(res, 400, { error: 'too many files' })
      const name = cleanName(url.searchParams.get('name'))
      const ext = (path.extname(name) || '.mp4').toLowerCase()
      const file = path.join(job.dir, parts[4] === 'video' ? `src-video${ext}` : `src-item-${String(job.files.items.length).padStart(2, '0')}${ext}`)
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(file)
        req.pipe(ws)
        ws.on('finish', resolve)
        ws.on('error', reject)
        req.on('error', reject)
      })
      if (parts[4] === 'video') job.files.video = file
      else job.files.items.push(file)
      return json(res, 200, publicJob(job))
    }

    if (req.method === 'POST' && parts[3] === 'start') {
      if (job.state !== 'uploading') return json(res, 409, { error: 'started' })
      const body = await readJson(req)
      const lang = LANGS.has(body.lang) ? body.lang : 'uk'
      job.options = {
        mode: MODES.has(body.mode) ? body.mode : 'cut',
        lang,
        k: String(body.k || savedKey() || '').replace(/[^\w.-]/g, '').slice(0, 120),
        title: String(body.title || '').trim().slice(0, 200),
        hook: String(body.hook || '').trim().split(/\s+/).slice(0, 10).join(' ').slice(0, 120),
        notes: String(body.notes || '').trim().slice(0, 1500),
        emoji: String(body.emoji || '').slice(0, 8),
        // Свои стикерпаки Telegram: ссылка t.me/addstickers/<имя> или имя, до 5 паков (Premium и Pro)
        adultMemes: body.adultMemes === true,
        stickerPacks: (Array.isArray(body.stickerPacks) ? body.stickerPacks : []).map((s) => String(s).trim().replace(/^.*addstickers\//, '').replace(/[/?#].*$/, '')).filter((s) => /^[A-Za-z0-9_]{3,64}$/.test(s)).slice(0, 5),
        memeDensity: ['rare', 'normal', 'often'].includes(body.memeDensity) ? body.memeDensity : 'normal',
        memeMood: ['smart', 'mix', 'absurd'].includes(body.memeMood) ? body.memeMood : 'mix',
        zooms: body.zooms !== false,
        draft: body.draft === true,
      }
      job.state = 'queued'
      job.say('files', { n: (job.files.video ? 1 : 0) + job.files.items.length })
      queue.push(job)
      pump()
      return json(res, 200, publicJob(job))
    }

    if (req.method === 'GET' && parts.length === 3) return json(res, 200, publicJob(job))

    if (req.method === 'GET' && parts[3] === 'result') {
      if (!job.result) return json(res, 404, { error: 'not ready' })
      return sendFile(req, res, job.result, { download: url.searchParams.get('inline') !== '1' })
    }

    if (req.method === 'GET' && parts[3] === 'plan') return sendFile(req, res, path.join(job.dir, 'plan.json'))

    // Правка плана (хук, тексты, стикеры, заголовки) и быстрый перерендер без нового распознавания
    if (req.method === 'POST' && parts[3] === 'rerender') {
      if (!['done', 'error'].includes(job.state) || !fs.existsSync(path.join(job.dir, 'plan.json'))) return json(res, 409, { error: 'no plan' })
      const body = await readJson(req)
      let plan = JSON.parse(fs.readFileSync(path.join(job.dir, 'plan.json'), 'utf8'))
      if (body.edits) {
        const own = plan.limits?.ownStickers
        const catalog = await loadMemes(path.join(DATA, '.cache'), null, { packs: own ? job.options?.stickerPacks : [], adult: own && job.options?.adultMemes, k: job.options?.k, localDir: own ? path.join(DATA, 'stickers') : null })
        plan = { ...applyEdits(plan, body.edits, { memeIds: new Set(catalog.map((m) => m.id)) }), limits: plan.limits, landscape: plan.landscape, mode: plan.mode, screens: plan.screens, duration: plan.duration }
      }
      job.rerenderDraft = body.draft === true
      fs.writeFileSync(path.join(job.dir, 'plan.json'), JSON.stringify(plan, null, 1))
      job.rerender = plan
      job.state = 'queued'
      job.error = null
      job.code = null
      queue.push(job)
      pump()
      return json(res, 200, publicJob(job))
    }

    return json(res, 404, { error: 'not found' })
  } catch (e) {
    console.error(e)
    if (!res.headersSent) json(res, 500, { error: 'internal' })
  }
})

server.listen(PORT, HOST, () => {
  note(t('uk', 'started'))
  if (process.argv.includes('--open')) {
    const url = `${PORTAL}/tools/farm`
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref()
  }
})
