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
import { renderMedia, selectComposition, makeCancelSignal } from '@remotion/renderer'
import { probe, normalizeVoice, speechSegments, cutAudio, cutVideo, regionBrightness, ensureSfx, ensureDefaultMusic, ffmpeg } from './media.mjs'
import { transcribeWords } from './transcribe.mjs'
import { loadMemes } from './memes.mjs'
import { buildPlan, buildSlidesPlan, sanitize, MEME_DENSITY } from './plan.mjs'
import { portalRun, portalStock, PortalError } from './portal.mjs'
import { downloadStock } from './stock.mjs'
import { t } from './i18n.mjs'
import { createProject, storeProject, loadProject, projectDir, ensureProxies } from './projects.mjs'
import { projectToProps } from '../remotion/project.js'
import { resolveStyle, tierOf } from '../remotion/style.js'
import { fontFaces } from './gfonts.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Writable data (cache, work files, finished clips, own music, fonts and stickers). The desktop app runs the code from its
// read-only bundle and points FARM_DATA at the TyneFarm folder; the script install keeps everything in one folder.
export const DATA = process.env.FARM_DATA ? path.resolve(process.env.FARM_DATA) : ROOT
export const CACHE = path.join(DATA, '.cache')
export const OUT_DIR = path.join(DATA, 'Готово')

// Экран начинается чуть раньше (плавный переход), материал берём с запасом
const XFADE_SEC = 0.3
const IMAGE = /\.(jpe?g|png|webp|gif|heic|bmp)$/i

// Сборка композиции живёт во временной папке; прошлые копии (по 30 МБ на каждый запуск программы) убираем
function cleanOldBundles() {
  try {
    const tmp = os.tmpdir()
    for (const name of fs.readdirSync(tmp)) {
      if (!name.startsWith('remotion-webpack-bundle-')) continue
      const dir = path.join(tmp, name)
      if (Date.now() - fs.statSync(dir).mtimeMs > 10 * 60 * 1000) fs.rmSync(dir, { recursive: true, force: true })
    }
  } catch { /* не критично */ }
}

