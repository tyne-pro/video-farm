// ============================================================================
// План монтажа: хук, субтитры, акценты, заголовки тем, мемы, зумы, звуки.
// Смысловую часть предлагает Claude (Claude Code CLI по подписке пользователя), правила
// монтажа (частоты, длительности) навязываются кодом поверх.
// Без Claude план строится детерминированно — ролик всё равно соберётся.
// ============================================================================

import { spawn } from 'node:child_process'

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

// --- Claude Code CLI ---------------------------------------------------------

function callClaude(prompt, { timeoutMs = 240_000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json']
    if (process.env.FARM_CLAUDE_MODEL) args.push('--model', process.env.FARM_CLAUDE_MODEL)
    // На Windows claude — это claude.cmd, без shell не запускается
    // Переменные родительской сессии Claude Code (если генератор запущен из
    // неё) не должны протекать в дочерний claude — у него своя авторизация
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK|ANTHROPIC_BASE_URL)/.test(k)))
    const p = spawn('claude', args, { shell: process.platform === 'win32', windowsHide: true, env })
    let out = '', err = ''
    const timer = setTimeout(() => { p.kill(); reject(new Error('Claude не ответил за отведённое время')) }, timeoutMs)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(`claude не найден: ${e.message}`)) })
    p.on('close', (code) => {
      clearTimeout(timer)
      try {
        let res
        try { res = JSON.parse(out) } catch {
          return reject(new Error(code !== 0 ? `claude завершился с кодом ${code}: ${(err || out).slice(-300)}` : 'ответ Claude не JSON'))
        }
        if (res.is_error) {
          const msg = String(res.result || 'ошибка Claude')
          return reject(new Error(/not logged in|login/i.test(msg)
            ? 'Claude Code не залогинен — открой терминал, набери claude и войди по подписке Claude Pro'
            : msg))
        }
        const text = String(res.result || '')
        const m = text.match(/\{[\s\S]*\}/)
        if (!m) return reject(new Error('в ответе Claude нет JSON'))
        resolve(JSON.parse(m[0]))
      } catch (e) {
        reject(new Error(`не разобрал ответ Claude: ${e.message}`))
      }
    })
    p.stdin.end(prompt)
  })
}

const MOOD = {
  smart: 'Подбирай мемы строго по смыслу текущей фразы.',
  mix: 'Подбирай по смыслу текущей фразы или нарочно абсурдные — примерно поровну.',
  absurd: 'Делай упор на абсурдные, безумные мемы, которые напрямую не связаны с фразой, — чем безумнее, тем лучше.',
}

function buildPrompt({ title, format, words, memes, duration, notes = '', memeEvery = RULES.memeEvery, memeMood = 'mix', zooms = true }) {
  const transcript = words.map((w, i) => `${i}|${w.start.toFixed(1)}|${w.text}`).join('\n')
  const library = memes.map((m) => `${m.id}: ${m.label}`).join('\n')
  return `Ты монтажёр коротких видео (TikTok, Reels, Shorts). Составь план монтажа по правилам ниже.
Название видео: «${title}»
Формат: ${format}. Длина после джамп-катов: ${duration.toFixed(1)} с.

ПРАВИЛА:
- hook: заголовок в начале, цепляющий, по смыслу названия, до 10 слов. Если автор задал хук в пожеланиях — используй его.
- accents: индексы 4–12 самых важных слов (цифры, деньги, оценки, ключевые термины) — их выделим цветом и звуком машинки.
- headings: 0–4 заголовка тем/подтем (2–4 слова, капсом), там где спикер переходит к новой теме. wordIdx — слово, с которого начинается тема.
- memes: мем каждые ${memeEvery[0]}–${memeEvery[1]} секунд (примерно ${Math.max(1, Math.floor(duration / ((memeEvery[0] + memeEvery[1]) / 2)))} штук). ${MOOD[memeMood] || MOOD.mix} Используй ТОЛЬКО id из библиотеки, не повторяй один мем подряд.
- zooms: ${zooms ? 'зум кадра головы примерно каждые 10 секунд или на эмоциональных местах, scale 1.05–1.15, dur 2–4.' : 'зумы не нужны, верни пустой массив.'}
${notes ? `\nПОЖЕЛАНИЯ АВТОРА К ЭТОМУ РОЛИКУ (учитывай, но правила выше важнее):\n${notes}\n` : ''}

Расшифровка (индекс|секунда|слово):
${transcript}

Библиотека мемов (id: описание):
${library}

Ответь ТОЛЬКО JSON без пояснений:
{"hook":"...","accents":[0],"headings":[{"wordIdx":0,"text":"..."}],"memes":[{"wordIdx":0,"memeId":"..."}],"zooms":[{"wordIdx":0,"scale":1.1,"dur":3}]}`
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
 * Нормализует предложения Claude (или их отсутствие) под жёсткие правила монтажа.
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

  // Зумы: предложения Claude, затем добиваем до шага ~10 с
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
    if (/\d|\$|€|₴|руб|тыс|млн|процент|%/i.test(w.text) || /^(оф|онлiк)/i.test(w.text)) idx.push(i)
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

export async function buildPlan({
  title, format, words, memes, duration, useClaude = true, log,
  notes = '', memeDensity = 'normal', memeMood = 'mix', zooms: zoomsOn = true,
}) {
  const memeEvery = MEME_DENSITY[memeDensity] || RULES.memeEvery
  words = words.map((w) => ({ ...w, text: sanitize(w.text) }))
  const rand = seededRandom(`${title}|${duration.toFixed(2)}`)
  let ai = null
  let source = 'fallback'
  if (useClaude && words.length) {
    try {
      log?.('Claude составляет план монтажа…')
      ai = await callClaude(buildPrompt({ title, format, words, memes, duration, notes, memeEvery, memeMood, zooms: zoomsOn }))
      source = 'claude'
    } catch (e) {
      log?.(`Claude недоступен (${e.message}). Строю план по правилам без ИИ.`)
    }
  }

  const hook = makeHook(ai?.hook, title)
  const chunkDur = 0.42
  const hookEnd = Math.min(duration, hook.chunks.length * chunkDur + 1.3)

  const accentIdx = new Set((ai?.accents?.length ? ai.accents : fallbackAccents(words)).map(Number))
  const marked = words.map((w, i) => ({ ...w, accent: accentIdx.has(i) }))
  const lineChars = format === 'horizontal' ? 16 : format === 'vertical' ? 19 : 20
  const captions = groupCaptions(marked.filter((w) => w.end > hookEnd - 0.2), { lineChars })
    .map((b, i) => ({
      ...b,
      // Крупная строка-акцент для коротких ударных фраз, иначе квадрат
      style: b.words.length <= 3 && b.words.some((w) => w.accent) ? 'line' : 'block',
      pos: ['center', 'left', 'center', 'right'][i % 4],
    }))

  const { memes: memePlan, zooms, headings } = enforce({
    ai, words, memes, duration, hookEnd, memeStart: hook.chunks.length * chunkDur, rand, memeEvery, zoomsOn,
  })

  const sfxClean = buildSfx({ hook: { ...hook, chunkDur }, captions, headings, memes: memePlan })

  return {
    source,
    title: sanitize(title),
    hook: { ...hook, chunkDur, end: hookEnd },
    captions,
    headings,
    memes: memePlan,
    zooms,
    sfx: sfxClean,
  }
}
