import { useEffect, useRef, useState } from 'react'
import { api, type TtsVoice, type Voiceover } from './api'
import { t } from './i18n'
import { beginGesture, useEdit } from './store'
import { toast } from './ui'

const DEF: Voiceover = {
  enabled: true, textSource: 'manual', text: '', voice: '', lang: 'uk',
  speed: 1, pitch: 0, volume: 1, mode: 'overlay', autoSubtitles: true,
  wav: null, durationMs: null, captions: [],
}

const LANG_LABEL: Record<string, string> = { uk: 'UA', ru: 'RU', en: 'EN' }

export function VoicePanel({ tier, projectId, hasSubs, onGenerated }: {
  tier: string | null; projectId: string; hasSubs: boolean
  onGenerated: (vo: Voiceover | null, src: string) => void
}) {
  const vo = useEdit((s) => s.voiceover)
  const set = useEdit((s) => s.set)
  const cur = vo || DEF
  const patch = (p: Partial<Voiceover>) => set({ voiceover: { ...cur, ...p } })

  const [voices, setVoices] = useState<TtsVoice[]>([])
  const [ready, setReady] = useState(true)
  const [flt, setFlt] = useState('all')
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState('')
  const audio = useRef<HTMLAudioElement | null>(null)
  const demo = !tier || tier === 'demo'

  useEffect(() => {
    api.ttsVoices().then((d) => {
      setVoices(d.voices); setReady(d.ready)
      if (!cur.voice && d.voices.length) {
        const pick = d.voices.find((v) => v.id === d.demoVoice) ? d.demoVoice : d.voices[0].id
        patch({ voice: pick })
      }
    }).catch(() => {})
    return () => { audio.current?.pause() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const langs = ['all', ...Array.from(new Set(voices.map((v) => v.lang).filter((l) => l !== 'custom'))), ...(voices.some((v) => v.lang === 'custom') ? ['custom'] : [])]
  const shown = voices.filter((v) => flt === 'all' || v.lang === flt)

  const preview = async (id: string) => {
    if (playing === id) { audio.current?.pause(); setPlaying(''); return }
    audio.current?.pause()
    try {
      const { src } = await api.ttsPreview({ voice: id })
      const a = new Audio(src); audio.current = a; setPlaying(id)
      a.onended = () => setPlaying('')
      await a.play()
    } catch { setPlaying(''); toast(ready ? t('voFail') : t('voNoEngine'), { err: true }) }
  }

  const slide = (p: Partial<Voiceover>) => patch(p)
  const slideStart = () => { const end = beginGesture(); window.addEventListener('pointerup', end, { once: true }) }

  const generate = async () => {
    if (cur.textSource !== 'subtitles' && !cur.text.trim()) return toast(t('voNeedText'), { err: true })
    if (!cur.voice) return
    setBusy(true)
    try {
      const d = await api.ttsGenerate({
        projectId, textSource: cur.textSource, text: cur.text, voice: cur.voice, lang: cur.lang,
        speed: cur.speed, pitch: cur.pitch, volume: cur.volume, mode: cur.mode, autoSubtitles: cur.autoSubtitles,
      })
      set({ voiceover: d.voiceover })
      onGenerated(d.voiceover, d.src)
      toast(t('voReady', { sec: Math.round((d.durationMs || 0) / 1000) }))
    } catch (e) {
      const code = (e as { code?: string })?.code
      toast(code === 'voice_locked' ? t('voLockedDemo') : code === 'empty_text' ? t('voNeedText') : code === 'synth' ? t('voFail') : t('voNoEngine'), { err: true })
    } finally { setBusy(false) }
  }

  const remove = () => { audio.current?.pause(); set({ voiceover: null }); onGenerated(null, '') }
  const hasVoice = !!(vo && vo.wav)

  return (
    <div className="style vo">
      <p className="hint" style={{ marginBottom: 12 }}>{t('voIntro')}</p>

      <h3>{t('voTitle')}</h3>
      <div className="chips">
        <button className={`chip${cur.textSource === 'manual' ? ' on' : ''}`} onClick={() => patch({ textSource: 'manual' })}>{t('voSourceText')}</button>
        <button className={`chip${cur.textSource === 'subtitles' ? ' on' : ''}`} disabled={!hasSubs} onClick={() => patch({ textSource: 'subtitles' })}>{t('voSourceSubs')}</button>
      </div>
      {cur.textSource === 'manual' && (
        <textarea className="field" rows={4} placeholder={t('voTextPh')} value={cur.text}
          style={{ marginTop: 8 }} onChange={(e) => patch({ text: e.target.value })} />
      )}

      <h3>{t('voVoice')}</h3>
      {langs.length > 2 && (
        <div className="chips">
          {langs.map((l) => <button key={l} className={`chip${flt === l ? ' on' : ''}`} onClick={() => setFlt(l)}>{l === 'all' ? t('voLangAll') : LANG_LABEL[l] || l}</button>)}
        </div>
      )}
      <div className="voices">
        {shown.map((v) => (
          <div key={v.id} className={`voice${cur.voice === v.id ? ' on' : ''}`}>
            <button className="pick" onClick={() => patch({ voice: v.id, lang: v.lang === 'custom' ? cur.lang : v.lang })}>
              <b>{v.name}</b>
              <small>{v.desc}{!v.downloaded && v.mb ? ` · ${t('voDownloadHint', { mb: v.mb })}` : ''}</small>
            </button>
            <button className="play" aria-label={t('voPreview')} title={playing === v.id ? t('voStop') : t('voPreview')} onClick={() => preview(v.id)}>{playing === v.id ? '❚❚' : '▶'}</button>
          </div>
        ))}
      </div>
      {demo && <p className="lock">{t('voLockedDemo')}</p>}
      {tier === 'pro' && <p className="hint" style={{ margin: '4px 0 10px' }}>{t('voCustomPro')}</p>}

      <h3>{t('voSpeed')} · {cur.speed.toFixed(2)}×</h3>
      <input type="range" min={0.5} max={2} step={0.05} value={cur.speed} className="rng"
        onPointerDown={slideStart} onChange={(e) => slide({ speed: Number(e.target.value) })} />

      <h3>{t('voPitch')} · {cur.pitch > 0 ? `+${cur.pitch}` : cur.pitch}</h3>
      <input type="range" min={-6} max={6} step={1} value={cur.pitch} className="rng"
        onPointerDown={slideStart} onChange={(e) => slide({ pitch: Number(e.target.value) })} />

      <h3>{t('voVolume')} · {Math.round(cur.volume * 100)}%</h3>
      <input type="range" min={0} max={1.5} step={0.05} value={cur.volume} className="rng"
        onPointerDown={slideStart} onChange={(e) => slide({ volume: Number(e.target.value) })} />

      <h3>{t('voMode')}</h3>
      <div className="chips">
        <button className={`chip${cur.mode === 'replace' ? ' on' : ''}`} onClick={() => patch({ mode: 'replace' })}>{t('voReplace')}</button>
        <button className={`chip${cur.mode === 'overlay' ? ' on' : ''}`} onClick={() => patch({ mode: 'overlay' })}>{t('voOverlay')}</button>
      </div>

      <label className="own" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={cur.autoSubtitles} onChange={(e) => patch({ autoSubtitles: e.target.checked })} />
        {t('voAutoSubs')}
      </label>

      <button className="btn main" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={generate}>
        {busy ? t('voGenerating') : hasVoice ? t('voRegenerate') : t('voGenerate')}
      </button>
      {hasVoice && (
        <>
          <p className="hint" style={{ margin: '10px 0 8px' }}>{t('voReady', { sec: Math.round((vo!.durationMs || 0) / 1000) })}</p>
          <button className="btn danger" style={{ width: '100%' }} onClick={remove}>🗑 {t('voRemove')}</button>
        </>
      )}
    </div>
  )
}
