// ============================================================================
// Шрифты стиля: файлы с Google Fonts (открытая лицензия) один раз скачиваются
// на этот компьютер в .cache/fonts и дальше берутся оттуда — и для превью, и для финала.
// Берём только латиницу и кириллицу.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { FONT, googleFamily } from '../remotion/style.js'

const SUBSETS = new Set(['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'])
// Современный браузер получает от Google файлы woff2
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const pending = new Map()

/** Начертания шрифта: [{ file, weight, style, unicodeRange }] (скачивает при первом обращении) */
export function fontFaces(cacheDir, id) {
  const font = FONT[id]
  if (!font) return Promise.resolve([])
  if (!pending.has(id)) pending.set(id, load(cacheDir, font).catch((e) => { pending.delete(id); throw e }))
  return pending.get(id)
}

async function load(cacheDir, font) {
  const dir = path.join(cacheDir, 'fonts', font.id)
  const index = path.join(dir, 'faces.json')
  if (fs.existsSync(index)) {
    const faces = JSON.parse(fs.readFileSync(index, 'utf8'))
    if (faces.length && faces.every((f) => fs.existsSync(path.join(dir, f.file)))) return faces.map((f) => ({ ...f, file: path.join(dir, f.file) }))
  }
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${googleFamily(font)}&display=swap`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`font ${font.id}: HTTP ${res.status}`)
  const css = await res.text()
  const faces = []
  for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const [, subset, body] = m
    if (!SUBSETS.has(subset)) continue
    const url = body.match(/url\((https:[^)]+)\)/)?.[1]
    if (!url) continue
    faces.push({
      subset,
      url,
      weight: Number(body.match(/font-weight:\s*(\d+)/)?.[1] || font.w),
      style: body.match(/font-style:\s*(\w+)/)?.[1] || 'normal',
      unicodeRange: body.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim() || undefined,
    })
  }
  if (!faces.length) throw new Error(`font ${font.id}: no faces`)
  fs.mkdirSync(dir, { recursive: true })
  for (const f of faces) {
    const r = await fetch(f.url, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) throw new Error(`font ${font.id}: HTTP ${r.status}`)
    f.file = `${f.subset}.woff2`
    fs.writeFileSync(path.join(dir, f.file), Buffer.from(await r.arrayBuffer()))
    delete f.url
  }
  fs.writeFileSync(index, JSON.stringify(faces))
  return faces.map((f) => ({ ...f, file: path.join(dir, f.file) }))
}
