// ============================================================================
// Проект ролика: свой простой формат, не привязанный к движку сборки.
// Один и тот же файл открывает редактор (превью) и собирает финал на компьютере.
//
// project = {
//   v, id, title, mode: 'cut'|'clips'|'script', lang, maxSec, limits, landscape, captionColor, emoji,
//   plan:  { hook, captions, headings, memes, zooms, sfx, palette, title }  — тексты и стикеры во «времени исходника»
//   clips: [{ id, kind: 'main'|'video'|'image'|'bg', src, srcIn, base, dur, bg }]  — основная дорожка, без пустот
//   voice: 'voice.wav' | null   — голос привязан к клипам через base
//   music: { src, start, srcIn, dur, volume } | null
//   original, outputs, stickers
// }
//
// «Время исходника» (base): у ролика из видео — время порезанного видео и голоса,
// у ролика из кліпів — время исходного монтажа. Клип показывает отрезок base…base+dur,
// поэтому субтитры, заголовки и стикеры сами едут за разрезами, перестановкой и обрезкой.
// ============================================================================

export const PROJECT_VERSION = 1
export const FPS = 30
export const MIN_CLIP = 0.2

const round = (x) => Math.round(x * 1000) / 1000

/** Клипы с началом на шкале ролика (основная дорожка идёт без пустот) */
export function layout(clips) {
  let t = 0
  return clips.map((c) => {
    const out = { ...c, start: round(t) }
    t += c.dur
    return out
  })
}

export const totalDuration = (project) => round(project.clips.reduce((s, c) => s + c.dur, 0))

/** Время исходника → время ролика (первый клип, который его показывает) */
export function mapTime(placed, t) {
  for (const c of placed) {
    if (c.kind === 'extra') continue
    if (t >= c.base - 1e-6 && t < c.base + c.dur - 1e-6) return { at: c.start + (t - c.base), clip: c }
  }
  return null
}

/** Отрезок [start, start+dur] исходника → отрезок ролика внутри одного клипа */
function mapSpan(placed, start, dur) {
  const m = mapTime(placed, start)
  if (!m) return null
  const end = Math.min(m.clip.start + m.clip.dur, m.at + dur)
  return end - m.at >= 0.15 ? { start: round(m.at), dur: round(end - m.at) } : null
}

/** Субтитры: каждое слово — за своим клипом; блок, разрезанный монтажом, делится на части */
function mapCaptions(placed, captions) {
  const out = []
  for (const [bi, block] of (captions || []).entries()) {
    let group = null
    for (const w of block.words) {
      const m = mapTime(placed, w.start)
      if (!m) { group = null; continue }
      if (!group || group.clip !== m.clip) {
        group = { clip: m.clip, words: [], first: w }
        out.push(group)
        group.block = block
        group.bi = bi
      }
      const end = Math.min(m.clip.start + m.clip.dur, m.at + (w.end - w.start))
      group.words.push({ ...w, start: round(m.at), end: round(end) })
    }
  }
  return out.map((g) => {
    const c = g.clip
    const isFirst = g.block.words[0] === g.first
    const lead = isFirst ? Math.max(0, Math.min(g.first.start - g.block.start, g.first.start - c.base)) : 0
    const last = g.words[g.words.length - 1]
    const tail = Math.max(0, g.block.end - g.block.words[g.block.words.length - 1].end)
    const start = round(g.words[0].start - lead)
    const end = round(Math.min(c.start + c.dur, last.end + tail))
    return { ...g.block, start, end, words: g.words, _i: g.bi, _whole: g.words.length === g.block.words.length }
  }).sort((a, b) => a.start - b.start)
}

/** План во времени ролика: тексты, заголовки, стикеры, зумы и звуки — за клипами */
export function mapPlan(project) {
  const placed = layout(project.clips)
  const total = totalDuration(project)
  const plan = project.plan
  // _i — номер в исходном плане: по нему редактор правит текст и время
  const span = (list) => (list || []).map((x, i) => { const m = mapSpan(placed, x.start, x.dur); return m ? { ...x, ...m, _i: i } : null }).filter(Boolean)
  const hookEnd = Math.min(plan.hook?.end ?? 0, total)
  return {
    ...plan,
    hook: { ...plan.hook, end: hookEnd },
    captions: mapCaptions(placed, plan.captions),
    headings: span(plan.headings),
    memes: span(plan.memes),
    zooms: span(plan.zooms),
    // Звуки хука — в начале ролика как были; остальные — за своими клипами
    sfx: (plan.sfx || []).flatMap((s) => {
      if (s.t < (plan.hook?.end ?? 0)) return s.t < hookEnd ? [s] : []
      const m = mapTime(placed, s.t)
      return m ? [{ ...s, t: round(m.at) }] : []
    }),
  }
}

