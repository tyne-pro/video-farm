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
import { runPipeline, renderProject, ROOT, DATA, Cancelled } from './lib/pipeline.mjs'
import { totalDuration } from './remotion/project.js'
import { FONT } from './remotion/style.js'
import { fontFaces } from './lib/gfonts.mjs'
import { readSettings, writeSettings, outDir, addEvent, listEvents, diskUsage, clearCache, supportReport, techLog, systemChecks, humanSize, freeSpace, NEED_BYTES } from './lib/desk.mjs'
import { loadProject, findOutput, listProjects, trashItem, restoreItem, purgeTrash, reveal, applyEditorChanges, ensureProxies, mediaInfo, projectDir, projectPaths } from './lib/projects.mjs'
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
purgeTrash(DATA)
setInterval(() => { cleanWork(); purgeTrash(DATA) }, 60 * 60 * 1000).unref()
const STUDIO = path.join(ROOT, 'studio', 'dist')

// Окно программы (tauri://localhost) тоже ходит сюда за очередью, событиями и местом на диске
const ALLOWED_ORIGINS = new Set([PORTAL, 'https://cp.tyne.pro', 'http://localhost:3000', 'http://localhost:3313', `http://${HOST}:${PORT}`, `http://localhost:${PORT}`, 'tauri://localhost', 'http://tauri.localhost'])
const originOk = (o) => ALLOWED_ORIGINS.has(o) || (!!process.env.FARM_TEST && /^http:\/\/127\.0\.0\.1:\d+$/.test(o))

// --- Задачи ------------------------------------------------------------------

const jobs = new Map()
const queue = []
let running = false
// Пауза очереди: текущий ролик доделывается, следующие ждут
let paused = !!readSettings(DATA).paused
const appLog = []
let meCache = null
const stampNow = () => new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
const note = (line) => { line = `${stampNow()} ${line}`; appLog.push(line); if (appLog.length > 200) appLog.shift(); console.log(line) }

/** Сколько осталось: по скорости с начала работы (после 5 % — раньше оценка случайная) */
function etaOf(j) {
  if (j.state !== 'running' || !j.startedAt || j.progress < 0.05) return null
  const spent = (Date.now() - j.startedAt) / 1000
  return Math.max(1, Math.round(spent * (1 - j.progress) / j.progress))
}

function publicJob(j) {
  return {
    eta: etaOf(j), startedAt: j.startedAt || null,
    id: j.id, state: j.state, step: j.step, progress: j.progress, error: j.error, code: j.code || null,
    title: j.options?.title, mode: j.options?.mode, createdAt: j.createdAt, credits: j.credits || [],
    tier: j.run?.tier || null, left: j.run?.left ?? null,
    log: j.logs.slice(-40), result: j.result ? path.basename(j.result) : null, draft: !!j.isDraft,
    hasPlan: !!j.projectId || fs.existsSync(path.join(j.dir, 'plan.json')),
    projectId: j.projectId || null,
    uploaded: (j.files.video ? 1 : 0) + j.files.items.length,
  }
}

