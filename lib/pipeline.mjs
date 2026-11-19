// ============================================================================
// Один ролик, три режима:
//   cut    — порізати готове відео: паузи, субтитри, хук, зуми, стікери
//   clips  — зібрати з кліпів і картинок: екрани з текстом, стікери
//   script — згенерувати за інструкцією: тема → текст по екранах, матеріали автора або фон
// Перед роликом программа спрашивает кабинет: ключ и лимит тарифа. Весь монтаж — здесь.
// ============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { probe, normalizeVoice, speechSegments, cutAudio, cutVideo, regionBrightness, ensureSfx, ensureDefaultMusic, ffmpeg } from './media.mjs'
import { transcribeWords } from './transcribe.mjs'
import { loadMemes } from './memes.mjs'
import { buildPlan, buildSlidesPlan, sanitize, MEME_DENSITY } from './plan.mjs'
import { portalRun, PortalError } from './portal.mjs'
import { t } from './i18n.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Writable data (cache, work files, finished clips, own music, fonts and stickers). The desktop app runs the code from its
// read-only bundle and points FARM_DATA at the TyneFarm folder; the script install keeps everything in one folder.
export const DATA = process.env.FARM_DATA ? path.resolve(process.env.FARM_DATA) : ROOT
export const CACHE = path.join(DATA, '.cache')
export const OUT_DIR = path.join(DATA, 'Готово')

const IMAGE = /\.(jpe?g|png|webp|gif|heic|bmp)$/i

let bundlePromise = null
function getBundle() {
  if (!bundlePromise) {
    bundlePromise = bundle({ entryPoint: path.join(ROOT, 'remotion', 'index.jsx') })
      .catch((e) => { bundlePromise = null; throw e })
  }
  return bundlePromise
}

// Доли общего прогресса по шагам
const STEPS = [['check', 0.02], ['prepare', 0.2], ['speech', 0.25], ['text', 0.08], ['stickers', 0.03], ['render', 0.42]]

function progressTracker(job) {
  const base = {}
  let acc = 0
  for (const [k, w] of STEPS) { base[k] = [acc, w]; acc += w }
  return (step, frac = 0) => {
    const [b, w] = base[step]
    job.step = step
    job.progress = Math.min(0.999, b + w * Math.max(0, Math.min(1, frac)))
  }
}

function safeName(title) {
  return sanitize(title).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video'
}

const firstFile = (dir, re) => {
  if (!fs.existsSync(dir)) return null
  const list = fs.readdirSync(dir).filter((n) => re.test(n))
  return list.length ? path.join(dir, list[Math.floor(Math.random() * list.length)]) : null
}

/** Отрезок видео как экран 1080×1920 без звука (кадр заполняет экран) */
async function screenClip(input, start, dur, output) {
  await ffmpeg([
    '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', input, '-an',
    '-vf', 'fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-g', '30', output,
  ])
}

/**
 * job: { id, dir, files: { video?, items: [] }, options, log(), say(key, vars) }
 * options: { mode, lang, k, title, hook, notes, emoji, stickerPacks, adultMemes, memeDensity, memeMood, zooms, draft }
 */
