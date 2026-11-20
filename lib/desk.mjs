// ============================================================================
// Служебная часть программы на компьютере: настройки, события для окна,
// место на диске и очистка кеша, проверка системы, отчёт для поддержки.
// Всё локально, в папке данных (~/TyneFarm). В интернет отсюда ничего не уходит.
// ============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { t } from './i18n.mjs'

const GB = 1024 ** 3
/** Свободное место, без которого сборку не начинаем: кадры рендера, звук и сам файл */
export const NEED_BYTES = 1.5 * GB

// --- Настройки ----------------------------------------------------------------------

const settingsFile = (DATA) => path.join(DATA, '.settings.json')
export function readSettings(DATA) {
  try { return JSON.parse(fs.readFileSync(settingsFile(DATA), 'utf8')) } catch { return {} }
}
export function writeSettings(DATA, patch) {
  const next = { ...readSettings(DATA), ...patch }
  fs.writeFileSync(settingsFile(DATA), JSON.stringify(next, null, 1))
  return next
}
/** Папка готовых роликов: из настроек или ~/TyneFarm/Готово */
export function outDir(DATA) {
  const own = readSettings(DATA).outDir
  return own && path.isAbsolute(own) ? own : path.join(DATA, 'Готово')
}

// --- События -------------------------------------------------------------------------

const MAX_EVENTS = 300
let events = null
let seq = 0
const eventsFile = (DATA) => path.join(DATA, '.cache', 'events.json')

function loadEvents(DATA) {
  if (events) return events
  try { events = JSON.parse(fs.readFileSync(eventsFile(DATA), 'utf8')) } catch { events = [] }
  seq = events.reduce((m, e) => Math.max(m, e.id || 0), 0)
  return events
}

/** kind: clip (ролик готов), error, system; key — ключ текста в i18n, vars — подстановки */
export function addEvent(DATA, ev) {
  loadEvents(DATA)
  const item = { id: ++seq, at: Date.now(), ...ev }
  events.push(item)
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  try {
    fs.mkdirSync(path.dirname(eventsFile(DATA)), { recursive: true })
    fs.writeFileSync(eventsFile(DATA), JSON.stringify(events))
  } catch { /* не критично */ }
  return item
}

/** События на языке окна: текст собирается здесь, в окне только показываем */
export function listEvents(DATA, lang, { after = 0, kind } = {}) {
  return loadEvents(DATA)
    .filter((e) => e.id > after && (!kind || e.kind === kind))
    .map((e) => ({
      id: e.id, at: e.at, kind: e.kind,
      text: t(lang, e.key, { ...e.vars, reason: e.vars?.reason ? t(lang, e.vars.reason, { free: humanSize(e.vars.free, lang), need: humanSize(e.vars.need, lang) }) : '' }),
      details: e.details ? t(lang, e.details, e.vars) : null, projectId: e.projectId || null, file: e.file || null,
    }))
}

// --- Место на диске --------------------------------------------------------------------

export function freeSpace(dir) {
  // Проверка поведения при нехватке места без заполнения диска: FARM_TEST=1 FARM_TEST_FREE=<байт>
  if (process.env.FARM_TEST && process.env.FARM_TEST_FREE) return { free: Number(process.env.FARM_TEST_FREE), total: 256 * GB }
  try {
    const s = fs.statfsSync(dir)
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }
  } catch { return { free: null, total: null } }
}

/** Размер папки (рекурсивно, без перехода по ссылкам) */
export function sizeOf(p) {
  let total = 0
  const walk = (x) => {
    let st
    try { st = fs.lstatSync(x) } catch { return }
    if (st.isSymbolicLink()) return
    if (st.isDirectory()) { for (const n of fs.readdirSync(x)) walk(path.join(x, n)) } else total += st.size
  }
  walk(p)
  return total
}

