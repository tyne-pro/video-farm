// ============================================================================
// Пайплайн одного ролика: пробы → синхрон → звук → джамп-каты → прокси →
// распознавание → мемы → план (Claude) → рендер Remotion.
// ============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import {
  probe, findAudioOffset, normalizeVoice, speechSegments, cutAudio, cutVideo,
  regionBrightness, ensureSfx, ensureDefaultMusic, ffmpeg,
} from './media.mjs'
import { transcribeWords } from './transcribe.mjs'
import { loadMemes } from './memes.mjs'
import { buildPlan, sanitize } from './plan.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Writable data (cache, work files, finished clips, own music and assets). The desktop app runs the code from its
// read-only bundle and points FARM_DATA at the TyneFarm folder; the script install keeps everything in one folder.
export const DATA = process.env.FARM_DATA ? path.resolve(process.env.FARM_DATA) : ROOT
export const CACHE = path.join(DATA, '.cache')
export const OUT_DIR = path.join(DATA, 'Готово')

let bundlePromise = null
function getBundle(log) {
  if (!bundlePromise) {
    log?.('Готовлю шаблон рендера (только первый раз)…')
    bundlePromise = bundle({ entryPoint: path.join(ROOT, 'remotion', 'index.jsx') })
      .catch((e) => { bundlePromise = null; throw e })
  }
  return bundlePromise
}

// Доли общего прогресса по шагам
const STEPS = [
  ['probe', 0.02], ['sync', 0.04], ['voice', 0.05], ['cuts', 0.03], ['proxy', 0.2],
  ['whisper', 0.25], ['memes', 0.03], ['plan', 0.06], ['render', 0.32],
]

function progressTracker(job) {
  const base = {}
  let acc = 0
  for (const [k, w] of STEPS) { base[k] = [acc, w]; acc += w }
  return (step, frac = 0) => {
    const [b, w] = base[step]
    job.step = step
    job.progress = Math.min(0.999, b + w * Math.max(0, Math.min(1, frac)))
    job.touch?.()
  }
}

function safeName(title) {
  return sanitize(title).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video'
}

/**
 * job: { id, dir, files: { head, tablet? }, options, log(), touch() }
 * options: { title, format, emoji, whisperModel, useClaude, stickerPacks,
 *            notes, memeDensity, memeMood, zooms, musicVolume }
 * assetUrl(absPath) — http-адрес локального файла для рендера.
 */
