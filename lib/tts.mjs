// ============================================================================
// Озвучка (text-to-speech): Piper — локально, офлайн, рядом с whisper.cpp.
//
// Движок — официальный Piper (пакет piper-tts, OHF-Voice) в своём venv.
// Готовые standalone-бинарники Piper под macOS битые (нет dylib), поэтому берём
// Python-пакет. Движок спрятан за этим модулем: synthesize/generateVoiceover —
// единственный интерфейс, Piper можно заменить, как Remotion.
//
// Голоса (модели .onnx) качаются лениво, по одному, при первом выборе.
// Таймкоды слов для субтитров берём существующим whisper (transcribe.mjs).
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { ffmpeg, probe } from './media.mjs'
import { transcribeWords } from './transcribe.mjs'

// Голоса Piper на HuggingFace (MIT/ODbL/CC — свободные, без жёстких лимитов)
const VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

// Манифест: только реальные голоса каталога Piper. mb — размер модели (качается один раз).
export const VOICES = [
  { id: 'uk_tetiana', lang: 'uk', gender: 'f', quality: 'high',   name: 'Тетяна',  desc: 'Жіночий, високе звучання', path: 'uk/uk_UA/tetiana/high/uk_UA-tetiana-high', mb: 108 },
  { id: 'uk_mykyta',  lang: 'uk', gender: 'm', quality: 'high',   name: 'Микита',  desc: 'Чоловічий, високе звучання', path: 'uk/uk_UA/mykyta/high/uk_UA-mykyta-high',   mb: 108 },
  { id: 'uk_oleksa',  lang: 'uk', gender: 'm', quality: 'high',   name: 'Олекса',  desc: 'Чоловічий, спокійний',       path: 'uk/uk_UA/oleksa/high/uk_UA-oleksa-high',   mb: 108 },
  { id: 'uk_lada',    lang: 'uk', gender: 'f', quality: 'light',  name: 'Лада',    desc: 'Жіночий, легка модель',     path: 'uk/uk_UA/lada/x_low/uk_UA-lada-x_low',     mb: 19 },
  { id: 'ru_irina',   lang: 'ru', gender: 'f', quality: 'medium', name: 'Ирина',   desc: 'Женский',                    path: 'ru/ru_RU/irina/medium/ru_RU-irina-medium', mb: 60 },
  { id: 'ru_dmitri',  lang: 'ru', gender: 'm', quality: 'medium', name: 'Дмитрий', desc: 'Мужской',                    path: 'ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium', mb: 60 },
  { id: 'en_amy',     lang: 'en', gender: 'f', quality: 'medium', name: 'Amy',     desc: 'Female (US)',                path: 'en/en_US/amy/medium/en_US-amy-medium',     mb: 60 },
  { id: 'en_ryan',    lang: 'en', gender: 'm', quality: 'high',   name: 'Ryan',    desc: 'Male (US)',                  path: 'en/en_US/ryan/high/en_US-ryan-high',       mb: 115 },
]

// Демо: один голос. Premium — все встроенные + языки. Pro — плюс свои из папки voices-custom.
export const DEMO_VOICE = 'uk_tetiana'

export const voiceById = (id) => VOICES.find((v) => v.id === id) || null

// --- Рушій Piper (Python venv) ------------------------------------------------