/**
 * Свойства композиции Farm. url(src, project) — адрес файла проекта: в редакторе лёгкая копия 540p,
 * при финальной сборке — полный файл.
 */
export function projectToProps(project, { url, memes = {}, sfx = {}, musicFallback = null, rollerSrc = null, fontSrc = null, captionColor, style = null, fontFaces = null } = {}) {
  const placed = layout(project.clips)
  const durationSec = Math.max(0.5, totalDuration(project))
  // Музыка «до конца ролика» растягивается сама, пока её конец не подрезали вручную
  const music = project.music ? { ...project.music, dur: project.music.toEnd ? Math.max(0.2, durationSec - (project.music.start || 0)) : project.music.dur } : null
  return {
    mode: project.mode,
    durationSec,
    plan: mapPlan(project),
    landscape: !!project.landscape,
    clips: placed.map((c) => ({ id: c.id, kind: c.kind, start: c.start, dur: c.dur, srcIn: c.srcIn || 0, bg: c.bg ?? 0, src: c.src ? url(c.src) : null })),
    voiceClips: project.voice ? placed.filter((c) => c.kind === 'main' || c.voice !== false).map((c) => ({ start: c.start, dur: c.dur, srcIn: c.base, src: url(project.voice) })) : [],
    music: music?.src ? { src: url(music.src), start: music.start || 0, srcIn: music.srcIn || 0, dur: music.dur, volume: music.volume ?? 0.35, loop: !!music.loop } : (musicFallback ? { src: musicFallback, start: 0, srcIn: 0, dur: durationSec, volume: project.mode === 'cut' ? 0.05 : 0.35, loop: true } : null),
    sfx,
    memes,
    captionColor: captionColor || project.captionColor || '#FFFFFF',
    emoji: project.emoji || '',
    rollerSrc,
    fontSrc,
    watermark: !!project.limits?.watermark,
    style,
    fontFaces,
  }
}

// --- Правки основной дорожки (общие для редактора и проверок на компьютере) -------------

const newId = () => Math.random().toString(36).slice(2, 10)

/** Разрезать клип в момент t ролика */
export function splitAt(clips, t) {
  const placed = layout(clips)
  const i = placed.findIndex((c) => t > c.start + MIN_CLIP && t < c.start + c.dur - MIN_CLIP)
  if (i < 0) return clips
  const c = clips[i]
  const d = round(t - placed[i].start)
  const left = { ...c, dur: d }
  const right = { ...c, id: newId(), srcIn: round((c.srcIn || 0) + d), base: round(c.base + d), dur: round(c.dur - d) }
  return [...clips.slice(0, i), left, right, ...clips.slice(i + 1)]
}

/** Обрезать край клипа: edge 'in' сдвигает начало, 'out' — конец; delta в секундах */
export function trimClip(clips, id, edge, delta, { maxLen = Infinity } = {}) {
  return clips.map((c) => {
    if (c.id !== id) return c
    const room = c.kind === 'video' || c.kind === 'main' ? (c.srcLen ?? Infinity) : Infinity
    if (edge === 'in') {
      const d = Math.max(-(c.srcIn || 0), Math.min(c.dur - MIN_CLIP, delta))
      return { ...c, srcIn: round((c.srcIn || 0) + d), base: round(c.base + d), dur: round(c.dur - d) }
    }
    const max = Math.min(maxLen, room - (c.srcIn || 0))
    return { ...c, dur: round(Math.max(MIN_CLIP, Math.min(max, c.dur + delta))) }
  })
}

export function moveClip(clips, id, toIndex) {
  const from = clips.findIndex((c) => c.id === id)
  if (from < 0) return clips
  const next = clips.slice()
  const [c] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, c)
  return next
}

export const removeClip = (clips, id) => (clips.length > 1 ? clips.filter((c) => c.id !== id) : clips)

export function duplicateClip(clips, id) {
  const i = clips.findIndex((c) => c.id === id)
  if (i < 0) return clips
  return [...clips.slice(0, i + 1), { ...clips[i], id: newId() }, ...clips.slice(i + 1)]
}

export { newId }
