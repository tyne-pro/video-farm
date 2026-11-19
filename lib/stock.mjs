// ============================================================================
// Бесплатные стоковые клипы (Pexels, Pixabay): сервер кабинета подбирает ссылки по теме,
// здесь клипы скачиваются на этот компьютер в кеш. Кеш чистится сам: файлы старше 7 дней.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'

const KEEP_MS = 7 * 24 * 60 * 60 * 1000

export function cleanStock(dir) {
  try {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name)
      if (Date.now() - fs.statSync(file).mtimeMs > KEEP_MS) fs.rmSync(file, { force: true })
    }
  } catch { /* папки ещё нет */ }
}

/** Скачивает клипы (до 3 одновременно), возвращает те, что скачались: [{ ...clip, file }] */
export async function downloadStock(clips, dir) {
  fs.mkdirSync(dir, { recursive: true })
  cleanStock(dir)
  const out = []
  let i = 0
  const worker = async () => {
    while (i < clips.length) {
      const c = clips[i++]
      // Только https; FARM_TEST — локальная проверка с тестовым кабинетом
      if (!/^https:\/\//.test(c.url) && !(process.env.FARM_TEST && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(c.url))) continue
      const file = path.join(dir, `${String(c.id).replace(/[^\w-]/g, '_')}.mp4`)
      try {
        if (!fs.existsSync(file)) {
          const res = await fetch(c.url, { signal: AbortSignal.timeout(90_000) })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.length > 80 * 1024 * 1024) throw new Error('too big')
          fs.writeFileSync(file + '.part', buf)
          fs.renameSync(file + '.part', file)
        } else {
          fs.utimesSync(file, new Date(), new Date())
        }
        out.push({ ...c, file })
      } catch { /* клип не скачался — экран получит живой фон */ }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return clips.map((c) => out.find((o) => o.id === c.id)).filter(Boolean)
}
