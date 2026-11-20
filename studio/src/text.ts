// Правки текстів у плані ролика. План живе у «часі вихідника»; зсув у секундах на доріжці
// дорівнює зсуву у вихіднику (усередині одного кліпу), тому час правимо тим самим дельта.
import type { Plan, Word } from './api'

const r3 = (x: number) => Math.round(x * 1000) / 1000
type Caption = Plan['captions'][number]

/** Текст субтитру з акцентами як «*слово*» */
export const captionText = (c: Caption) => c.words.map((w) => (w.accent ? `*${w.text}*` : w.text)).join(' ')

/** Новий текст: ті самі слова — час лишається; інша кількість — час рівномірно в межах субтитру */
export function setCaptionText(plan: Plan, i: number, text: string): Plan {
  const c = plan.captions[i]
  if (!c) return plan
  const tokens = text.split(/\s+/).filter(Boolean).slice(0, 40)
  if (!tokens.length) return plan
  const parsed = tokens.map((tok) => {
    const accent = /^\*.+\*[.,!?…:;]*$/.test(tok) || /^\*[^*]+\*$/.test(tok)
    return { text: tok.replace(/\*/g, ''), accent }
  }).filter((w) => w.text)
  let words: Word[]
  if (parsed.length === c.words.length) words = c.words.map((w, k) => ({ ...w, text: parsed[k].text, accent: parsed[k].accent }))
  else {
    const step = (c.end - c.start) / parsed.length
    words = parsed.map((w, k) => ({ ...w, start: r3(c.start + k * step), end: r3(c.start + (k + 1) * step) }))
  }
  return { ...plan, captions: plan.captions.map((x, k) => (k === i ? { ...x, words } : x)) }
}

export function toggleAccent(plan: Plan, i: number, wi: number): Plan {
  return { ...plan, captions: plan.captions.map((c, k) => (k === i ? { ...c, words: c.words.map((w, j) => (j === wi ? { ...w, accent: !w.accent } : w)) } : c)) }
}

/** Посунути субтитр цілком */
export function shiftCaption(plan: Plan, i: number, delta: number): Plan {
  const c = plan.captions[i]
  if (!c) return plan
  const d = Math.max(-c.start, delta)
  return {
    ...plan,
    captions: plan.captions.map((x, k) => (k === i ? { ...x, start: r3(x.start + d), end: r3(x.end + d), words: x.words.map((w) => ({ ...w, start: r3(w.start + d), end: r3(w.end + d) })) } : x)),
  }
}

/** Межа субтитру: слова розтягуються пропорційно новій тривалості */
export function setCaptionEdge(plan: Plan, i: number, edge: 'in' | 'out', delta: number): Plan {
  const c = plan.captions[i]
  if (!c) return plan
  const start = edge === 'in' ? Math.max(0, Math.min(c.end - 0.3, c.start + delta)) : c.start
  const end = edge === 'out' ? Math.max(c.start + 0.3, c.end + delta) : c.end
  const k = (end - start) / Math.max(0.01, c.end - c.start)
  const map = (t: number) => r3(start + (t - c.start) * k)
  return { ...plan, captions: plan.captions.map((x, n) => (n === i ? { ...x, start: r3(start), end: r3(end), words: x.words.map((w) => ({ ...w, start: map(w.start), end: map(w.end) })) } : x)) }
}

export const removeCaption = (plan: Plan, i: number): Plan => ({ ...plan, captions: plan.captions.filter((_, k) => k !== i) })

export const setHeadingText = (plan: Plan, i: number, text: string): Plan => ({ ...plan, headings: plan.headings.map((h, k) => (k === i ? { ...h, text: text.slice(0, 80) } : h)) })
export const shiftHeading = (plan: Plan, i: number, delta: number): Plan => ({ ...plan, headings: plan.headings.map((h, k) => (k === i ? { ...h, start: r3(Math.max(0, h.start + delta)) } : h)) })
export const removeHeading = (plan: Plan, i: number): Plan => ({ ...plan, headings: plan.headings.filter((_, k) => k !== i) })

/** Хук: по 1–2 слова на шматок, як у збірці */
export function setHookText(plan: Plan, text: string): Plan {
  const words = text.split(/\s+/).filter(Boolean).slice(0, 10)
  if (!words.length) return plan
  const chunks: string[][] = []
  for (const w of words) {
    const last = chunks[chunks.length - 1]
    if (last && last.length < 2 && (last.join(' ') + ' ' + w).length <= 12) last.push(w)
    else chunks.push([w])
  }
  const end = Math.max(plan.hook.end, r3(0.05 + chunks.length * plan.hook.chunkDur + 0.5))
  return { ...plan, hook: { ...plan.hook, words, chunks, end } }
}