export async function runPipeline(job, { assetUrl }) {
  const { dir, files, options } = job
  const say = job.say
  const step = progressTracker(job)
  const mode = options.mode

  // 1. Ключ и лимит тарифа
  step('check')
  say('check')
  let run
  try {
    run = await portalRun(options.k, mode, 0)
  } catch (e) {
    throw new Error(t(options.lang, e instanceof PortalError ? e.code : 'offline'))
  }
  job.run = run
  say('tier', { tier: run.tier, left: run.left })
  const limits = run.limits

  const ownStickers = limits.ownStickers
  const memeOpts = { packs: ownStickers ? options.stickerPacks : [], adult: ownStickers && options.adultMemes, k: options.k, localDir: ownStickers ? path.join(DATA, 'stickers') : null }

  let plan
  let durationSec
  if (mode === 'cut') {
    if (!files.video) throw new Error(t(options.lang, 'needVideo'))
    step('prepare')
    say('prepare')
    const src = await probe(files.video)
    let segs = [[0, src.duration]]
    if (src.hasAudio) {
      const voiceFull = path.join(dir, 'voice-full.wav')
      await normalizeVoice(files.video, voiceFull)
      segs = await speechSegments(voiceFull, src.duration)
      const cut = segs.reduce((s, [a, b]) => s + (b - a), 0)
      say('cuts', { from: src.duration.toFixed(1), to: cut.toFixed(1) })
      // Ограничение тарифа по длине: отрезаем хвост
      let acc = 0
      const kept = []
      for (const [a, b] of segs) {
        if (acc >= limits.maxSec) break
        const take = Math.min(b - a, limits.maxSec - acc)
        kept.push([a, a + take]); acc += take
      }
      if (acc < cut - 0.5) say('trimmed', { sec: limits.maxSec })
      segs = kept
      await cutAudio(voiceFull, segs, path.join(dir, 'voice.wav'), dir)
      fs.rmSync(voiceFull, { force: true })
    } else if (src.duration > limits.maxSec) {
      segs = [[0, limits.maxSec]]
      say('trimmed', { sec: limits.maxSec })
    }
    durationSec = segs.reduce((s, [a, b]) => s + (b - a), 0)
    await cutVideo(files.video, segs, path.join(dir, 'video.mp4'), dir, {
      maxW: 1080, maxH: 1920, totalDuration: src.duration, onProgress: (p) => step('prepare', p),
    })
    job.landscape = src.width > src.height * 1.05

    let words = []
    if (src.hasAudio) {
      step('speech')
      if (!fs.existsSync(path.join(CACHE, '.prepared-medium')) && !fs.existsSync(path.join(CACHE, 'whisper'))) say('firstRun')
      say('speech')
      words = await transcribeWords({
        audioFile: path.join(dir, 'voice.wav'), workDir: dir, cacheDir: CACHE, model: 'medium', language: 'auto',
        onProgress: (p) => step('speech', p), log: () => {},
      })
      say('words', { n: words.length })
    } else {
      say('noSpeech')
    }
    fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify(words))

    step('stickers')
    const memes = await loadMemes(CACHE, null, memeOpts)
    step('text')
    plan = await buildPlan({
      k: options.k, runId: run.runId, lang: options.lang, title: options.title, hook: options.hook, notes: options.notes,
      words, memes: memes.map((m) => ({ id: m.id, label: m.label })), duration: durationSec,
      memeDensity: options.memeDensity, memeMood: options.memeMood, zooms: options.zooms !== false,
      onText: () => say('text'), log: () => say('textRules'),
    })
  } else {
    const items = files.items || []
    if (mode === 'clips' && !items.length) throw new Error(t(options.lang, 'needItems'))
    if (mode === 'script' && !sanitize(options.title)) throw new Error(t(options.lang, 'needTopic'))
    step('prepare')
    say('prepare')
    // Материалы: кліп — до 5 с, картинка — 3 с
    const media = []
    for (let i = 0; i < items.length; i++) {
      const file = items[i]
      if (IMAGE.test(file)) { media.push({ kind: 'image', file, dur: 3 }); continue }
      const p = await probe(file)
      const dur = Math.max(1.5, Math.min(5, p.duration || 3))
      const out = path.join(dir, `screen-${i}.mp4`)
      await screenClip(file, Math.max(0, Math.min((p.duration || 0) - dur, (p.duration || 0) * 0.15)), dur, out)
      media.push({ kind: 'video', file: out, dur })
      step('prepare', (i + 1) / items.length)
    }
    // Экранов: столько, сколько материалов; для «за інструкцією» — 6–10 строк по материалам по кругу
    const count = mode === 'script' ? Math.max(6, Math.min(10, media.length || 8)) : Math.min(20, media.length)
    const screens = Array.from({ length: count }, (_, i) => {
      const m = media.length ? media[i % media.length] : null
      return { dur: m ? m.dur : 3, media: m ? { kind: m.kind, file: m.file } : null }
    })
    step('stickers')
    const memes = await loadMemes(CACHE, null, memeOpts)
    step('text')
    plan = await buildSlidesPlan({
      k: options.k, runId: run.runId, lang: options.lang, mode, title: options.title, hook: options.hook, notes: options.notes,
      screens, memes: memes.map((m) => ({ id: m.id, label: m.label })), maxSec: limits.maxSec, memeMood: options.memeMood,
      onText: () => say('text'), log: () => say('textRules'),
    })
    durationSec = plan.duration
  }
  plan.limits = limits
  plan.landscape = !!job.landscape
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 1))
  return renderJob(job, { plan, durationSec, assetUrl, step })
}

