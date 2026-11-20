import { create } from 'zustand'
import { temporal } from 'zundo'
import type { Clip, Music, Plan } from './api'
import type { Style } from '../../remotion/style.js'

// Монтаж — єдине джерело правди для плеєра, доріжок і автозбереження. Історія правок — для ⌘Z / ⇧⌘Z.
export type Edit = { clips: Clip[]; music: Music | null; title: string; plan: Plan | null; style: Style | null }
type State = Edit & {
  selected: string | null
  set: (patch: Partial<Edit>) => void
  select: (id: string | null) => void
}

export const useEdit = create<State>()(
  temporal(
    (set) => ({
      clips: [],
      music: null,
      title: '',
      plan: null,
      style: null,
      selected: null,
      set: (patch) => set(patch),
      select: (selected) => set({ selected }),
    }),
    {
      limit: 200,
      partialize: (s) => ({ clips: s.clips, music: s.music, title: s.title, plan: s.plan, style: s.style }),
      equality: (a, b) => a.clips === b.clips && a.music === b.music && a.title === b.title && a.plan === b.plan && a.style === b.style,
    },
  ),
)

export const history = () => useEdit.temporal.getState()

/**
 * Перетягування й обрізка: поки тягнемо, плеєр і доріжки оновлюються наживо, а в історію
 * йде один крок «до → після».
 */
export function beginGesture() {
  const before: Edit = pickEdit(useEdit.getState())
  history().pause()
  return () => {
    const after = pickEdit(useEdit.getState())
    if (after.clips === before.clips && after.music === before.music && after.title === before.title && after.plan === before.plan && after.style === before.style) { history().resume(); return }
    useEdit.setState(before)
    history().resume()
    useEdit.setState(after)
  }
}
const pickEdit = (s: Edit): Edit => ({ clips: s.clips, music: s.music, title: s.title, plan: s.plan, style: s.style })

// Плеєр: поточний час і стан (поза історією правок)
export const usePlay = create<{ t: number; playing: boolean; set: (p: Partial<{ t: number; playing: boolean }>) => void }>((set) => ({
  t: 0, playing: false, set: (p) => set(p),
}))
