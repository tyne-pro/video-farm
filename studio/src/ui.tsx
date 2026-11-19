import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { CABINET } from './api'
import { lang, setLang, t, type Lang } from './i18n'

// --- Сповіщення внизу екрана ---------------------------------------------------------
type Toast = { id: number; text: string; err?: boolean; action?: { label: string; run: () => void } }
export const useToasts = create<{ list: Toast[]; push: (t: Omit<Toast, 'id'>, ms?: number) => void; drop: (id: number) => void }>((set, get) => ({
  list: [],
  push: (toast, ms = 5000) => {
    const id = Date.now() + Math.random()
    set({ list: [...get().list.slice(-2), { ...toast, id }] })
    setTimeout(() => get().drop(id), ms)
  },
  drop: (id) => set({ list: get().list.filter((x) => x.id !== id) }),
}))
export const toast = (text: string, opts: Partial<Omit<Toast, 'id' | 'text'>> & { ms?: number } = {}) => useToasts.getState().push({ text, ...opts }, opts.ms)

export function Toasts() {
  const list = useToasts((s) => s.list)
  const drop = useToasts((s) => s.drop)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((x) => (
        <div key={x.id} className={`toast${x.err ? ' err' : ''}`}>
          <span>{x.text}</span>
          {x.action && <button className="btn out" onClick={() => { x.action!.run(); drop(x.id) }}>{x.action.label}</button>}
        </div>
      ))}
    </div>
  )
}

// --- Підтвердження -------------------------------------------------------------------
export function Confirm({ title, text, ok, danger, onOk, onClose }: { title: string; text: string; ok: string; danger?: boolean; onOk: () => void; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
        <h2 id="dlg-t">{title}</h2>
        <p>{text}</p>
        <div className="row">
          <button className="btn" onClick={onClose} autoFocus>{t('cancel')}</button>
          <button className={`btn ${danger ? 'danger' : 'main'}`} onClick={() => { onOk(); onClose() }}>{ok}</button>
        </div>
      </div>
    </div>
  )
}

// --- Шапка як у кабінеті --------------------------------------------------------------
export function useTheme() {
  const [light, setLight] = useState(() => document.documentElement.classList.contains('light'))
  const toggle = () => {
    const next = !light
    document.documentElement.classList.toggle('light', next)
    try { localStorage.setItem('farm-theme', next ? 'light' : 'dark') } catch { /* не критично */ }
    setLight(next)
  }
  return { light, toggle }
}

export function Header({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const { light, toggle } = useTheme()
  const [, force] = useState(0)
  return (
    <header className="head">
      <a className="wm" href="#/" aria-label={t('myClips')}>
        <i aria-hidden="true" />
        <span><b>tyne<span className="a">.pro</span></b><small>{t('brand')}</small></span>
      </a>
      {left}
      <span className="spacer" />
      {right}
      <a className="btn" href={`${CABINET}?lang=${lang}`}>{t('toCabinet')}</a>
      <select className="sel" aria-label="Мова" value={lang} onChange={(e) => { setLang(e.target.value as Lang); force((n) => n + 1); location.reload() }}>
        <option value="uk">UA</option><option value="ru">RU</option><option value="en">EN</option>
      </select>
      <button className="btn ic" onClick={toggle} aria-label={t('theme')} title={t('theme')}>{light ? '☾' : '☀'}</button>
    </header>
  )
}

export const tierName = (tier: string | null) => (tier === 'pro' ? 'Pro' : tier === 'premium' ? 'Premium' : tier === 'demo' ? (lang === 'en' ? 'Demo' : 'Демо') : null)