/** Рендер по готовому плану (и для перерендера после правки). */
export async function renderJob(job, { plan, durationSec, assetUrl, step, draft }) {
  draft = draft ?? !!job.options?.draft
  const { dir, options } = job
  const say = job.say
  const limits = plan.limits || { watermark: true, music: false, fonts: false, ownStickers: false }
  step = step || progressTracker(job)
  step('render')
  say('montage')
  const memes = await loadMemes(CACHE, null, {
    only: new Set(plan.memes.map((m) => m.id)), packs: limits.ownStickers ? options.stickerPacks : [], adult: limits.ownStickers && options.adultMemes,
    k: options.k, localDir: limits.ownStickers ? path.join(DATA, 'stickers') : null,
  })
  if (durationSec == null) durationSec = plan.duration ?? (await probe(path.join(dir, 'video.mp4'))).duration

  await ensureSfx(path.join(CACHE, 'sfx'))
  // Музыка и свои шрифты — с тарифом Pro
  const musicFile = limits.music ? (firstFile(path.join(DATA, 'music'), /\.(mp3|m4a|wav|aac|ogg)$/i) || await ensureDefaultMusic(path.join(CACHE, 'music'))) : null
  const fontFile = limits.fonts ? firstFile(path.join(DATA, 'fonts'), /\.(ttf|otf|woff2?)$/i) : null

  let captionColor = '#FFFFFF'
  if (plan.mode === 'cut' && !plan.landscape) {
    const b = await regionBrightness(path.join(dir, 'video.mp4'), durationSec, { x: 0.1, y: 0.6, w: 0.8, h: 0.17 })
    if (b > 0.68) captionColor = '#111111'
  }
  const memeMap = {}
  const used = new Set(plan.memes.map((m) => m.id))
  for (const m of memes) if (used.has(m.id)) memeMap[m.id] = { kind: m.kind, src: assetUrl(m.file) }
  const rollerFile = ['roller.png', 'roller.webp'].map((n) => path.join(DATA, 'assets', n)).find((p) => fs.existsSync(p))

  const inputProps = {
    mode: plan.mode,
    durationSec,
    plan,
    landscape: !!plan.landscape,
    videoSrc: plan.mode === 'cut' ? assetUrl(path.join(dir, 'video.mp4')) : null,
    voiceSrc: plan.mode === 'cut' && fs.existsSync(path.join(dir, 'voice.wav')) ? assetUrl(path.join(dir, 'voice.wav')) : null,
    screens: (plan.screens || []).map((s) => ({ ...s, media: s.media ? { kind: s.media.kind, src: assetUrl(s.media.file) } : null })),
    musicSrc: musicFile ? assetUrl(musicFile) : null,
    musicVolume: plan.mode === 'cut' ? 0.05 : 0.35,
    sfx: Object.fromEntries(['click', 'type', 'pop', 'whoosh'].map((k) => [k, assetUrl(path.join(CACHE, 'sfx', `${k}.wav`))])),
    memes: memeMap,
    captionColor,
    emoji: options.emoji || '',
    rollerSrc: rollerFile ? assetUrl(rollerFile) : null,
    fontSrc: fontFile ? assetUrl(fontFile) : null,
    watermark: !!limits.watermark,
  }

  const serveUrl = await getBundle()
  const browserExecutable = process.env.FARM_CHROME || null
  const composition = await selectComposition({ serveUrl, id: 'Farm', inputProps, browserExecutable })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const out = draft ? path.join(dir, `draft-${stamp}.mp4`) : path.join(OUT_DIR, `${safeName(options.title || 'tyne')} ${stamp}.mp4`)
  say(draft ? 'draft' : 'render')
  await renderMedia({
    composition, serveUrl, codec: 'h264', crf: draft ? 30 : 18,
    ...(draft ? { scale: 0.5, x264Preset: 'veryfast' } : {}),
    audioCodec: 'aac', audioBitrate: '192k', pixelFormat: 'yuv420p', outputLocation: out, inputProps, browserExecutable,
    concurrency: Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2))),
    onProgress: ({ progress }) => step('render', progress),
  })
  job.result = out
  job.isDraft = draft
  say(draft ? 'draftDone' : 'done', { file: path.basename(out) })
  if (job.run?.tier === 'demo' && job.run.left === 0) say('limitLeft')
  return out
}

export { MEME_DENSITY }
