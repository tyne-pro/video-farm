// ============================================================================
// Распознавание речи: whisper.cpp через @remotion/install-whisper-cpp.
// Возвращает слова с таймкодами (сек) на уже нарезанной (джамп-каты) дорожке.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  installWhisperCpp, downloadWhisperModel, transcribe,
} from '@remotion/install-whisper-cpp'
import { ffmpeg } from './media.mjs'

export const WHISPER_VERSION = '1.5.5'
const WIN_ZIP = 'https://remotion-ffmpeg-binaries.s3.eu-central-1.amazonaws.com/whisper-bin-x64-1-5-5.zip'

/**
 * Windows: готовая сборка распаковывается встроенным tar (есть в Windows 10 и 11). Распаковка через
 * PowerShell Expand-Archive ломается, если программу запустили из PowerShell 7 (чужой путь модулей).
 */
async function installWindows(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const zip = path.join(dir, 'whisper-bin-x64.zip')
  const res = await fetch(WIN_ZIP)
  if (!res.ok) throw new Error(`whisper download: HTTP ${res.status}`)
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  execFileSync(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', dir], { stdio: 'ignore', windowsHide: true })
  fs.rmSync(zip, { force: true })
}

export async function ensureWhisper(cacheDir, model, log) {
  const dir = path.join(cacheDir, 'whisper')
  log?.('Проверяю whisper.cpp…')
  // Сборка 1.5.5: программа main (main.exe) в корне папки
  const exe = path.join(dir, process.platform === 'win32' ? 'main.exe' : 'main')
  if (process.platform === 'win32') {
    if (!fs.existsSync(exe)) await installWindows(dir)
  } else {
    await installWhisperCpp({ to: dir, version: WHISPER_VERSION, printOutput: false })
  }
  if (!fs.existsSync(exe)) throw new Error(`speech recognition is not installed: ${path.basename(exe)} is missing`)
  let lastPct = -1
  await downloadWhisperModel({
    model,
    folder: dir,
    printOutput: false,
    onProgress: (downloaded, total) => {
      const pct = Math.floor((downloaded / (total || 1)) * 100)
      if (pct !== lastPct && pct % 10 === 0) log?.(`Скачиваю модель распознавания ${model}: ${pct}%`)
      lastPct = pct
    },
  })
  return dir
}

/** Слова [{ text, start, end }] из 16 кГц WAV. */
export async function transcribeWords({ audioFile, workDir, cacheDir, model = 'medium', language = 'ru', onProgress, log }) {
  const whisperPath = await ensureWhisper(cacheDir, model, log)
  const wav16 = path.join(workDir, 'voice16k.wav')
  await ffmpeg(['-i', audioFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav16])
  const out = await transcribe({
    inputPath: wav16,
    whisperPath,
    whisperCppVersion: WHISPER_VERSION,
    model,
    modelFolder: whisperPath,
    tokenLevelTimestamps: false,
    tokensPerItem: 1,
    splitOnWord: true,
    language,
    printOutput: false,
    onProgress,
  })
  fs.rmSync(wav16, { force: true })
  const words = []
  for (const item of out.transcription) {
    const text = item.text.trim()
    if (!text || /^\[.*\]$/.test(text)) continue
    // Пунктуация отдельным «словом» прилипает к предыдущему
    if (/^[.,!?…:;»)]+$/.test(text) && words.length) {
      words[words.length - 1].text += text
      continue
    }
    words.push({ text, start: item.offsets.from / 1000, end: item.offsets.to / 1000 })
  }
  // Whisper иногда даёт нулевую длину — растягиваем до следующего слова
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1]
    if (words[i].end <= words[i].start) words[i].end = next ? next.start : words[i].start + 0.3
  }
  return words
}
