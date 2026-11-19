import { create } from 'zustand'
import { temporal } from 'zundo'
import type { Clip, Music } from './api'

// Монтаж — єдине джерело правди для плеєра, доріжок і автозбереження. Історія правок — для ⌘Z / ⇧⌘Z.
export type Edit = { clips: Clip[]; music: Music | null; title: string }
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
      selected: null,
      set: (patch) => set(patch),
      select: (selected) => set({ selected }),
    }),
    {
      limit: 200,
      partialize: (s) => ({ clips: s.clips, music: s.music, title: s.title }),
      equality: (a, b) => a.clips === b.clips && a.music === b.music && a.title === b.title,
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
    if (after.clips === before.clips && after.music === before.music && after.title === before.title) { history().resume(); return }
    useEdit.setState(before)
    history().resume()
    useEdit.setState(after)
  }
}
const pickEdit = (s: Edit): Edit => ({ clips: s.clips, music: s.music, title: s.title })

// Плеєр: поточний час і стан (поза історією правок)
export const usePlay = create<{ t: number; playing: boolean; set: (p: Partial<{ t: number; playing: boolean }>) => void }>((set) => ({
  t: 0, playing: false, set: (p) => set(p),
}))
