// ============================================================================
// План монтажа: хук, субтитры, акценты, заголовки тем, стикеры, зумы, звуки.
// Текстовую часть пишет языковая модель на сервере кабинета (один короткий запрос
// на ролик, только текст). Правила монтажа (частоты, длительности) навязываются
// кодом поверх. Без ответа сервера план строится по правилам — ролик всё равно соберётся.
// ============================================================================

import { portalPlan } from './portal.mjs'

// --- Правила монтажа -----------------------------------------------------------

export const RULES = {
  hookMaxWords: 10,     // хук любой, только чтобы влез на экран
  memeEvery: [5, 8],      // сек между мемами
  memeMaxDur: 3,          // мем висит не дольше
  zoomEvery: 10,          // примерно раз в N сек
  zoomScale: [1.05, 1.15],
  zoomDur: [2, 4],
  captionLines: 3,        // квадрат 3–4 строки
}

/** Чистит лишние пробелы; текст автора не меняем. */
export function sanitize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

/** Хук из текста автора (или названия), капсом, разбит по 1–2 слова. */
export function makeHook(raw, title) {
  let words = sanitize(raw || title).replace(/[«»"]/g, '').split(/\s+/).filter(Boolean)
  const trimTail = () => {
    while (words.length > 1 && /^(в|во|на|про|и|с|со|о|об|у|к|за|по|для|от|из|а|но|как)$/i.test(words[words.length - 1])) words.pop()
  }
  if (words.length > RULES.hookMaxWords) { words = words.slice(0, RULES.hookMaxWords); trimTail() }
  words = words.map((w) => w.toUpperCase())
  const chunks = []
  for (let i = 0; i < words.length;) {
    // Короткие слова (предлоги) не оставляем одних на экране
    const short = (w) => w && w.length <= 3
    let take = 1
    if (short(words[i]) && words[i + 1]) take = 2
    else if (short(words[i + 1]) && words[i + 2]) take = 1 // предлог уйдёт к следующему слову
    else if (words[i + 1] && words[i].length + words[i + 1].length <= 9) take = 2
    chunks.push(words.slice(i, i + take))
    i += take
  }
  return { words, chunks }
}

// --- Субтитры ----------------------------------------------------------------

/** Группирует слова в блоки по 3 строки с учётом пауз и концов фраз. */
export function groupCaptions(words, { lineChars, maxLines = RULES.captionLines, maxDur = 3.6 }) {
  const blocks = []
  let cur = []
  let lines = 1
  let lineLen = 0
  const flush = () => {
    if (cur.length) blocks.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur })
    cur = []; lines = 1; lineLen = 0
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const prev = cur[cur.length - 1]
    if (prev && (w.start - prev.end > 0.6 || w.end - cur[0].start > maxDur)) flush()
    const len = w.text.length
    const endsSentence = /[.!?…]$/.test(w.text)
    if (lineLen && lineLen + 1 + len > lineChars) {
      // Хвост фразы разрешаем дописать 4-й строкой (3–4 строки),
      // чтобы не оставлять одно слово в следующем блоке
      if (lines >= maxLines && !(endsSentence && lines < maxLines + 1)) flush()
      else { lines++; lineLen = 0 }
    }
    lineLen += (lineLen ? 1 : 0) + len
    cur.push(w)
    if (endsSentence) flush()
  }
  flush()
  // Блок держится до начала следующего (без мигания), но не дольше +0.6 с
  for (let i = 0; i < blocks.length; i++) {
    const next = blocks[i + 1]
    blocks[i].end = next ? Math.min(next.start, blocks[i].end + 0.6) : blocks[i].end + 0.4
  }
  return blocks
}

// --- Сборка плана --------------------------------------------------------------

