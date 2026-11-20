// ============================================================================
// Проекты роликов на этом компьютере: ~/TyneFarm/.projects/<id>/
//   project.json — монтаж (свой формат, remotion/project.js)
//   медиа ролика (порезанное видео, голос, кліпи, музыка) и исходник для «Оригінал»
//   proxy/ — лёгкие копии 540p, полоски кадров и волна звука для редактора
// Готовые ролики лежат в «Готово». Удалённое 7 дней хранится в .trash и восстанавливается.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { ffmpeg, probe, run } from './media.mjs'
import { PROJECT_VERSION, newId, totalDuration } from '../remotion/project.js'
import { FONT, PRESETS, ACCENT_MODES, BACKINGS } from '../remotion/style.js'
import { outDir } from './desk.mjs'
import { buildSfx } from './plan.mjs'

export function projectPaths(DATA) {
  return { PROJECTS: path.join(DATA, '.projects'), TRASH: path.join(DATA, '.trash'), OUT_DIR: outDir(DATA) }
}

const ID = /^[a-f0-9]{6,32}$/
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const writeJson = (file, data) => { fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1)); fs.renameSync(`${file}.tmp`, file) }

export function projectDir(DATA, id) {
  if (!ID.test(String(id))) throw new Error('bad id')
  return path.join(projectPaths(DATA).PROJECTS, id)
}

export function loadProject(DATA, id) {
  const file = path.join(projectDir(DATA, id), 'project.json')
  return fs.existsSync(file) ? readJson(file) : null
}

export function storeProject(DATA, project) {
  project.updatedAt = Date.now()
  writeJson(path.join(projectDir(DATA, project.id), 'project.json'), project)
  return project
}

/**
 * Проект из готовой задачи: папка задачи переезжает в .projects (её больше не чистит уборка),
 * пути в плане становятся именами файлов проекта.
 */
export async function createProject(DATA, job, plan, { captionColor, musicFile } = {}) {
  const { PROJECTS } = projectPaths(DATA)
  fs.mkdirSync(PROJECTS, { recursive: true })
  const dir = path.join(PROJECTS, job.id)
  if (job.dir !== dir) {
    fs.renameSync(job.dir, dir)
    job.dir = dir
  }
  const rel = (abs) => (abs ? path.basename(abs) : null)
  const len = async (name) => { try { return (await probe(path.join(dir, name))).duration || null } catch { return null } }

  let clips
  if (plan.mode === 'cut') {
    const dur = plan.duration ?? (await probe(path.join(dir, 'video.mp4'))).duration
    clips = [{ id: newId(), kind: 'main', src: 'video.mp4', srcIn: 0, base: 0, dur, srcLen: dur }]
  } else {
    clips = []
    for (const [i, sc] of (plan.screens || []).entries()) {
      const m = sc.media
      const src = m ? rel(m.file) : null
      clips.push({
        id: newId(), kind: m ? m.kind : 'bg', src, srcIn: 0, base: sc.start, dur: sc.dur, bg: i,
        srcLen: m?.kind === 'video' ? await len(src) : null,
      })
    }
  }
  const original = job.files?.video && fs.existsSync(path.join(dir, path.basename(job.files.video))) ? path.basename(job.files.video) : null
  let music = null
  if (musicFile && plan.limits?.music) {
    const name = `music${path.extname(musicFile)}`
    fs.copyFileSync(musicFile, path.join(dir, name))
    const total = clips.reduce((s, c) => s + c.dur, 0)
    music = { src: name, start: 0, srcIn: 0, dur: total, volume: plan.mode === 'cut' ? 0.05 : 0.35, loop: true, toEnd: true, srcLen: await len(name) }
  }
  const { screens, limits, landscape, mode, duration, source, stockQueries, ...rest } = plan
  const project = {
    v: PROJECT_VERSION,
    id: job.id,
    title: job.options?.title || plan.title || 'tyne',
    mode,
    lang: job.options?.lang || 'uk',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    limits,
    maxSec: limits?.maxSec || 60,
    landscape: !!landscape,
    captionColor: captionColor || '#FFFFFF',
    emoji: job.options?.emoji || '',
    plan: rest,
    clips,
    voice: mode === 'cut' && fs.existsSync(path.join(dir, 'voice.wav')) ? 'voice.wav' : null,
    music,
    original,
    outputs: [],
    credits: job.credits || [],
    stickers: { packs: job.options?.stickerPacks || [], adult: !!job.options?.adultMemes, off: job.options?.stickers === false },
  }
  return storeProject(DATA, project)
}