let bundlePromise = null
function getBundle() {
  if (!bundlePromise) {
    cleanOldBundles()
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

/** Картинка в JPEG до 2160 px по высоте: HEIC и прочие форматы, которые браузер рендера не покажет */
async function screenImage(input, output) {
  await ffmpeg(['-i', input, '-frames:v', '1', '-vf', "scale='min(2160,iw)':-2", '-q:v', '3', output])
}

/** Отмена задачи: проверяется между шагами и в рендере */
export class Cancelled extends Error {}
const checkCancel = (job) => { if (job.cancelled) throw new Cancelled('cancelled') }

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
    let src
    try { src = await probe(files.video) } catch { throw new Error(t(options.lang, 'notVideo')) }
    if (!src.width || !src.height || !src.duration) throw new Error(t(options.lang, 'notVideo'))
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

    checkCancel(job)
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

    checkCancel(job)
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
    // Материалы: кліп — 2–4 с (ритм коротких видео), картинка — 3 с. Битый файл пропускаем.
    const media = []
    for (let i = 0; i < items.length; i++) {
      checkCancel(job)
      const file = items[i]
      try {
        if (IMAGE.test(file)) {
          const out = path.join(dir, `screen-${i}.jpg`)
          await screenImage(file, out)
          media.push({ kind: 'image', file: out, dur: 3 })
        } else {
          const p = await probe(file)
          if (!p.width || !p.duration) throw new Error('not a video')
          const dur = Math.max(2, Math.min(4, p.duration))
          const out = path.join(dir, `screen-${i}.mp4`)
          await screenClip(file, Math.max(0, Math.min(p.duration - dur, p.duration * 0.15)), dur, out)
          media.push({ kind: 'video', file: out, dur })
        }
      } catch {
        say('skipped', { name: job.names?.[file] || String(i + 1) })
      }
      step('prepare', (i + 1) / items.length)
    }
    if (mode === 'clips' && !media.length) throw new Error(t(options.lang, 'needItems'))
    // Экранов: в «з кліпів» — по материалам; в «за інструкцією» — 6–10. Своих материалов мало —
    // между ними живые фоны под тему, чтобы не повторять одно и то же и не было пустого экрана.
    const count = mode === 'script' ? Math.max(6, Math.min(10, media.length || 8)) : Math.min(20, media.length)
    const screens = Array.from({ length: count }, (_, i) => {
      let m = null
      if (i < media.length) m = media[i]
      else if (media.length && i % 2 === 1) m = media[i % media.length]
      return { dur: m ? m.dur : 3, media: m ? { kind: m.kind, file: m.file } : null }
    })
    checkCancel(job)
    step('stickers')
    const memes = await loadMemes(CACHE, null, memeOpts)
    step('text')
    plan = await buildSlidesPlan({
      k: options.k, runId: run.runId, lang: options.lang, mode, title: options.title, hook: options.hook, notes: options.notes,
      screens, memes: memes.map((m) => ({ id: m.id, label: m.label })), maxSec: limits.maxSec, memeMood: options.memeMood,
      onText: () => say('text'), log: () => say('textRules'),
    })
    durationSec = plan.duration
    // Экраны без своих материалов: бесплатные стоковые клипы по теме, если они есть; иначе живой фон
    const empty = plan.screens.filter((sc) => !sc.media)
    if (empty.length) {
      checkCancel(job)
      say('stock')
      const queries = plan.stockQueries?.length ? plan.stockQueries : [sanitize(options.title).slice(0, 40)]
      const { clips = [] } = await portalStock(options.k, run.runId, queries, Math.min(12, empty.length))
      const got = clips.length ? await downloadStock(clips, path.join(CACHE, 'stock')) : []
      job.credits = []
      for (let i = 0; i < empty.length && got.length; i++) {
        const c = got[i % got.length]
        const sc = empty[i]
        const out = path.join(dir, `stock-${i}.mp4`)
        try {
          const len = Math.max(0, (c.duration || sc.dur + 1) - sc.dur - 0.2)
          await screenClip(c.file, Math.min(len, 1 + (i % 3)), sc.dur + XFADE_SEC, out)
          sc.media = { kind: 'video', file: out }
          if (!job.credits.some((x) => x.page === c.page)) job.credits.push({ source: c.source, author: c.author, page: c.page, thumb: c.thumb })
        } catch { /* остаётся живой фон */ }
      }
      say(job.credits.length ? 'stockDone' : 'stockNone', { n: job.credits.length })
    }
  }
  checkCancel(job)
  plan.limits = limits
  plan.landscape = !!job.landscape
  plan.duration = durationSec
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 1))
  // Цвет субтитров по яркости кадра и музыка (Pro) — один раз, дальше это часть проекта
  let captionColor = '#FFFFFF'
  if (plan.mode === 'cut' && !plan.landscape) {
    const b = await regionBrightness(path.join(dir, 'video.mp4'), durationSec, { x: 0.1, y: 0.6, w: 0.8, h: 0.17 })
    if (b > 0.68) captionColor = '#111111'
  }
  const musicFile = limits.music ? (firstFile(path.join(DATA, 'music'), /\.(mp3|m4a|wav|aac|ogg)$/i) || await ensureDefaultMusic(path.join(CACHE, 'music'))) : null
  const project = await createProject(DATA, job, plan, { captionColor, musicFile })
  job.projectId = project.id
  const out = await renderProject(job, project, { assetUrl, step })
  // Лёгкие копии для редактора готовим после ролика, не задерживая его
  ensureProxies(DATA, project).catch((e) => console.error(e))
  return out
}