const venvDir = (cacheDir) => path.join(cacheDir, 'piper-venv')
const venvPython = (cacheDir) => path.join(venvDir(cacheDir), process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python'))
const readyMarker = (cacheDir) => path.join(venvDir(cacheDir), '.tts-ready')

/** Готов ли движок озвучки (venv с piper-tts) */
export function ttsReady(cacheDir) {
  return fs.existsSync(readyMarker(cacheDir)) && fs.existsSync(venvPython(cacheDir))
}

/**
 * Ставит официальный Piper в свой venv (один раз) и чинит путь к данным espeak.
 * Нужен системный python3 (на macOS есть; на Windows ставится через winget в install.ps1).
 * Возвращает путь к python внутри venv.
 */
export async function ensurePiper(cacheDir, log) {
  const py = venvPython(cacheDir)
  if (ttsReady(cacheDir)) return py
  fs.mkdirSync(cacheDir, { recursive: true })
  const python3 = process.env.FARM_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  log?.('Готую рушій озвучки Piper (один раз)…')
  if (!fs.existsSync(py)) execFileSync(python3, ['-m', 'venv', venvDir(cacheDir)], { stdio: 'ignore' })
  log?.('Встановлюю Piper…')
  execFileSync(py, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', 'piper-tts'], { stdio: 'ignore' })
  // Баг piper-tts: espeak ищет данные в корне пакета, а они в подпапке espeak-ng-data.
  // Делаем ссылки (на Windows — копии, если нет прав на симлинк).
  try {
    const pkg = execFileSync(py, ['-c', 'import piper,os;print(os.path.dirname(piper.__file__))']).toString().trim()
    const ed = path.join(pkg, 'espeak-ng-data')
    if (fs.existsSync(ed)) {
      for (const name of fs.readdirSync(ed)) {
        const link = path.join(pkg, name)
        if (fs.existsSync(link)) continue
        try { fs.symlinkSync(path.join('espeak-ng-data', name), link) }
        catch { try { fs.cpSync(path.join(ed, name), link, { recursive: true }) } catch { /* пропускаем */ } }
      }
    }
  } catch (e) { log?.(`espeak-fix: ${e?.message || e}`) }
  fs.writeFileSync(readyMarker(cacheDir), new Date().toISOString())
  return py
}

// --- Голоса (ленивая загрузка) ------------------------------------------------

/** Качает модель одного голоса (.onnx + .onnx.json) в кэш, если её ещё нет. */
export async function ensureVoice(cacheDir, voiceId, log) {
  const v = voiceById(voiceId)
  if (!v) throw new Error(`unknown voice: ${voiceId}`)
  const dir = path.join(cacheDir, 'voices')
  fs.mkdirSync(dir, { recursive: true })
  const onnx = path.join(dir, `${v.id}.onnx`)
  const cfg = path.join(dir, `${v.id}.onnx.json`)
  for (const [file, suffix] of [[onnx, '.onnx'], [cfg, '.onnx.json']]) {
    if (fs.existsSync(file) && fs.statSync(file).size > 0) continue
    log?.(`Скачиваю голос ${v.name} (${v.mb} МБ, один раз)…`)
    const res = await fetch(`${VOICES_BASE}/${v.path}${suffix}`)
    if (!res.ok) throw new Error(`voice ${v.id}${suffix}: HTTP ${res.status}`)
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  return { onnx, cfg }
}

/** Скачан ли голос локально (для статуса в интерфейсе) */
export function voiceDownloaded(cacheDir, voiceId) {
  const dir = path.join(cacheDir, 'voices')
  return fs.existsSync(path.join(dir, `${voiceId}.onnx`)) && fs.existsSync(path.join(dir, `${voiceId}.onnx.json`))
}

/** Свои голоса Pro: .onnx рядом с .onnx.json в папке data/voices-custom */
export function customVoices(dataDir) {
  const dir = path.join(dataDir, 'voices-custom')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.onnx') && fs.existsSync(path.join(dir, `${n}.json`)))
    .map((n) => ({ id: `custom:${n.replace(/\.onnx$/, '')}`, lang: 'custom', gender: '', quality: 'custom', name: n.replace(/\.onnx$/, ''), desc: 'Свій голос', custom: path.join(dir, n), mb: 0 }))
}

function resolveModel(cacheDir, dataDir, voiceId) {
  if (voiceId.startsWith('custom:')) {
    const name = voiceId.slice(7)
    const onnx = path.join(dataDir, 'voices-custom', `${name}.onnx`)
    if (!fs.existsSync(onnx) || !fs.existsSync(`${onnx}.json`)) throw new Error(`custom voice missing: ${name}`)
    return { onnx }
  }
  return null // встроенный голос — качаем через ensureVoice
}

// --- Синтез -------------------------------------------------------------------

function wavSampleRate(file) {
  try {
    const out = execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file]).toString().trim()
    return parseInt(out, 10) || 22050
  } catch { return 22050 }
}

/** Сдвиг высоты голоса на n полутонов через ffmpeg (asetrate + компенсация темпа) */
async function pitchShift(input, output, semitones) {
  const sr = wavSampleRate(input)
  const factor = Math.pow(2, semitones / 12)
  const tempo = (1 / factor).toFixed(5)
  await ffmpeg(['-i', input, '-filter:a', `asetrate=${Math.round(sr * factor)},aresample=${sr},atempo=${tempo}`, output])
}

/**
 * Синтез речи в WAV.
 * { cacheDir, dataDir, text, voice, speed (0.5–2, 1 — норма), pitch (полутона, ±6), outWav }
 * Возвращает { wavPath, durationMs }.
 */
export async function synthesize({ cacheDir, dataDir, text, voice, speed = 1, pitch = 0, outWav, log }) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) throw new Error('empty text')
  const py = await ensurePiper(cacheDir, log)
  const custom = resolveModel(cacheDir, dataDir, voice)
  const model = custom ? custom.onnx : (await ensureVoice(cacheDir, voice, log)).onnx
  const lengthScale = (1 / Math.max(0.5, Math.min(2, Number(speed) || 1))).toFixed(3)
  const semis = Math.max(-6, Math.min(6, Number(pitch) || 0))
  const target = semis ? outWav.replace(/\.wav$/i, '.raw.wav') : outWav

  await new Promise((resolve, reject) => {
    // UTF-8 обязательно: иначе на Windows Python читает stdin в кодировке локали,
    // кириллица теряется, Piper получает пустой текст и пишет 0 кадров (wave error).
    const p = spawn(py, ['-m', 'piper', '-m', model, '-f', target, '--length-scale', lengthScale], {
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('error', reject)
    // piper пишет WARNING в stderr и при успехе — судим по коду и наличию файла
    p.on('close', (code) => (code === 0 && fs.existsSync(target) && fs.statSync(target).size > 44)
      ? resolve()
      : reject(new Error(`piper exited ${code}: ${err.slice(-400)}`)))
    p.stdin.on('error', () => {})
    p.stdin.write(clean)
    p.stdin.end()
  })
  if (semis) { await pitchShift(target, outWav, semis); fs.rmSync(target, { force: true }) }
  const info = await probe(outWav)
  return { wavPath: outWav, durationMs: Math.round((info.duration || 0) * 1000) }
}

/**
 * Полный голос за кадром: синтез + таймкоды слов (whisper) + готовые блоки субтитров
 * во ВРЕМЕНИ ролика (озвучка играет с начала клипа).
 */
export async function generateVoiceover({ cacheDir, dataDir, workDir, text, voice, lang = 'uk', speed = 1, pitch = 0, outWav, autoSubtitles = true, log, onProgress }) {
  onProgress?.(0.05)
  const { wavPath, durationMs } = await synthesize({ cacheDir, dataDir, text, voice, speed, pitch, outWav, log })
  let words = []
  let captions = []
  if (autoSubtitles) {
    onProgress?.(0.6)
    const voiceInfo = voiceById(voice)
    words = await transcribeWords({
      audioFile: wavPath, workDir, cacheDir, model: 'medium',
      language: (voiceInfo?.lang && voiceInfo.lang !== 'custom') ? voiceInfo.lang : (lang || 'auto'),
      onProgress: (p) => onProgress?.(0.6 + 0.4 * p), log: () => {},
    })
    captions = wordsToCaptions(words)
  }
  onProgress?.(1)
  return { wavPath, durationMs, words, captions }
}

/** Слова whisper → блоки субтитров (по паузам и длине), время уже в финале ролика */
export function wordsToCaptions(words, { maxWords = 5, maxGap = 0.6 } = {}) {
  const blocks = []
  let cur = null
  for (const w of words) {
    if (!w || typeof w.start !== 'number') continue
    const gap = cur ? w.start - cur.words[cur.words.length - 1].end : 0
    if (!cur || cur.words.length >= maxWords || gap > maxGap) {
      cur = { start: w.start, end: w.end, words: [] }
      blocks.push(cur)
    }
    cur.words.push({ text: w.text, start: w.start, end: w.end })
    cur.end = w.end
  }
  return blocks.map((b) => ({ start: Math.round(b.start * 1000) / 1000, end: Math.round(b.end * 1000) / 1000, style: 'block', words: b.words }))
}
