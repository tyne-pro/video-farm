// ============================================================================
// Библиотека мемов: каталог отдаёт портал (/api/farm/memes) — готовые стикерпаки
// и картинки + свои стикерпаки Telegram автора ролика. Файлы кешируются локально,
// чтобы следующие ролики не качали их заново.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PORTAL, withKey } from './portal.mjs'
export { PORTAL }

const EXT = { image: '.jpg', sticker: '.webp', video: '.webm' }

async function fetchCatalog(cacheDir, log, packs = [], adult = false, k = '') {
  const key = (adult ? '-18' : '') + (packs.length ? '-' + packs.join('_').slice(0, 80) : '')
  const file = path.join(cacheDir, `memes${key}.json`)
  try {
    const qs = new URLSearchParams()
    if (packs.length) qs.set('packs', packs.join(','))
    if (adult) qs.set('adult', '1')
    const q = qs.size ? `?${qs}` : ''
    const res = await fetch(withKey(`${PORTAL}/api/farm/memes${q}`, k), { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!Array.isArray(data.memes)) throw new Error('пустой ответ')
    fs.writeFileSync(file, JSON.stringify(data.memes))
    return data.memes
  } catch (e) {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    }
    return []
  }
}

/**
 * Каталог с локальными путями. Файлы качаются только для `only` (мемы,
 * которые реально попали в план), чтобы не гонять всю библиотеку через
 * сервер портала. Без `only` — только каталог.
 */
export async function loadMemes(cacheDir, log, { only, packs = [], adult = false, k = '', localDir = null } = {}) {
  const dir = path.join(cacheDir, 'memes')
  fs.mkdirSync(dir, { recursive: true })
  const catalog = [...await fetchCatalog(cacheDir, log, packs || [], adult, k), ...localStickers(localDir)]
  const withFile = catalog.map((m) => (m.local ? m : { ...m, file: path.join(dir, m.id.replace(/[^\w-]/g, '_') + EXT[m.kind]) }))
  if (!only) return withFile
  const todo = catalog.filter((m) => !m.local && only.has(m.id) && !fs.existsSync(path.join(dir, m.id.replace(/[^\w-]/g, '_') + EXT[m.kind])))
  let i = 0
  const worker = async () => {
    while (i < todo.length) {
      const m = todo[i++]
      const target = path.join(dir, m.id.replace(/[^\w-]/g, '_') + EXT[m.kind])
      try {
        const url = m.url.startsWith('http') ? m.url : `${PORTAL}${m.url}`
        const res = await fetch(withKey(url, k), { signal: AbortSignal.timeout(60_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        fs.writeFileSync(target + '.part', Buffer.from(await res.arrayBuffer()))
        fs.renameSync(target + '.part', target)
      } catch (e) {
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return withFile.filter((m) => only.has(m.id) && fs.existsSync(m.file))
}

/** Свои картинки и анимации из папки stickers (Premium и Pro) */
function localStickers(dir) {
  if (!dir || !fs.existsSync(dir)) return []
  const KIND = { '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'sticker', '.gif': 'image', '.webm': 'video', '.mp4': 'video' }
  return fs.readdirSync(dir).filter((n) => KIND[path.extname(n).toLowerCase()]).slice(0, 200)
    .map((n) => ({ id: `local_${n.replace(/[^\w.-]/g, '_')}`, kind: KIND[path.extname(n).toLowerCase()], label: path.parse(n).name.replace(/[_-]+/g, ' '), file: path.join(dir, n), local: true }))
}