export async function runPipeline(job, { assetUrl }) {
  const { dir, files, options } = job
  const log = job.log
  const step = progressTracker(job)
  const format = options.format
  const needTablet = format !== 'talking'
  if (needTablet && !files.tablet) throw new Error('Для этого формата нужна запись планшета')

  // 1. Пробы
  step('probe')
  const head = await probe(files.head)
  const tablet = needTablet ? await probe(files.tablet) : null
  log(`Голова: ${head.width}×${head.height}, ${head.duration.toFixed(1)} с${head.hasAudio ? '' : ', без звука'}`)
  if (tablet) log(`Планшет: ${tablet.width}×${tablet.height}, ${tablet.duration.toFixed(1)} с${tablet.hasAudio ? '' : ', без звука'}`)
  const voiceSource = head.hasAudio ? files.head : tablet?.hasAudio ? files.tablet : null
  if (!voiceSource) throw new Error('Ни в одном файле нет звука — нечего распознавать')

  // 2. Синхрон планшета с головой по звуку
  step('sync')
  let shift = 0
  if (tablet && head.hasAudio && tablet.hasAudio) {
    const { offset, confidence } = await findAudioOffset(files.head, files.tablet)
    if (confidence >= 3) {
      shift = offset
      log(`Синхрон по звуку: планшет ${offset >= 0 ? 'позже' : 'раньше'} на ${Math.abs(offset).toFixed(2)} с (уверенность ${confidence.toFixed(1)})`)
    } else {
      log(`Синхрон по звуку неуверенный (${confidence.toFixed(1)}), ставлю записи с начала`)
    }
  } else if (tablet) {
    log('У одной из записей нет звука — синхроню по началу файлов')
  }
  // Если голос взят с планшета, время голоса = время планшета
  const voiceFromTablet = voiceSource === files.tablet

  // 3. Голос: вытягиваем громкость
  step('voice')
  const voiceFull = path.join(dir, 'voice-full.wav')
  if (voiceFromTablet && shift !== 0) {
    // Сдвигаем голос с планшета на шкалу головы
    const tmp = path.join(dir, 'voice-raw.wav')
    const af = shift > 0 ? `adelay=${Math.round(shift * 1000)}:all=1` : `atrim=start=${(-shift).toFixed(3)},asetpts=PTS-STARTPTS`
    await ffmpeg(['-i', files.tablet, '-vn', '-af', af, '-c:a', 'pcm_s16le', tmp])
    await normalizeVoice(tmp, voiceFull)
    fs.rmSync(tmp, { force: true })
  } else {
    await normalizeVoice(voiceSource, voiceFull)
  }
  step('voice', 1)

  // 4. Джамп-каты по тишине
  step('cuts')
  const segs = await speechSegments(voiceFull, head.duration)
  const cutDuration = segs.reduce((s, [a, b]) => s + (b - a), 0)
  log(`Джамп-каты: ${segs.length} кусков, ${head.duration.toFixed(1)} → ${cutDuration.toFixed(1)} с`)
  const voice = path.join(dir, 'voice.wav')
  await cutAudio(voiceFull, segs, voice, dir)
  fs.rmSync(voiceFull, { force: true })

  // 5. Прокси-видео с теми же склейками
  step('proxy')
  const headMax = format === 'horizontal' ? [1080, 1920] : [1080, 1920]
  await cutVideo(files.head, segs, path.join(dir, 'head.mp4'), dir, {
    maxW: headMax[0], maxH: headMax[1], totalDuration: head.duration,
    onProgress: (p) => step('proxy', p * (tablet ? 0.5 : 1)),
  })
  if (tablet) {
    await cutVideo(files.tablet, segs, path.join(dir, 'tablet.mp4'), dir, {
      maxW: 1920, maxH: 1080, shift, totalDuration: head.duration,
      onProgress: (p) => step('proxy', 0.5 + p * 0.5),
    })
  }

  // 6. Распознавание речи
  step('whisper')
  log('Распознаю речь (whisper.cpp)…')
  const words = await transcribeWords({
    audioFile: voice, workDir: dir, cacheDir: CACHE, model: options.whisperModel || 'medium',
    onProgress: (p) => step('whisper', p), log,
  })
  log(`Распознано слов: ${words.length}`)
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify(words, null, 1))

  // 7. Мемы
  step('memes')
  const memes = await loadMemes(CACHE, log, { packs: options.stickerPacks, adult: options.adultMemes })
  log(`Мемов в библиотеке: ${memes.length}`)

  // 8. План монтажа
  step('plan')
  const plan = await buildPlan({
    title: options.title, format, words, duration: cutDuration,
    memes: memes.map((m) => ({ id: m.id, label: m.label })),
    useClaude: options.useClaude !== false, log,
    notes: options.notes || '', memeDensity: options.memeDensity, memeMood: options.memeMood, zooms: options.zooms !== false,
  })
  log(`План: ${plan.source === 'claude' ? 'Claude' : 'по правилам'}; хук «${plan.hook.words.join(' ')}», мемов ${plan.memes.length}, зумов ${plan.zooms.length}, заголовков ${plan.headings.length}`)
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 1))

  return renderJob(job, { plan, memes, cutDuration, assetUrl, step })
}

