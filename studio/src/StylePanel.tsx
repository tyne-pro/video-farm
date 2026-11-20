import { useEffect } from 'react'
import { FONTS, PRESETS, PRESET_IDS, DEMO_PRESETS, ACCENT_MODES, BACKINGS, TEXT_SWATCHES, ACCENT_SWATCHES, resolveStyle, type Style } from '../../remotion/style.js'
import { t, type Key } from './i18n'
import { useEdit } from './store'

// Превʼю шрифтів у списку: ті самі файли Google Fonts (кирилиця й латиниця), одним запитом
let linked = false
function useFontPreviews() {
  useEffect(() => {
    if (linked) return
    linked = true
    const fam = FONTS.map((f) => `family=${f.name.replace(/ /g, '+')}:${f.i ? `ital,wght@1,${f.w}` : `wght@${f.w}`}`).join('&')
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?${fam}&text=${encodeURIComponent('УтроAa')}&display=swap`
    document.head.appendChild(link)
  }, [])
}

const fontCss = (id: string) => { const f = FONTS.find((x) => x.id === id)!; return { fontFamily: `'${f.name}', sans-serif`, fontWeight: f.w, fontStyle: f.i ? 'italic' : 'normal' } as const }

export function StylePanel({ tier, hasOwnFont }: { tier: string | null; hasOwnFont: boolean }) {
  useFontPreviews()
  const raw = useEdit((s) => s.style)
  const set = useEdit((s) => s.set)
  const demo = !tier || tier === 'demo'
  const st = resolveStyle(raw, tier)
  const patch = (p: Partial<Style>) => set({ style: { ...st, ...p } })
  const pick = (preset: string) => set({ style: { preset, ...PRESETS[preset], ownFont: st.ownFont } })

  const Swatch = ({ value, active, onPick, label }: { value: string | null; active: boolean; onPick: () => void; label: string }) => (
    <button className={`sw${active ? ' on' : ''}`} onClick={onPick} disabled={demo} aria-label={label} title={label}
      style={{ background: value || 'linear-gradient(135deg,#fff 50%,#111 50%)' }} />
  )

  return (
    <div className="style">
      <p className="hint" style={{ marginBottom: 12 }}>{t('styleNote')}</p>
      <h3>{t('presets')}</h3>
      <div className="chips">
        {PRESET_IDS.map((id) => {
          const locked = demo && !DEMO_PRESETS.includes(id)
          return <button key={id} className={`chip${st.preset === id ? ' on' : ''}`} disabled={locked} onClick={() => pick(id)} title={locked ? t('lockStyle') : undefined}>{t(`p_${id}` as Key)}{locked ? ' 🔒' : ''}</button>
        })}
      </div>
      {demo && <p className="lock">{t('lockStyle')}</p>}

      <fieldset disabled={demo} className="fs">
        <h3>{t('hookFont')}</h3>
        <div className="fonts">
          <button className={`font${!st.hookFont ? ' on' : ''}`} onClick={() => patch({ hookFont: null })}><span style={{ fontFamily: 'Unbounded, sans-serif', fontWeight: 700 }}>Утро Aa</span><small>{t('fontAuto')}</small></button>
          {FONTS.filter((f) => f.g !== 'text').map((f) => (
            <button key={f.id} className={`font${st.hookFont === f.id ? ' on' : ''}`} onClick={() => patch({ hookFont: f.id })}><span style={fontCss(f.id)}>Утро Aa</span><small>{f.name}</small></button>
          ))}
        </div>

        <h3>{t('subFont')}</h3>
        <div className="fonts">
          <button className={`font${!st.subFont ? ' on' : ''}`} onClick={() => patch({ subFont: null })}><span style={{ fontFamily: 'Montserrat, sans-serif', fontWeight: 600 }}>Утро Aa</span><small>{t('fontAuto')}</small></button>
          {FONTS.filter((f) => f.g !== 'display').map((f) => (
            <button key={f.id} className={`font${st.subFont === f.id ? ' on' : ''}`} onClick={() => patch({ subFont: f.id })}><span style={fontCss(f.id)}>Утро Aa</span><small>{f.name}</small></button>
          ))}
        </div>

        <h3>{t('colors')}</h3>
        <div className="row-c">
          <span className="l">{t('textColor')}</span>
          <Swatch value={null} active={!st.text} onPick={() => patch({ text: null })} label={t('textAuto')} />
          {TEXT_SWATCHES.map((c) => <Swatch key={c} value={c} active={st.text === c} onPick={() => patch({ text: c })} label={c} />)}
          <label className="plus" title={t('ownColor')}>+<input type="color" value={st.text || '#ffffff'} onChange={(e) => patch({ text: e.target.value.toUpperCase() })} /></label>
        </div>
        <div className="row-c">
          <span className="l">{t('accentColor')}</span>
          {ACCENT_SWATCHES.map((c) => <Swatch key={c} value={c} active={st.accent === c} onPick={() => patch({ accent: c })} label={c} />)}
          <label className="plus" title={t('ownColor')}>+<input type="color" value={st.accent} onChange={(e) => patch({ accent: e.target.value.toUpperCase() })} /></label>
        </div>

        <h3>{t('accentHow')}</h3>
        <div className="chips">{ACCENT_MODES.map((m) => <button key={m} className={`chip${st.accentMode === m ? ' on' : ''}`} onClick={() => patch({ accentMode: m })}>{t(`m_${m}` as Key)}</button>)}</div>

        <h3>{t('backingT')}</h3>
        <div className="chips">{BACKINGS.map((b) => <button key={b} className={`chip${st.backing === b ? ' on' : ''}`} onClick={() => patch({ backing: b })}>{t(`b_${b}` as Key)}</button>)}</div>
      </fieldset>

      {hasOwnFont && (
        <label className="own">
          <input type="checkbox" checked={st.ownFont} disabled={tier !== 'pro'} onChange={(e) => patch({ ownFont: e.target.checked })} />
          {t('ownFont')}{tier !== 'pro' ? ` · ${t('lockOwn')}` : ''}
        </label>
      )}
    </div>
  )
}