export const humanSize = (bytes, lang = 'uk') => {
  if (bytes == null) return '—'
  const u = { uk: ['Б', 'КБ', 'МБ', 'ГБ'], ru: ['Б', 'КБ', 'МБ', 'ГБ'], en: ['B', 'KB', 'MB', 'GB'] }[lang] || ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < 3) { v /= 1024; i++ }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`.replace('.', lang === 'en' ? '.' : ',')
}

/** Сколько занимает ферма: что можно чистить, а что нужно для работы */
export function diskUsage(DATA) {
  const c = path.join(DATA, '.cache')
  const parts = {
    model: sizeOf(path.join(c, 'whisper')),
    render: sizeOf(path.join(DATA, '.remotion')),
    stock: sizeOf(path.join(c, 'stock')),
    fonts: sizeOf(path.join(c, 'fonts')),
    temp: sizeOf(path.join(DATA, 'work')) + sizeOf(path.join(DATA, '.trash')) + tmpBundles().reduce((s, d) => s + sizeOf(d), 0),
    projects: sizeOf(path.join(DATA, '.projects')),
    done: sizeOf(outDir(DATA)),
  }
  return { ...freeSpace(DATA), parts, cleanable: parts.stock + parts.temp }
}

const tmpBundles = () => {
  try { return fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('remotion-webpack-bundle-')).map((n) => path.join(os.tmpdir(), n)) } catch { return [] }
}

/**
 * Очистка кеша: скачанные стоки, временные папки, корзина и старые сборки рендера.
 * Модель речи, проекты и готовые ролики не трогаем. busy — id задач, которые сейчас в работе.
 */
export function clearCache(DATA, { busyDirs = [] } = {}) {
  const before = freeSpace(DATA).free
  const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* занято */ } }
  rm(path.join(DATA, '.cache', 'stock'))
  const work = path.join(DATA, 'work')
  try { for (const n of fs.readdirSync(work)) if (!busyDirs.includes(path.join(work, n))) rm(path.join(work, n)) } catch { /* нет папки */ }
  rm(path.join(DATA, '.trash'))
  const now = Date.now()
  for (const d of tmpBundles()) { try { if (now - fs.statSync(d).mtimeMs > 10 * 60 * 1000) rm(d) } catch { /* занято */ } }
  const after = freeSpace(DATA).free
  return { freed: before != null && after != null ? Math.max(0, after - before) : null }
}

// --- Отчёт для поддержки ------------------------------------------------------------------

/** Убираем всё личное: домашнюю папку, ключи, почты, длинные токены */
export function scrub(text) {
  const home = os.homedir()
  return String(text)
    .split(home).join('~')
    .replace(/([?&](k|key|token)=)[^&\s"']+/gi, '$1•••')
    .replace(/\b\d{2,}\.[a-f0-9]{24,}\b/gi, '•••')
    .replace(/\b[a-f0-9]{40,}\b/gi, '•••')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '•••@•••')
    .replace(/\/Users\/[^/\s]+/g, '~')
}

export function techLog(DATA, lines = 200) {
  try {
    const all = fs.readFileSync(path.join(DATA, '.cache', 'errors.log'), 'utf8').split('\n')
    return scrub(all.slice(-lines).join('\n'))
  } catch { return '' }
}

export function supportReport(DATA, { lang = 'uk', version, tier, checks = [] } = {}) {
  const d = diskUsage(DATA)
  const ev = listEvents(DATA, lang).slice(-30)
  const lines = [
    `TyneFarm ${version}`,
    `${os.type()} ${os.release()} · ${os.arch()} · ${Math.round(os.totalmem() / GB)} GB RAM`,
    `Disk: free ${humanSize(d.free, 'en')} of ${humanSize(d.total, 'en')}; farm: model ${humanSize(d.parts.model, 'en')}, render ${humanSize(d.parts.render, 'en')}, cache ${humanSize(d.cleanable, 'en')}, projects ${humanSize(d.parts.projects, 'en')}`,
    `Plan: ${tier || '—'}`,
    `Checks: ${checks.map((c) => `${c.id}=${c.ok ? 'ok' : 'fail'}`).join(', ')}`,
    '',
    '— Events —',
    ...ev.map((e) => `${new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')} [${e.kind}] ${e.text}`),
    '',
    '— Technical log (last lines) —',
    techLog(DATA, 80),
  ]
  return scrub(lines.join('\n'))
}

// --- Проверка системы ---------------------------------------------------------------------

/** Что нужно для монтажа: модель речи, движок сборки, место, связь с кабинетом */
export function systemChecks(DATA, { connected, online }) {
  const c = path.join(DATA, '.cache')
  const model = fs.existsSync(path.join(c, '.prepared-medium')) || (fs.existsSync(path.join(c, 'whisper')) && fs.readdirSync(path.join(c, 'whisper')).length > 0)
  const render = fs.existsSync(path.join(DATA, '.remotion')) && sizeOf(path.join(DATA, '.remotion')) > 50 * 1024 * 1024
  const { free } = freeSpace(DATA)
  return [
    { id: 'model', ok: model, fix: model ? null : 'prepare' },
    { id: 'render', ok: render, fix: render ? null : 'prepare' },
    { id: 'disk', ok: free == null || free >= NEED_BYTES, fix: free != null && free < NEED_BYTES ? 'cache' : null, vars: { free: free } },
    { id: 'cabinet', ok: !!connected, fix: connected ? null : 'connect' },
    { id: 'internet', ok: online !== false, fix: null },
  ]
}
