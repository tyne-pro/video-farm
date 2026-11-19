// ============================================================================
// Библиотека мемов: каталог отдаёт портал (/api/farm/memes) — готовые стикерпаки
// и картинки + свои стикерпаки Telegram автора ролика. Файлы кешируются локально,
// чтобы следующие ролики не качали их заново.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Адрес портала: переменная окружения → файл .portal (пишет установщик) → прод
function portalBase() {
  if (process.env.FARM_PORTAL) return process.env.FARM_PORTAL
  try {
    return fs.readFileSync(path.join(process.env.FARM_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), '.portal'), 'utf8').trim()
  } catch {
    return 'https://cp.tyne.pro'
  }
}
export const PORTAL = (portalBase() || 'https://cp.tyne.pro').replace(/\/$/, '')

// Personal key from the install command (file .portal-key): lets the portal serve the meme library without a browser session
function portalKey() {
  if (process.env.FARM_KEY) return process.env.FARM_KEY
  try {
    return fs.readFileSync(path.join(process.env.FARM_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), '.portal-key'), 'utf8').trim()
  } catch {
    return ''
  }
}
const KEY = portalKey()
const withKey = (url) => (KEY && url.startsWith(PORTAL) ? `${url}${url.includes('?') ? '&' : '?'}k=${encodeURIComponent(KEY)}` : url)

const EXT = { image: '.jpg', sticker: '.webp', video: '.webm' }

async function fetchCatalog(cacheDir, log, packs = [], adult = false) {
  const key = (adult ? '-18' : '') + (packs.length ? '-' + packs.join('_').slice(0, 80) : '')
  const file = path.join(cacheDir, `memes${key}.json`)
  try {
    const qs = new URLSearchParams()
    if (packs.length) qs.set('packs', packs.join(','))
    if (adult) qs.set('adult', '1')
    const q = qs.size ? `?${qs}` : ''
    const res = await fetch(withKey(`${PORTAL}/api/farm/memes${q}`), { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!Array.isArray(data.memes)) throw new Error('пустой ответ')
    fs.writeFileSync(file, JSON.stringify(data.memes))
    return data.memes
  } catch (e) {
    if (fs.existsSync(file)) {
      log?.(`Портал недоступен (${e.message}), беру сохранённый каталог мемов`)
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    }
    throw new Error(`Не удалось получить библиотеку мемов с ${PORTAL}: ${e.message}. Проверьте интернет и вход в кабинет tyne.pro.`)
  }
}

/**
 * Каталог с локальными путями. Файлы качаются только для `only` (мемы,
 * которые реально попали в план), чтобы не гонять всю библиотеку через
 * сервер портала. Без `only` — только каталог.
 */
export async function loadMemes(cacheDir, log, { only, packs = [], adult = false } = {}) {
  const dir = path.join(cacheDir, 'memes')
  fs.mkdirSync(dir, { recursive: true })
  const catalog = await fetchCatalog(cacheDir, log, packs || [], adult)
  const withFile = catalog.map((m) => ({ ...m, file: path.join(dir, m.id.replace(/[^\w-]/g, '_') + EXT[m.kind]) }))
  if (!only) return withFile
  const todo = catalog.filter((m) => only.has(m.id) && !fs.existsSync(path.join(dir, m.id.replace(/[^\w-]/g, '_') + EXT[m.kind])))
  if (todo.length) log?.(`Скачиваю мемы: ${todo.length} шт.`)
  let i = 0
  const worker = async () => {
    while (i < todo.length) {
      const m = todo[i++]
      const target = path.join(dir, m.id.replace(/[^\w-]/g, '_') + EXT[m.kind])
      try {
        const url = m.url.startsWith('http') ? m.url : `${PORTAL}${m.url}`
        const res = await fetch(withKey(url), { signal: AbortSignal.timeout(60_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        fs.writeFileSync(target + '.part', Buffer.from(await res.arrayBuffer()))
        fs.renameSync(target + '.part', target)
      } catch (e) {
        log?.(`Мем ${m.id} не скачался: ${e.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return withFile.filter((m) => only.has(m.id) && fs.existsSync(m.file))
}