function newJob(fixedId) {
  const id = fixedId || crypto.randomBytes(6).toString('hex')
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
  if (running || paused) return
  const job = queue.shift()
  if (!job) return
  running = true
  job.state = 'running'
  job.startedAt = Date.now()
  job.progress = 0
  try {
    if (job.rerender) { job.say('rerender'); await renderProject(job, job.rerender, { assetUrl, draft: job.rerenderDraft }) }
    else await runPipeline(job, { assetUrl })
    job.state = 'done'
    job.progress = 1
    if (!job.isDraft) addEvent(DATA, { kind: 'clip', key: 'evDone', vars: { title: job.options?.title || '' }, projectId: job.projectId || null, file: job.result ? path.basename(job.result) : null })
  } catch (e) {
    job.state = 'error'
    // Технические подробности — только в файл ошибок; пользователю — понятная фраза
    const known = ['auth', 'limit', 'busy', 'offline', 'needVideo', 'needItems', 'needTopic', 'notVideo'].find((c) => e.message === t(job.options?.lang, c))
      || (e.message.startsWith(t(job.options?.lang, 'disk', { free: '', need: '' }).slice(0, 12)) ? 'disk' : null)
    job.code = e instanceof Cancelled ? 'cancelled' : known || 'error'
    job.error = e instanceof Cancelled ? t(job.options?.lang, 'cancelled') : known ? e.message : t(job.options?.lang, 'failed')
    job.log(job.error)
    if (!known && !(e instanceof Cancelled)) console.error(e)
    addEvent(DATA, e instanceof Cancelled
      ? { kind: 'system', key: 'evCancelled', vars: { title: job.options?.title || '' }, projectId: job.projectId || null }
      : { kind: 'error', key: 'evFailed', vars: { title: job.options?.title || '', reason: job.code === 'error' ? 'failed' : job.code, ...(job.code === 'disk' ? { free: freeSpace(DATA).free, need: NEED_BYTES } : {}) }, details: job.code === 'disk' ? 'detDisk' : 'detFailed', projectId: job.projectId || null })
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
  if (origin && originOk(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
  return !origin || originOk(origin)
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
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
}

function sendFile(req, res, file, { download, cache } = {}) {
  if (!fs.existsSync(file)) return json(res, 404, { error: 'no file' })
  const stat = fs.statSync(file)
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', ...(cache ? { 'Cache-Control': cache } : {}) }
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

function queueProjectRender(job, project, draft) {
  fs.writeFileSync(path.join(projectDir(DATA, project.id), 'project.json'), JSON.stringify(project, null, 1))
  job.rerenderDraft = draft
  job.rerender = project
  job.state = 'queued'
  job.error = null
  job.code = null
  job.progress = 0
  queue.push(job)
  pump()
}

/** Тариф по ключу программы (с кэшем), чтобы закрыть финал из редактора в демо */
async function currentMe() {
  // Локальная проверка без кабинета: FARM_TEST=1 FARM_TEST_TIER=pro|premium|demo
  if (process.env.FARM_TEST && process.env.FARM_TEST_TIER) return { tier: process.env.FARM_TEST_TIER }
  const key = savedKey()
  if (!meCache || meCache.key !== key || Date.now() - meCache.at > 60_000) meCache = { key, at: Date.now(), me: await portalMe(key) }
  return meCache.me
}

// --- Проекты: список «Мої ролики» и редактор ----------------------------------------
async function projectsApi(req, res, url, parts) {
  const { OUT_DIR } = projectPaths(DATA)
  if (req.method === 'GET' && parts.length === 2) {
    const me = await currentMe()
    const busy = new Map([...jobs.values()].filter((j) => j.projectId && ['queued', 'running'].includes(j.state)).map((j) => [j.projectId, j.id]))
    const items = listProjects(DATA).map((p) => ({
      ...p,
      job: p.id ? busy.get(p.id) || null : null,
      thumb: p.id && p.thumb ? (mediaInfo(DATA, loadProject(DATA, p.id), assetUrl)[p.thumb]?.preview || null) : null,
      video: p.outputs?.length ? `http://${HOST}:${PORT}/api/projects/file/download?name=${encodeURIComponent(p.outputs.at(-1).file)}&inline=1` : null,
    }))
    return json(res, 200, { items, tier: me?.tier || null, version: VERSION })
  }
  // Готовый ролик по имени файла из «Готово»: скачать, открыть, показать в папке, удалить
  if (parts[2] === 'file') {
    const name = path.basename(url.searchParams.get('name') || '')
    const file = name ? findOutput(DATA, name) : null
    if (!file) return json(res, 404, { error: 'no file' })
    if (req.method === 'GET' && parts[3] === 'download') return sendFile(req, res, file, { download: url.searchParams.get('inline') !== '1' })
    if (req.method === 'POST' && parts[3] === 'reveal') { await reveal(file); return json(res, 200, { ok: true }) }
    if (req.method === 'DELETE') return json(res, 200, { ok: true, undo: trashItem(DATA, { file: name }) })
    return json(res, 404, { error: 'not found' })
  }
  if (req.method === 'POST' && parts[2] === 'restore') {
    const body = await readJson(req)
    restoreItem(DATA, String(body.undo || ''))
    return json(res, 200, { ok: true })
  }
  let project
  try { project = loadProject(DATA, parts[2]) } catch { project = null }
  if (!project) return json(res, 404, { error: 'no project' })
  const dir = projectDir(DATA, project.id)

  if (req.method === 'GET' && parts.length === 3) {
    await ensureProxies(DATA, project).catch((e) => console.error(e))
    const me = await currentMe()
    const ownFont = fs.existsSync(path.join(DATA, 'fonts')) && fs.readdirSync(path.join(DATA, 'fonts')).some((n) => /\.(ttf|otf|woff2?)$/i.test(n))
    return json(res, 200, { project, ownFont, media: mediaInfo(DATA, project, assetUrl), tier: me?.tier || null, sfx: Object.fromEntries(['click', 'type', 'pop', 'whoosh'].map((k) => [k, assetUrl(path.join(DATA, '.cache', 'sfx', `${k}.wav`))])) })
  }
  // Автосохранение монтажа
  if (req.method === 'PUT' && parts.length === 3) {
    const saved = applyEditorChanges(DATA, project, await readJson(req))
    return json(res, 200, { ok: true, updatedAt: saved.updatedAt, clips: saved.clips })
  }
  if (req.method === 'DELETE' && parts.length === 3) return json(res, 200, { ok: true, undo: trashItem(DATA, { id: project.id }) })
  if (req.method === 'GET' && parts[3] === 'original') {
    if (!project.original) return json(res, 404, { error: 'no original' })
    return sendFile(req, res, path.join(dir, project.original), { download: true })
  }
  if (req.method === 'POST' && parts[3] === 'reveal') {
    const last = project.outputs?.at(-1)
    const lastFile = last ? (last.dir ? path.join(last.dir, last.file) : findOutput(DATA, last.file)) : null
    await reveal(lastFile && fs.existsSync(lastFile) ? lastFile : dir)
    return json(res, 200, { ok: true })
  }
  // Стікери проекта для превью в редакторе
  if (req.method === 'GET' && parts[3] === 'memes') {
    const own = project.limits?.ownStickers
    const memes = await loadMemes(path.join(DATA, '.cache'), null, { only: new Set(project.plan.memes.map((m) => m.id)), packs: own ? project.stickers?.packs : [], adult: own && project.stickers?.adult, k: savedKey(), localDir: own ? path.join(DATA, 'stickers') : null })
    return json(res, 200, Object.fromEntries(memes.map((m) => [m.id, { kind: m.kind, src: assetUrl(m.file) }])))
  }
  // Финальная сборка 1080p из редактора: Premium и Pro (в демо — только превью)
  if (req.method === 'POST' && parts[3] === 'render') {
    const body = await readJson(req)
    const me = await currentMe()
    if (!me) return json(res, 401, { error: 'auth' })
    if (me.tier === 'demo' && body.draft !== true) return json(res, 402, { error: 'locked' })
    const running = [...jobs.values()].find((j) => j.projectId === project.id && ['queued', 'running'].includes(j.state))
    if (running) return json(res, 200, publicJob(running))
    const job = jobs.get(project.id) || newJob(`r${crypto.randomBytes(5).toString('hex')}`)
    job.dir = dir
    job.projectId = project.id
    job.options = { lang: project.lang, title: project.title, k: savedKey(), mode: project.mode }
    job.tier = me.tier
    job.say('rerender')
    queueProjectRender(job, project, body.draft === true)
    return json(res, 200, publicJob(job))
  }
  return json(res, 404, { error: 'not found' })
}

// --- Окно программы: очередь, место, события, отчёт, настройки -----------------------------
const LANG = (url) => (LANGS.has(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'uk')
let systemCache = null
let repairing = null

async function deskApi(req, res, url, parts) {
  const lang = LANG(url)
  // Текущий ролик, очередь, пауза — окно спрашивает раз в секунду
  if (parts[1] === 'queue' && req.method === 'GET') {
    const current = [...jobs.values()].find((j) => j.state === 'running')
    return json(res, 200, { paused, current: current ? publicJob(current) : null, queued: queue.map(publicJob), version: VERSION })
  }
  if (parts[1] === 'queue' && parts[2] === 'pause' && req.method === 'POST') {
    const body = await readJson(req)
    paused = body.paused !== false
    writeSettings(DATA, { paused })
    addEvent(DATA, { kind: 'system', key: paused ? 'evPaused' : 'evResumed' })
    if (!paused) pump()
    return json(res, 200, { paused })
  }
  if (parts[1] === 'system' && req.method === 'GET') {
    if (!systemCache || Date.now() - systemCache.at > 15_000 || url.searchParams.get('fresh')) {
      const me = await currentMe()
      const usage = diskUsage(DATA)
      systemCache = { at: Date.now(), usage, checks: systemChecks(DATA, { connected: !!me, online: me !== null || !savedKey() }), me }
    }
    const { usage, checks, me } = systemCache
    return json(res, 200, {
      disk: { ...usage, human: Object.fromEntries(Object.entries({ free: usage.free, total: usage.total, cleanable: usage.cleanable, ...usage.parts }).map(([k, v]) => [k, humanSize(v, lang)])) },
      checks, repairing: !!repairing, me, settings: { ...readSettings(DATA), outDir: outDir(DATA), defaultOutDir: path.join(DATA, 'Готово') },
    })
  }
  if (parts[1] === 'events' && req.method === 'GET') {
    return json(res, 200, { events: listEvents(DATA, lang, { after: Number(url.searchParams.get('after')) || 0, kind: url.searchParams.get('kind') || undefined }) })
  }
  if (parts[1] === 'cache' && parts[2] === 'clear' && req.method === 'POST') {
    const busyDirs = [...jobs.values()].filter((j) => ['queued', 'running', 'uploading'].includes(j.state)).map((j) => j.dir)
    const r = clearCache(DATA, { busyDirs })
    systemCache = null
    addEvent(DATA, { kind: 'system', key: 'evCache', vars: { size: humanSize(r.freed ?? 0, lang) } })
    return json(res, 200, { freed: r.freed, human: humanSize(r.freed ?? 0, lang) })
  }
  if (parts[1] === 'report' && req.method === 'GET') {
    const me = await currentMe()
    const checks = systemChecks(DATA, { connected: !!me, online: me !== null || !savedKey() })
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end(supportReport(DATA, { lang, version: VERSION, tier: me?.tier, checks }))
  }
  if (parts[1] === 'techlog' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end(techLog(DATA, 300))
  }
  if (parts[1] === 'settings') {
    if (req.method === 'PUT') {
      const body = await readJson(req)
      const patch = {}
      if (typeof body.outDir === 'string') {
        const dir = body.outDir.trim()
        if (dir && !path.isAbsolute(dir)) return json(res, 400, { error: 'path' })
        if (dir) fs.mkdirSync(dir, { recursive: true })
        patch.outDir = dir || null
      }
      writeSettings(DATA, patch)
      systemCache = null
    }
    return json(res, 200, { ...readSettings(DATA), outDir: outDir(DATA), defaultOutDir: path.join(DATA, 'Готово') })
  }
  // «Починить»: заново подготовить модель речи и движок сборки (то же, что при первом запуске)
  if (parts[1] === 'repair' && req.method === 'POST') {
    if (!repairing) {
      repairing = spawn(process.execPath, [path.join(ROOT, 'scripts', 'prepare.mjs'), 'medium'], { cwd: DATA, env: process.env, stdio: ['ignore', 'ignore', 'pipe'] })
      repairing.stderr.on('data', (d) => process.stderr.write(d))
      repairing.on('close', (code) => {
        if (code === 0) { try { fs.writeFileSync(path.join(DATA, '.cache', '.prepared-medium'), 'ok') } catch { /* нет папки */ } }
        addEvent(DATA, { kind: code === 0 ? 'system' : 'error', key: code === 0 ? 'evRepairOk' : 'evRepairFail' })
        repairing = null
        systemCache = null
      })
    }
    return json(res, 200, { repairing: true })
  }
  return json(res, 404, { error: 'not found' })
}

const cleanName = (name) => String(name || 'file').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80)

const server = http.createServer(async (req, res) => {
  try {
    // Только этот компьютер по имени 127.0.0.1/localhost: чужой сайт не достучится подменой адреса
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return json(res, 403, { error: 'host' })
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
      const allowed = ['.cache', 'work', '.projects', 'music', 'assets', 'fonts', 'stickers'].some((d) => file.startsWith(path.join(DATA, d) + path.sep))
      if (!allowed) return json(res, 403, { error: 'forbidden' })
      return sendFile(req, res, file)
    }

    // Редактор и список роликов: сайт самой программы, тот же дизайн, что и кабинет
    if (req.method === 'GET' && parts[0] === 'studio') {
      if (!fs.existsSync(STUDIO)) return json(res, 404, { error: 'studio not built' })
      const file = path.resolve(STUDIO, ...parts.slice(1))
      // Файлы сборки с хешем в имени не меняются; страницу берём свежую после каждого обновления программы
      if (file.startsWith(STUDIO + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(req, res, file, { cache: /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache' })
      return sendFile(req, res, path.join(STUDIO, 'index.html'), { cache: 'no-cache' })
    }

    if (parts[0] === 'api' && parts[1] === 'projects') return projectsApi(req, res, url, parts)
    if (parts[0] === 'api' && ['queue', 'system', 'events', 'cache', 'report', 'techlog', 'settings', 'repair'].includes(parts[1])) return deskApi(req, res, url, parts)

    // Шрифт стиля для превью: файлы скачиваются с Google Fonts один раз и дальше лежат на компьютере
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'fonts' && FONT[parts[2]]) {
      const faces = await fontFaces(path.join(DATA, '.cache'), parts[2]).catch(() => [])
      return json(res, faces.length ? 200 : 502, faces.map((f) => ({ src: assetUrl(f.file), weight: f.weight, style: f.style, unicodeRange: f.unicodeRange })))
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
      job.names = { ...(job.names || {}), [file]: name }
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

    // Отмена: из очереди — сразу, в работе — после текущего шага, рендер — сразу
    if (req.method === 'POST' && parts[3] === 'cancel') {
      if (['done', 'error'].includes(job.state)) return json(res, 200, publicJob(job))
      job.cancelled = true
      const i = queue.indexOf(job)
      if (i >= 0) { queue.splice(i, 1); job.state = 'error'; job.code = 'cancelled'; job.error = t(job.options?.lang, 'cancelled'); job.log(job.error) }
      job.cancelRender?.()
      return json(res, 200, publicJob(job))
    }

    // Повтор после ошибки или отмены: те же файлы и настройки, новый учёт ролика (сорвавшийся вернулся в лимит)
    if (req.method === 'POST' && parts[3] === 'retry') {
      if (job.state !== 'error' || !job.options) return json(res, 409, { error: 'not failed' })
      job.cancelled = false
      job.error = null
      job.code = null
      job.run = null
      job.progress = 0
      job.state = 'queued'
      job.say('retry')
      queue.push(job)
      pump()
      return json(res, 200, publicJob(job))
    }

    if (req.method === 'GET' && parts[3] === 'result') {
      if (!job.result) return json(res, 404, { error: 'not ready' })
      return sendFile(req, res, job.result, { download: url.searchParams.get('inline') !== '1' })
    }

    if (req.method === 'GET' && parts[3] === 'plan') {
      const project = job.projectId ? loadProject(DATA, job.projectId) : null
      return project ? json(res, 200, { ...project.plan, mode: project.mode, limits: project.limits, duration: totalDuration(project) }) : sendFile(req, res, path.join(job.dir, 'plan.json'))
    }

    // Правка плана в кабинете (хук, тексты, стикеры, заголовки) и быстрая пересборка без нового распознавания
    if (req.method === 'POST' && parts[3] === 'rerender') {
      const project = job.projectId ? loadProject(DATA, job.projectId) : null
      if (!['done', 'error'].includes(job.state) || !project) return json(res, 409, { error: 'no plan' })
      const body = await readJson(req)
      if (body.edits) {
        const own = project.limits?.ownStickers
        const catalog = await loadMemes(path.join(DATA, '.cache'), null, { packs: own ? project.stickers?.packs : [], adult: own && project.stickers?.adult, k: job.options?.k, localDir: own ? path.join(DATA, 'stickers') : null })
        const { mode, ...edited } = applyEdits({ ...project.plan, mode: project.mode }, body.edits, { memeIds: new Set(catalog.map((m) => m.id)) })
        project.plan = edited
      }
      queueProjectRender(job, project, body.draft === true)
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
  addEvent(DATA, { kind: 'system', key: 'evStarted' })
  if (process.argv.includes('--open')) {
    const url = `${PORTAL}/tools/farm`
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref()
  }
})