// --- Лёгкие копии для редактора --------------------------------------------------------

const PROXY_H = 960

/** Копия 540p для плеера (частые ключевые кадры — быстрая перемотка), полоска кадров, волна звука */
export async function ensureProxies(DATA, project) {
  const dir = projectDir(DATA, project.id)
  const px = path.join(dir, 'proxy')
  fs.mkdirSync(px, { recursive: true })
  const videos = new Set()
  const images = new Set()
  for (const c of project.clips) {
    if (!c.src) continue
    if (c.kind === 'image') images.add(c.src)
    else videos.add(c.src)
  }
  for (const src of videos) {
    const file = path.join(dir, src)
    if (!fs.existsSync(file)) continue
    const base = path.join(px, path.parse(src).name)
    if (!fs.existsSync(`${base}.mp4`)) {
      await ffmpeg(['-i', file, '-an', '-vf', `scale=-2:'min(${PROXY_H},ih)',fps=30,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '10', '-movflags', '+faststart', `${base}.tmp.mp4`])
      fs.renameSync(`${base}.tmp.mp4`, `${base}.mp4`)
    }
    if (!fs.existsSync(`${base}.jpg`)) {
      // Кадр каждые полсекунды, 54×96, в одну полоску
      await ffmpeg(['-i', file, '-vf', 'fps=2,scale=54:96:force_original_aspect_ratio=increase,crop=54:96,tile=600x1', '-frames:v', '1', '-q:v', '5', `${base}.jpg`]).catch(() => {})
    }
  }
  for (const src of images) {
    const out = path.join(px, `${path.parse(src).name}.jpg`)
    if (!fs.existsSync(out)) await ffmpeg(['-i', path.join(dir, src), '-frames:v', '1', '-vf', `scale=-2:'min(${PROXY_H},ih)'`, '-q:v', '4', out]).catch(() => {})
  }
  // Длины файлов проекта: сколько можно растянуть клип и что предложить в «Мої файли»
  const lensFile = path.join(px, 'lens.json')
  const lens = fs.existsSync(lensFile) ? readJson(lensFile) : {}
  let changed = false
  for (const name of new Set([...listMedia(dir), ...videos])) {
    if (lens[name] !== undefined || /\.(jpe?g|png|webp)$/i.test(name)) continue
    try { lens[name] = (await probe(path.join(dir, name))).duration || null } catch { lens[name] = null }
    changed = true
  }
  if (changed) writeJson(lensFile, lens)
  for (const src of [project.voice, project.music?.src].filter(Boolean)) {
    const out = path.join(px, `${path.parse(src).name}.peaks.json`)
    if (!fs.existsSync(out) && fs.existsSync(path.join(dir, src))) fs.writeFileSync(out, JSON.stringify(await peaks(path.join(dir, src))))
  }
}

/** Волна звука: 50 значений 0–100 в секунду */
async function peaks(file) {
  const rate = 2000
  const { stdout } = await ffmpeg(['-i', file, '-ac', '1', '-ar', String(rate), '-f', 's16le', 'pipe:1'])
  const n = Math.floor(stdout.length / 2)
  const step = rate / 50
  const out = []
  for (let i = 0; i < n; i += step) {
    let m = 0
    for (let j = i; j < Math.min(n, i + step); j++) m = Math.max(m, Math.abs(stdout.readInt16LE(j * 2)))
    out.push(Math.round(Math.min(1, m / 22000) * 100))
  }
  return { rate: 50, data: out }
}

/** Файлы проекта для редактора: что показывать в плеере и на дорожках */
export function mediaInfo(DATA, project, assetUrl) {
  const dir = projectDir(DATA, project.id)
  const px = path.join(dir, 'proxy')
  const out = {}
  let lens = {}
  try { lens = readJson(path.join(px, 'lens.json')) } catch { /* ещё не посчитаны */ }
  const add = (src) => {
    if (!src || out[src]) return
    const name = path.parse(src).name
    const has = (ext) => fs.existsSync(path.join(px, name + ext))
    const image = /\.(jpe?g|png|webp)$/i.test(src)
    out[src] = {
      full: assetUrl(path.join(dir, src)),
      preview: image ? (has('.jpg') ? assetUrl(path.join(px, `${name}.jpg`)) : assetUrl(path.join(dir, src))) : (has('.mp4') ? assetUrl(path.join(px, `${name}.mp4`)) : assetUrl(path.join(dir, src))),
      strip: !image && has('.jpg') ? assetUrl(path.join(px, `${name}.jpg`)) : null,
      peaks: has('.peaks.json') ? assetUrl(path.join(px, `${name}.peaks.json`)) : null,
      kind: image ? 'image' : 'video',
      len: lens[src] ?? null,
      inBin: false,
    }
  }
  for (const c of project.clips) add(c.src)
  add(project.voice)
  add(project.music?.src)
  for (const f of listMedia(dir)) { add(f); out[f].inBin = true }
  return out
}

/** Файлы в проекте, которые можно поставить на дорожку (своё, кліпи, стоки) */
export function listMedia(dir) {
  return fs.readdirSync(dir).filter((n) => /^(video|screen-\d+|stock-\d+|add-[\w-]+)\.(mp4|jpe?g|png|webp)$/i.test(n)).sort()
}

// --- Список, удаление, восстановление --------------------------------------------------

/** Готовый ролик: в своей папке (если папку «Готово» меняли в настройках) или в текущей */
const outPath = (DATA, name, dir) => path.join(dir && path.isAbsolute(dir) ? dir : path.join(DATA, 'Готово'), path.basename(name))
/** Где лежит готовый ролик по имени: в текущей папке «Готово» или в стандартной */
export function findOutput(DATA, name) {
  for (const dir of [outDir(DATA), path.join(DATA, 'Готово')]) {
    const f = path.join(dir, path.basename(name))
    if (fs.existsSync(f)) return f
  }
  return null
}

export function listProjects(DATA) {
  const { PROJECTS, OUT_DIR } = projectPaths(DATA)
  const items = []
  const linked = new Set()
  if (fs.existsSync(PROJECTS)) {
    for (const id of fs.readdirSync(PROJECTS)) {
      if (!ID.test(id)) continue
      let p
      try { p = loadProject(DATA, id) } catch { continue }
      if (!p) continue
      const outputs = (p.outputs || []).filter((o) => fs.existsSync(outPath(DATA, o.file, o.dir)))
      outputs.forEach((o) => linked.add(o.file))
      items.push({ id, title: p.title, mode: p.mode, createdAt: p.createdAt, updatedAt: p.updatedAt, duration: totalDuration(p), outputs, hasOriginal: !!p.original, edited: p.updatedAt > (outputs.at(-1)?.at || 0) + 1000, thumb: p.clips[0]?.src || null })
    }
  }
  // Ролики без проекта (сделанные до редактора): скачать, показать в папке, удалить
  if (fs.existsSync(OUT_DIR)) {
    for (const name of fs.readdirSync(OUT_DIR)) {
      if (!/\.mp4$/i.test(name) || linked.has(name)) continue
      const st = fs.statSync(path.join(OUT_DIR, name))
      items.push({ id: null, file: name, title: name.replace(/ \d{4}-\d\d-\d\d-[\d-]+( \(\d+\))?\.mp4$/i, '').replace(/\.mp4$/i, ''), createdAt: st.mtimeMs, updatedAt: st.mtimeMs, outputs: [{ file: name, at: st.mtimeMs }] })
    }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** В корзину на 7 дней: папка проекта и его готовые ролики (или один ролик без проекта) */
/** Перенос с запасным копированием: папка «Готово» может быть на другом диске */
function move(src, dst) {
  try { fs.renameSync(src, dst) } catch (e) {
    if (e.code !== 'EXDEV') throw e
    fs.cpSync(src, dst, { recursive: true })
    fs.rmSync(src, { recursive: true, force: true })
  }
}

export function trashItem(DATA, { id, file }) {
  const { TRASH } = projectPaths(DATA)
  const stamp = `${Date.now()}`
  const box = path.join(TRASH, `${stamp}-${id || 'file'}`)
  fs.mkdirSync(box, { recursive: true })
  const moved = { id: id || null, files: [] }
  const put = (src) => { const name = path.basename(src); move(src, path.join(box, name)); moved.files.push({ name, dir: path.dirname(src) }) }
  if (id) {
    const p = loadProject(DATA, id)
    if (!p) throw new Error('no project')
    for (const o of p.outputs || []) {
      const src = outPath(DATA, o.file, o.dir)
      if (fs.existsSync(src)) put(src)
    }
    move(projectDir(DATA, id), path.join(box, 'project'))
  } else {
    const src = findOutput(DATA, file)
    if (!src) throw new Error('no file')
    put(src)
  }
  writeJson(path.join(box, 'trash.json'), moved)
  return path.basename(box)
}

export function restoreItem(DATA, token) {
  const { TRASH } = projectPaths(DATA)
  if (!/^\d+-[\w]+$/.test(token)) throw new Error('bad token')
  const box = path.join(TRASH, token)
  const info = readJson(path.join(box, 'trash.json'))
  for (const f of info.files) {
    const name = typeof f === 'string' ? f : f.name
    const dir = typeof f === 'string' ? path.join(DATA, 'Готово') : f.dir
    fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(path.join(dir, name))) move(path.join(box, name), path.join(dir, name))
  }
  if (info.id) move(path.join(box, 'project'), projectDir(DATA, info.id))
  fs.rmSync(box, { recursive: true, force: true })
}

export function purgeTrash(DATA, days = 7) {
  const { TRASH } = projectPaths(DATA)
  if (!fs.existsSync(TRASH)) return
  for (const name of fs.readdirSync(TRASH)) {
    const at = Number(name.split('-')[0])
    if (at && Date.now() - at > days * 864e5) fs.rmSync(path.join(TRASH, name), { recursive: true, force: true })
  }
}

/** Показать файл в Finder / Проводнике / файловом менеджере */
export function reveal(file) {
  if (process.platform === 'darwin') return run('open', ['-R', file])
  if (process.platform === 'win32') return run('explorer', [`/select,${file}`]).catch(() => {})
  return run('xdg-open', [path.dirname(file)])
}

// --- Правки из редактора -------------------------------------------------------------

const KINDS = new Set(['main', 'video', 'image', 'bg'])
const num = (x, min, max) => Math.max(min, Math.min(max, Number(x) || 0))

// Параметры озвучки от редактора. Сгенерированные сервером поля (wav, captions,
// durationMs) переносим из прошлой версии — их пишет только эндпоинт /tts/generate.
function cleanVoiceover(vo, prev) {
  const voice = typeof vo.voice === 'string' ? vo.voice.replace(/[^\w:.-]/g, '').slice(0, 60) : (prev?.voice || '')
  return {
    enabled: vo.enabled !== false,
    textSource: vo.textSource === 'subtitles' ? 'subtitles' : 'manual',
    text: typeof vo.text === 'string' ? vo.text.slice(0, 5000) : (prev?.text || ''),
    voice,
    lang: ['uk', 'ru', 'en'].includes(vo.lang) ? vo.lang : (prev?.lang || 'uk'),
    speed: vo.speed == null ? (prev?.speed ?? 1) : num(vo.speed, 0.5, 2),
    pitch: vo.pitch == null ? (prev?.pitch ?? 0) : Math.max(-6, Math.min(6, Number(vo.pitch) || 0)),
    volume: vo.volume == null ? (prev?.volume ?? 1) : num(vo.volume, 0, 1.5),
    mode: vo.mode === 'overlay' ? 'overlay' : 'replace',
    autoSubtitles: vo.autoSubtitles !== false,
    wav: prev?.wav || null,
    durationMs: prev?.durationMs || null,
    captions: Array.isArray(prev?.captions) ? prev.captions : [],
  }
}

const HEX = /^#[0-9a-f]{6}$/i
const str = (x, max) => String(x ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)

/** Стиль ролика как его прислал редактор; что разрешено тарифом, решает сборка (resolveStyle) */
function cleanStyle(st) {
  return {
    preset: PRESETS[st.preset] ? st.preset : 'classic',
    hookFont: st.hookFont === null ? null : FONT[st.hookFont] ? st.hookFont : undefined,
    subFont: st.subFont === null ? null : FONT[st.subFont] ? st.subFont : undefined,
    text: st.text === null ? null : HEX.test(st.text || '') ? st.text : undefined,
    accent: HEX.test(st.accent || '') ? st.accent : undefined,
    accentMode: ACCENT_MODES.includes(st.accentMode) ? st.accentMode : undefined,
    backing: BACKINGS.includes(st.backing) ? st.backing : undefined,
    ownFont: st.ownFont === true,
  }
}

/** Тексты из редактора: субтитры (слова, время, акценты), заголовки и хук */
function cleanPlan(plan, prev) {
  const out = {}
  const t = (x) => num(x, 0, 1e7)
  if (Array.isArray(plan.captions)) {
    out.captions = plan.captions.slice(0, 600).map((b) => {
      const words = (Array.isArray(b.words) ? b.words : []).slice(0, 40).map((w) => ({ text: str(w.text, 40), start: t(w.start), end: t(w.end), accent: w.accent === true })).filter((w) => w.text)
      return { start: t(b.start), end: Math.max(t(b.start) + 0.1, t(b.end)), style: b.style === 'line' ? 'line' : 'block', pos: ['left', 'right', 'center'].includes(b.pos) ? b.pos : 'center', words }
    }).filter((b) => b.words.length).sort((a, b) => a.start - b.start)
  }
  if (Array.isArray(plan.headings)) {
    out.headings = plan.headings.slice(0, 60).map((h) => ({ start: t(h.start), dur: num(h.dur, 0.3, 10), text: str(h.text, 80) })).filter((h) => h.text)
  }
  // Стікери: редактор може прибрати всі (memes: []) або прислати очищений список
  if (Array.isArray(plan.memes)) {
    out.memes = plan.memes.slice(0, 200).map((m) => ({ start: t(m.start), dur: num(m.dur, 0.3, 10), id: str(m.id, 64) })).filter((m) => m.id)
  }
  if (plan.hook && typeof plan.hook === 'object' && Array.isArray(plan.hook.chunks)) {
    const chunks = plan.hook.chunks.slice(0, 10).map((c) => (Array.isArray(c) ? c : [c]).slice(0, 4).map((w) => str(w, 30)).filter(Boolean)).filter((c) => c.length)
    out.hook = { ...prev.hook, chunks, words: chunks.flat(), chunkDur: num(plan.hook.chunkDur ?? prev.hook?.chunkDur, 0.2, 2), end: num(plan.hook.end ?? prev.hook?.end, 0, 30) }
  }
  return out
}

/**
 * Принимаем от редактора только монтаж: клипы основной дорожки, музыку и название.
 * Тариф, план текстов и файлы остаются как есть; длина ролика — не больше тарифа.
 */
export function applyEditorChanges(DATA, project, body) {
  const dir = projectDir(DATA, project.id)
  const files = new Set([...listMedia(dir), ...project.clips.map((c) => c.src).filter(Boolean)])
  if (typeof body.title === 'string' && body.title.trim()) project.title = body.title.trim().slice(0, 200)
  if (Array.isArray(body.clips) && body.clips.length) {
    const clips = []
    let total = 0
    for (const c of body.clips.slice(0, 200)) {
      if (!KINDS.has(c.kind)) continue
      if (c.src != null && !files.has(c.src)) continue
      const dur = num(c.dur, 0.2, project.maxSec)
      if (total + dur > project.maxSec + 0.01) break
      total += dur
      clips.push({
        id: String(c.id || newId()).replace(/[^\w-]/g, '').slice(0, 24) || newId(),
        kind: c.src ? c.kind : 'bg', src: c.src || null,
        srcIn: num(c.srcIn, 0, 36000), base: num(c.base, 0, 1e7), dur,
        bg: Number.isInteger(c.bg) ? c.bg : 0, srcLen: c.srcLen == null ? null : num(c.srcLen, 0, 36000),
      })
    }
    if (clips.length) project.clips = clips
  }
  if (body.style && typeof body.style === 'object') project.style = cleanStyle(body.style)
  if (body.plan && typeof body.plan === 'object') {
    project.plan = { ...project.plan, ...cleanPlan(body.plan, project.plan) }
    // Прибрали стікери — прибираємо й «поп» з-під них, щоб не лишилось звуків без картинки
    if (Array.isArray(body.plan.memes)) {
      const p = project.plan
      p.sfx = buildSfx({ hook: p.hook, captions: p.captions || [], headings: p.headings || [], memes: p.memes || [] })
    }
  }
  if (body.voiceover === null) project.voiceover = null
  else if (body.voiceover && typeof body.voiceover === 'object') project.voiceover = cleanVoiceover(body.voiceover, project.voiceover)
  if (body.music === null) project.music = null
  else if (body.music && project.music) {
    project.music = { ...project.music, start: num(body.music.start, 0, project.maxSec), srcIn: num(body.music.srcIn, 0, 36000), dur: num(body.music.dur, 0.2, project.maxSec), volume: num(body.music.volume, 0, 1), toEnd: body.music.toEnd === true }
  }
  return storeProject(DATA, project)
}
