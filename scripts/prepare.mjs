// Первый запуск: заранее готовит всё тяжёлое, чтобы первый ролик не ждал —
// модель распознавания мови и браузер для рендера (один раз, ~1.7 ГБ).
import path from 'node:path'
import { ensureBrowser } from '@remotion/renderer'
import { ensureWhisper } from '../lib/transcribe.mjs'
import { ensureSfx } from '../lib/media.mjs'
import { CACHE } from '../lib/pipeline.mjs'

const model = process.argv[2] || 'medium'
console.log('Готуємо звуки…')
await ensureSfx(path.join(CACHE, 'sfx'))
console.log('Готуємо рендер (один раз)…')
await ensureBrowser()
console.log('Готуємо модель розпізнавання мови (один раз, кілька хвилин)…')
await ensureWhisper(CACHE, model, () => {})
console.log('Підготовку завершено')