/** Сборка ролика из проекта (первый раз, после правок в редакторе и в кабинете). */
export async function renderProject(job, project, { assetUrl, step, draft = false, tier }) {
  const say = job.say
  const dir = projectDir(DATA, project.id)
  const limits = project.limits || { watermark: true, music: false, fonts: false, ownStickers: false }
  step = step || progressTracker(job)
  step('render')
  say('montage')
  const memes = await loadMemes(CACHE, null, {
    only: new Set(project.plan.memes.map((m) => m.id)), packs: limits.ownStickers ? project.stickers?.packs : [], adult: limits.ownStickers && project.stickers?.adult,
    k: job.options?.k, localDir: limits.ownStickers ? path.join(DATA, 'stickers') : null,
  })
  await ensureSfx(path.join(CACHE, 'sfx'))
  // Стиль по текущему тарифу; шрифты Google — из кэша на компьютере. Свой шрифт из папки fonts — Pro
  // (у роликов без стиля — как раньше: свой шрифт, если он есть и тариф позволяет)
  const style = resolveStyle(project.style, tier || job.tier || job.run?.tier || tierOf(limits))
  const facesOf = async (id) => (id ? (await fontFaces(CACHE, id).catch(() => [])).map((f) => ({ src: assetUrl(f.file), weight: f.weight, style: f.style, unicodeRange: f.unicodeRange })) : null)
  const fontFacesProps = { hook: await facesOf(style.hookFont), sub: await facesOf(style.subFont) }
  const fontFile = limits.fonts && (project.style ? style.ownFont : true) ? firstFile(path.join(DATA, 'fonts'), /\.(ttf|otf|woff2?)$/i) : null
  const memeMap = {}
  for (const m of memes) memeMap[m.id] = { kind: m.kind, src: assetUrl(m.file) }
  const rollerFile = ['roller.png', 'roller.webp'].map((n) => path.join(DATA, 'assets', n)).find((p) => fs.existsSync(p))
  const inputProps = projectToProps(project, {
    url: (src) => assetUrl(path.join(dir, src)),
    memes: memeMap,
    sfx: Object.fromEntries(['click', 'type', 'pop', 'whoosh'].map((k) => [k, assetUrl(path.join(CACHE, 'sfx', `${k}.wav`))])),
    rollerSrc: rollerFile ? assetUrl(rollerFile) : null,
    fontSrc: fontFile ? assetUrl(fontFile) : null,
    style,
    fontFaces: fontFacesProps,
  })

  const serveUrl = await getBundle()
  const browserExecutable = process.env.FARM_CHROME || null
  const composition = await selectComposition({ serveUrl, id: 'Farm', inputProps, browserExecutable })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  let out = draft ? path.join(dir, `draft-${stamp}.mp4`) : path.join(OUT_DIR, `${safeName(project.title || 'tyne')} ${stamp}.mp4`)
  // Никогда не перезаписываем готовый ролик
  for (let n = 2; fs.existsSync(out); n++) out = out.replace(/( \(\d+\))?\.mp4$/, ` (${n}).mp4`)
  const { cancelSignal, cancel } = makeCancelSignal()
  job.cancelRender = cancel
  say(draft ? 'draft' : 'render')
  await renderMedia({
    composition, serveUrl, codec: 'h264', crf: draft ? 30 : 18,
    ...(draft ? { scale: 0.5, x264Preset: 'veryfast' } : {}),
    audioCodec: 'aac', audioBitrate: '192k', pixelFormat: 'yuv420p', outputLocation: out, inputProps, browserExecutable,
    concurrency: Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2))),
    onProgress: ({ progress }) => step('render', progress),
    cancelSignal,
  }).catch((e) => { if (job.cancelled) throw new Cancelled('cancelled'); throw e })
  job.cancelRender = null
  job.result = out
  job.isDraft = draft
  if (!draft) {
    // Пока шла сборка, редактор мог сохранить новые правки: дописываем только готовый файл к свежей версии
    const fresh = loadProject(DATA, project.id) || project
    fresh.outputs = [...(fresh.outputs || []), { file: path.basename(out), at: Date.now() }]
    storeProject(DATA, fresh)
    project.outputs = fresh.outputs
  }
  say(draft ? 'draftDone' : 'done', { file: path.basename(out) })
  if (job.run?.tier === 'demo' && job.run.left === 0) say('limitLeft')
  return out
}

export { MEME_DENSITY }