function seededRandom(seed) {
  let s = 0
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function pickMeme(memes, rand, recent) {
  const pool = memes.filter((m) => !recent.includes(m.id))
  const list = pool.length ? pool : memes
  return list[Math.floor(rand() * list.length)]
}

/**
 * Нормализует предложения модели (или их отсутствие) под жёсткие правила монтажа.
 */
function enforce({ ai, words, memes, duration, hookEnd, memeStart, rand, memeEvery = RULES.memeEvery, zoomsOn = true }) {
  const at = (idx) => words[Math.max(0, Math.min(words.length - 1, Number(idx) || 0))]?.start ?? 0

  // Мемы: 5–8 с между появлениями, первый — рядом с хуком (вертикаль)
  const proposed = (ai?.memes || [])
    .map((m) => ({ t: at(m.wordIdx), meme: memes.find((x) => x.id === m.memeId) }))
    .filter((m) => m.meme)
    .sort((a, b) => a.t - b.t)
  const out = []
  const recent = []
  let t = Math.min(memeStart, Math.max(0.6, duration - 1))
  if (memes.length) {
    while (t < duration - 1.2) {
      const [minGap, maxGap] = memeEvery
      const cand = proposed.find((p) => p.t >= t - 0.3 && p.t <= t + (out.length ? maxGap - minGap : 1.5))
      const start = cand ? Math.max(t, cand.t) : t
      const meme = cand?.meme && !recent.includes(cand.meme.id) ? cand.meme : pickMeme(memes, rand, recent)
      const dur = Math.min(RULES.memeMaxDur, 1.8 + rand() * 1.2, duration - start - 0.2)
      if (dur < 0.8) break
      out.push({ start, dur, id: meme.id })
      recent.push(meme.id)
      if (recent.length > Math.min(8, memes.length - 1)) recent.shift()
      t = start + minGap + rand() * (maxGap - minGap)
    }
  }

  // Зумы: предложения модели, затем добиваем до шага ~10 с
  const zooms = []
  const clampScale = (s) => Math.min(RULES.zoomScale[1], Math.max(RULES.zoomScale[0], Number(s) || 1.1))
  const clampDur = (d) => Math.min(RULES.zoomDur[1], Math.max(RULES.zoomDur[0], Number(d) || 3))
  for (const z of ai?.zooms || []) {
    const start = at(z.wordIdx)
    if (start < hookEnd * 0.5 || start > duration - 1.5) continue
    if (zooms.some((x) => Math.abs(x.start - start) < 6)) continue
    zooms.push({ start, dur: clampDur(z.dur), scale: clampScale(z.scale) })
  }
  zooms.sort((a, b) => a.start - b.start)
  if (!zoomsOn) zooms.length = 0
  for (let s = RULES.zoomEvery * 0.8; zoomsOn && s < duration - 2; s += RULES.zoomEvery) {
    if (!zooms.some((z) => Math.abs(z.start - s) < RULES.zoomEvery * 0.6)) {
      zooms.push({ start: s, dur: 2 + rand() * 2, scale: 1.05 + rand() * 0.1 })
    }
  }
  zooms.sort((a, b) => a.start - b.start)
  for (const z of zooms) z.dur = Math.min(z.dur, duration - z.start - 0.2)

  // Заголовки тем: не ближе 8 с друг к другу и не во время хука
  const headings = []
  for (const h of ai?.headings || []) {
    const start = at(h.wordIdx)
    const text = sanitize(h.text).toUpperCase().split(/\s+/).slice(0, 4).join(' ')
    if (!text || start < hookEnd + 1 || start > duration - 2) continue
    if (headings.some((x) => Math.abs(x.start - start) < 8)) continue
    headings.push({ start, dur: 1.8, text })
  }

  return { memes: out, zooms: zooms.filter((z) => z.dur > 1), headings }
}

/** Детерминированные акценты: числа, деньги, длинные слова. */
function fallbackAccents(words) {
  const idx = []
  words.forEach((w, i) => {
    if (/\d|\$|€|₴|грн|тис|тыс|млн|відсот|процент|%/i.test(w.text)) idx.push(i)
  })
  const long = words.map((w, i) => [w.text.replace(/[^\p{L}]/gu, '').length, i]).sort((a, b) => b[0] - a[0])
  for (const [, i] of long) {
    if (idx.length >= Math.max(4, Math.floor(words.length / 25))) break
    if (!idx.some((j) => Math.abs(j - i) < 6)) idx.push(i)
  }
  return idx
}

/**
 * Звуки: клик на каждый кусок хука и заголовок, машинка на субтитры и
 * акценты, поп на мем. Не больше одной машинки на 120 мс — иначе каша.
 */
export function buildSfx({ hook, captions, headings, memes }) {
  const sfx = []
  hook.chunks.forEach((_, i) => sfx.push({ t: 0.05 + i * hook.chunkDur, kind: 'click' }))
  for (const c of captions) {
    sfx.push({ t: c.start, kind: 'type' })
    for (const w of c.words) if (w.accent) sfx.push({ t: w.start, kind: 'type' })
  }
  for (const h of headings) sfx.push({ t: h.start, kind: 'click' }, { t: h.start + 0.02, kind: 'whoosh' })
  for (const m of memes) sfx.push({ t: m.start, kind: 'pop' })
  sfx.sort((a, b) => a.t - b.t)
  const out = []
  for (const x of sfx) {
    const last = out[out.length - 1]
    if (last && x.t - last.t < 0.12 && x.kind === 'type') continue
    out.push(x)
  }
  return out
}

/**
 * Ручная правка готового плана со страницы: хук, текст субтитров
 * (*слово* — акцент), мемы, заголовки тем, зумы. Правила монтажа (длина мема,
 * длина хука) соблюдаются и здесь.
 */
export function applyEdits(plan, edits = {}, { duration, memeIds } = {}) {
  const p = structuredClone(plan)
  const end = duration ?? Math.max(0, ...p.captions.map((c) => c.end))
  const clampT = (t) => Math.max(0, Math.min(end - 0.3, Number(t) || 0))

  if (typeof edits.hook === 'string' && edits.hook.trim()) {
    const chunkDur = p.hook.chunkDur || 0.42
    const h = makeHook(edits.hook, p.title)
    p.hook = { ...h, chunkDur, end: Math.min(end, h.chunks.length * chunkDur + 1.3) }
  }

  if (Array.isArray(edits.captions)) {
    for (const e of edits.captions) {
      const c = p.captions[Number(e.i)]
      if (!c || typeof e.text !== 'string') continue
      const tokens = sanitize(e.text).split(/\s+/).filter(Boolean)
      if (!tokens.length) { c.words = []; continue }
      const step = (c.end - c.start) / tokens.length
      c.words = tokens.map((tok, k) => {
        const accent = /^\*.+\*$/.test(tok)
        return { text: accent ? tok.slice(1, -1) : tok, start: c.start + k * step, end: c.start + (k + 1) * step, accent }
      })
    }
    p.captions = p.captions.filter((c) => c.words.length)
  }

  if (Array.isArray(edits.memes)) {
    p.memes = edits.memes
      .filter((m) => m && (!memeIds || memeIds.has(m.id)))
      .map((m) => {
        const start = clampT(m.start)
        return { id: String(m.id), start, dur: Math.max(0.5, Math.min(RULES.memeMaxDur, Number(m.dur) || 2.5, end - start - 0.1)) }
      })
      .sort((a, b) => a.start - b.start)
  }

  if (Array.isArray(edits.headings)) {
    p.headings = edits.headings
      .filter((h) => h && String(h.text || '').trim())
      .map((h) => ({ start: clampT(h.start), dur: Number(h.dur) || 1.8, text: sanitize(String(h.text)).toUpperCase().slice(0, 40) }))
      .sort((a, b) => a.start - b.start)
  }

  if (edits.zooms === false) p.zooms = []

  p.sfx = buildSfx({ hook: p.hook, captions: p.captions, headings: p.headings, memes: p.memes })
  p.edited = true
  return p
}

export const MEME_DENSITY = { rare: [8, 12], normal: RULES.memeEvery, often: [3.5, 5.5] }

/** Субтитры, акценты, мемы и зумы для режима «порізати готове відео» */
export async function buildPlan({
  k, runId, lang = 'uk', title, hook: authorHook = '', words, memes, duration, log, onText,
  notes = '', memeDensity = 'normal', memeMood = 'mix', zooms: zoomsOn = true,
}) {
  const memeEvery = MEME_DENSITY[memeDensity] || RULES.memeEvery
  words = words.map((w) => ({ ...w, text: sanitize(w.text) }))
  const rand = seededRandom(`${title}|${duration.toFixed(2)}`)
  let ai = null
  let source = 'rules'
  if (runId) {
    try {
      onText?.()
      ai = await portalPlan(k, {
        runId, mode: 'cut', lang, title, hook: authorHook, notes, duration, memeEvery, memeMood, zooms: zoomsOn,
        transcript: words.map((w, i) => `${i}|${w.start.toFixed(1)}|${w.text}`).join('\n'),
        memes: memes.slice(0, 300).map((m) => `${m.id}: ${m.label}`).join('\n'),
      })
      source = 'ai'
    } catch { log?.('rules') }
  }

  const hook = makeHook(authorHook || ai?.hook, title)
  const chunkDur = 0.42
  const hookEnd = Math.min(duration, hook.chunks.length * chunkDur + 1.3)

  const accentIdx = new Set((ai?.accents?.length ? ai.accents : fallbackAccents(words)).map(Number))
  const marked = words.map((w, i) => ({ ...w, accent: accentIdx.has(i) }))
  const captions = groupCaptions(marked.filter((w) => w.end > hookEnd - 0.2), { lineChars: 20 })
    .map((b) => ({
      ...b,
      // Крупная строка-акцент для коротких ударных фраз, иначе квадрат
      style: b.words.length <= 3 && b.words.some((w) => w.accent) ? 'line' : 'block',
      pos: 'center',
    }))

  const { memes: memePlan, zooms, headings } = enforce({
    ai, words, memes, duration, hookEnd, memeStart: hook.chunks.length * chunkDur, rand, memeEvery, zoomsOn,
  })

  return {
    mode: 'cut',
    source,
    title: sanitize(title),
    hook: { ...hook, chunkDur, end: hookEnd },
    captions,
    headings,
    memes: memePlan,
    zooms,
    sfx: buildSfx({ hook: { ...hook, chunkDur }, captions, headings, memes: memePlan }),
  }
}

/**
 * Экраны для режимов «зібрати з кліпів» и «згенерувати за інструкцією»: каждому экрану —
 * строка текста (*слово* — акцент), длительность и материал (кліп, картинка или фон).
 * screens: [{ dur, media? }] — длительности по материалам; для режима «за інструкцією»
 * длительности считаются по длине строк.
 */
export async function buildSlidesPlan({
  k, runId, lang = 'uk', mode, title, hook: authorHook = '', notes = '', screens, memes, log, onText, maxSec, memeMood = 'mix',
}) {
  const rand = seededRandom(`${title}|${screens.length}`)
  let ai = null
  let source = 'rules'
  const total = screens.reduce((s, x) => s + x.dur, 0)
  if (runId) {
    try {
      onText?.()
      ai = await portalPlan(k, {
        runId, mode, lang, title, hook: authorHook, notes, duration: total, segments: screens.length, memeMood, memeEvery: [4, 7],
        memes: memes.slice(0, 300).map((m) => `${m.id}: ${m.label}`).join('\n'),
      })
      source = 'ai'
    } catch { log?.('rules') }
  }
  const lines = Array.isArray(ai?.lines) ? ai.lines.map((l) => sanitize(l)).filter(Boolean) : []
  const hook = makeHook(authorHook || ai?.hook, title)
  const chunkDur = 0.42
  const hookDur = hook.chunks.length * chunkDur + 1.1

  // Режим «за інструкцією»: длительность экрана по длине строки (чтение ~3 слова/с)
  const out = []
  let t = 0
  screens.forEach((sc, i) => {
    const text = lines[i] || (i === 0 ? '' : '')
    const words = text.split(/\s+/).filter(Boolean)
    let dur = sc.dur
    if (mode === 'script') dur = Math.max(2.2, Math.min(4.5, words.length / 3 + 0.8))
    if (i === 0) dur = Math.max(dur, hookDur + 0.6)
    if (maxSec && t + dur > maxSec) dur = maxSec - t
    if (dur < 0.8) return
    out.push({ start: t, dur, media: sc.media || null, text: { words: words.map((w) => ({ text: w.replace(/^\*|\*$/g, ''), accent: /^\*.+\*$/.test(w) || /^\*|\*$/.test(w) })) } })
    t += dur
  })
  const duration = t
  const at = (screen) => out[Math.max(0, Math.min(out.length - 1, Number(screen) || 0))]?.start ?? 0

  const headings = []
  for (const h of ai?.headings || []) {
    const start = at(h.screen) + 0.1
    const text = sanitize(h.text).toUpperCase().split(/\s+/).slice(0, 4).join(' ')
    if (!text || start < hookDur + 0.5 || start > duration - 2 || headings.some((x) => Math.abs(x.start - start) < 6)) continue
    headings.push({ start, dur: 1.6, text })
  }
  const memePlan = []
  const recent = []
  const proposed = (ai?.memes || []).map((m) => ({ t: at(m.screen) + 0.4, meme: memes.find((x) => x.id === m.memeId) })).filter((m) => m.meme)
  for (let s = hookDur * 0.6; memes.length && s < duration - 1.2;) {
    const cand = proposed.find((p) => Math.abs(p.t - s) < 2.5 && !recent.includes(p.meme.id))
    const meme = cand?.meme || pickMeme(memes, rand, recent)
    const dur = Math.min(RULES.memeMaxDur, 1.6 + rand(), duration - s - 0.2)
    if (dur < 0.8) break
    memePlan.push({ start: s, dur, id: meme.id })
    recent.push(meme.id)
    if (recent.length > Math.min(8, memes.length - 1)) recent.shift()
    s += 4 + rand() * 3
  }
  const captions = out.filter((x, i) => i > 0 || hookDur < x.dur - 0.8).map((x, i) => {
    const start = i === 0 && x.start === 0 ? hookDur : x.start + 0.15
    const n = Math.max(1, x.text.words.length)
    const step = Math.min(0.32, (x.start + x.dur - start - 0.3) / n)
    return { start, end: x.start + x.dur, style: 'block', pos: 'center', words: x.text.words.map((w, j) => ({ ...w, start: start + j * step, end: start + (j + 1) * step })) }
  }).filter((c) => c.words.length && c.end > c.start + 0.5)

  const PALETTES = ['sunset', 'ocean', 'forest', 'neon', 'peach', 'amber', 'berry', 'sky']
  return {
    mode,
    source,
    palette: PALETTES.includes(ai?.palette) ? ai.palette : null,
    stockQueries: Array.isArray(ai?.stock) ? ai.stock.map((q) => sanitize(q).slice(0, 60)).filter(Boolean).slice(0, 3) : [],
    title: sanitize(title),
    hook: { ...hook, chunkDur, end: Math.min(duration, hookDur) },
    screens: out.map(({ start, dur, media }) => ({ start, dur, media })),
    captions,
    headings,
    memes: memePlan,
    zooms: [],
    sfx: buildSfx({ hook: { ...hook, chunkDur }, captions, headings, memes: memePlan }),
    duration,
  }
}