/** Рендер по готовому плану (используется и для перерендера после правки). */
export async function renderJob(job, { plan, memes, cutDuration, assetUrl, step, draft }) {
  // Черновик: половина разрешения и быстрый пресет — чтобы проверить план
  // за пару минут, а финал рендерить один раз
  draft = draft ?? !!job.options?.draft
  const fileUrl = (name) => assetUrl(path.join(job.dir, name))
  const { dir, options } = job
  const log = job.log
  step = step || progressTracker(job)
  step('render')
  // Качаем только мемы из плана (кеш на диске исполнителя)
  memes = await loadMemes(CACHE, log, { only: new Set(plan.memes.map((m) => m.id)), packs: options.stickerPacks, adult: options.adultMemes })
  if (cutDuration == null) {
    cutDuration = (await probe(path.join(dir, 'voice.wav'))).duration
  }
  const format = options.format

  await ensureSfx(path.join(CACHE, 'sfx'))
  const musicFile = pickMusic() || await ensureDefaultMusic(path.join(CACHE, 'music'))

  // Цвет субтитров поверх видео: на светлом фоне — чёрный
  let captionColor = '#FFFFFF'
  if (format === 'talking') {
    const b = await regionBrightness(path.join(dir, 'head.mp4'), cutDuration, { x: 0.1, y: 0.6, w: 0.8, h: 0.17 })
    if (b > 0.68) captionColor = '#111111'
    log(`Яркость под субтитрами ${(b * 100).toFixed(0)}% → ${captionColor === '#FFFFFF' ? 'белые' : 'чёрные'} субтитры`)
  }

  const used = new Set(plan.memes.map((m) => m.id))
  const memeMap = {}
  for (const m of memes) {
    if (used.has(m.id)) memeMap[m.id] = { kind: m.kind, src: assetUrl(m.file) }
  }
  const rollerFile = ['roller.png', 'roller.webp'].map((n) => path.join(DATA, 'assets', n)).find((p) => fs.existsSync(p))
  const bgFile = ['background.jpg', 'background.png'].map((n) => path.join(DATA, 'assets', n)).find((p) => fs.existsSync(p))

  const inputProps = {
    format,
    durationSec: cutDuration,
    plan,
    headSrc: fileUrl('head.mp4'),
    tabletSrc: format === 'talking' ? null : fileUrl('tablet.mp4'),
    voiceSrc: fileUrl('voice.wav'),
    musicSrc: options.musicVolume === 0 ? null : assetUrl(musicFile),
    musicVolume: options.musicVolume != null ? options.musicVolume : Number(process.env.FARM_MUSIC_VOLUME || 0.03),
    sfx: Object.fromEntries(['click', 'type', 'pop', 'whoosh'].map((k) => [k, assetUrl(path.join(CACHE, 'sfx', `${k}.wav`))])),
    memes: memeMap,
    captionColor,
    emoji: options.emoji || '🍓',
    rollerSrc: rollerFile ? assetUrl(rollerFile) : null,
    backgroundSrc: bgFile ? assetUrl(bgFile) : null,
  }

  const serveUrl = await getBundle(log)
  // FARM_CHROME — свой Chrome вместо скачиваемого Remotion (для закрытых сетей)
  const browserExecutable = process.env.FARM_CHROME || null
  const composition = await selectComposition({ serveUrl, id: 'Farm', inputProps, browserExecutable })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const out = draft
    ? path.join(dir, `черновик-${stamp}.mp4`)
    : path.join(OUT_DIR, `${safeName(options.title)} — ${format} ${stamp}.mp4`)
  log(draft ? 'Рендер черновика (половина разрешения)…' : 'Рендер ролика…')
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: draft ? 30 : 18,
    ...(draft ? { scale: 0.5, x264Preset: 'veryfast' } : {}),
    audioCodec: 'aac',
    audioBitrate: '192k',
    pixelFormat: 'yuv420p',
    outputLocation: out,
    inputProps,
    browserExecutable,
    concurrency: Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2))),
    onProgress: ({ progress }) => step('render', progress),
  })
  job.result = out
  job.isDraft = draft
  log(draft ? 'Черновик готов. Проверь, поправь план и запусти финальный рендер.' : `Готово: ${out}`)
  return out
}

/** Своя музыка: любой mp3/m4a/wav из папки music/ рядом с генератором. */
function pickMusic() {
  const dir = path.join(DATA, 'music')
  if (!fs.existsSync(dir)) return null
  const list = fs.readdirSync(dir).filter((n) => /\.(mp3|m4a|wav|aac|ogg)$/i.test(n))
  if (!list.length) return null
  return path.join(dir, list[Math.floor(Math.random() * list.length)])
}
