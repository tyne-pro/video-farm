// Заранее качает всё тяжёлое, чтобы первый ролик не ждал:
// whisper.cpp + модель распознавания и Chrome Headless Shell для рендера.
import path from 'node:path'
import { ensureBrowser } from '@remotion/renderer'
import { ensureWhisper } from '../lib/transcribe.mjs'
import { ensureSfx, ensureDefaultMusic } from '../lib/media.mjs'
import { CACHE } from '../lib/pipeline.mjs'

const model = process.argv[2] || 'medium'
console.log('Готовлю звуки…')
await ensureSfx(path.join(CACHE, 'sfx'))
await ensureDefaultMusic(path.join(CACHE, 'music'))
console.log('Качаю браузер для рендера…')
await ensureBrowser()
console.log(`Ставлю распознавание речи (whisper.cpp, модель ${model})…`)
await ensureWhisper(CACHE, model, console.log)
console.log('Всё готово.')
