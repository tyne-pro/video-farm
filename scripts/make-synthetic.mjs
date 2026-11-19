// Синтетические исходники для проверки пайплайна: голова (вертикаль) и
// планшет (горизонталь) с одной и той же речью, планшет начат на 1.3 с позже.
// Речь — системный TTS macOS (say -v Milena); на других ОС передай свой WAV.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const out = path.resolve(process.argv[2] || 'test-input')
fs.mkdirSync(out, { recursive: true })
const text = [
  'Привет! Сегодня расскажу про три ошибки новичков в спортзале.',
  '[[slnc 900]] Первое. Многие сразу берут большой вес. Так делать не надо.',
  '[[slnc 1200]] Второе. Без разминки легко получить травму.',
  '[[slnc 700]] Третье. Записывайте тренировки, чтобы видеть прогресс за три месяца.',
  '[[slnc 1000]] И главное. Отдых так же важен, как и нагрузка.',
  '[[slnc 800]] Подписывайтесь, дальше будет разбор питания.',
].join(' ')
let speech = process.argv[3]
if (!speech) {
  speech = path.join(out, 'speech.aiff')
  execFileSync('say', ['-v', 'Milena', '-o', speech, text])
}
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', speech]).toString()) + 2
// Голова: «тихая петличка» (-12 дБ) + лёгкий шум
ff(['-f', 'lavfi', '-i', `testsrc2=s=1080x1920:r=30:d=${dur}`, '-i', speech,
  '-f', 'lavfi', '-i', `anoisesrc=a=0.003:d=${dur}`,
  '-filter_complex', '[1:a]adelay=1000:all=1,volume=-12dB[s];[s][2:a]amix=inputs=2:duration=longest[a]',
  '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-t', String(dur), path.join(out, 'head.mp4')])
// Планшет: начат на 1.3 с позже, звук со встроенного микрофона (тише, другой тембр)
ff(['-f', 'lavfi', '-i', `smptehdbars=s=1920x1080:r=30:d=${dur}`, '-i', speech,
  '-filter_complex', '[1:a]atrim=start=0.3,asetpts=PTS-STARTPTS,lowpass=f=3000,volume=-18dB[a]',
  '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-t', String(dur - 1.3), path.join(out, 'tablet.mp4')])
console.log(`Готово: ${out}/head.mp4, ${out}/tablet.mp4 (планшет позже на 1.3 с)`)
