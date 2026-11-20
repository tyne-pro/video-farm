import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
// Та сама композиція, що збирає фінал на компʼютері: що бачиш у превʼю, те й отримаєш
import { Farm } from '../../remotion/Farm.jsx'
import { projectToProps, layout, totalDuration, splitAt, removeClip, duplicateClip, newId } from '../../remotion/project.js'
import { resolveStyle } from '../../remotion/style.js'
import { api, ApiError, CABINET, downloadUrl, fontFaces, originalUrl, voiceoverUrl, type Clip, type Face, type Media, type MediaInfo, type Project, type Voiceover } from './api'
import { StylePanel } from './StylePanel'
import { VoicePanel } from './VoicePanel'
import { captionText, removeCaption, removeHeading, setCaptionText, setHeadingText, setHookText, toggleAccent } from './text'
import { fmt, lang, t } from './i18n'
import { beginGesture, history, useEdit, usePlay } from './store'
import { Timeline } from './Timeline'
import { Header, tierName, toast } from './ui'

const FPS = 30
const isTyping = (e: KeyboardEvent) => { const el = e.target as HTMLElement; return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable }

export function Editor({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null)
  const [media, setMedia] = useState<Media>({})
  const [memes, setMemes] = useState<Record<string, { kind: string; src: string }>>({})
  const [sfx, setSfx] = useState<Record<string, string>>({})
  const [tier, setTier] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [save, setSave] = useState<'ok' | 'busy' | 'bad'>('ok')
  const [render, setRender] = useState<{ job: string; progress: number } | null>(null)
  const [locked, setLocked] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const [ownFont, setOwnFont] = useState(false)
  const [faces, setFaces] = useState<Record<string, Face[]>>({})
  const [tab, setTab] = useState<'sel' | 'style' | 'voice'>('style')
  const player = useRef<PlayerRef>(null)

  const clips = useEdit((s) => s.clips)
  const music = useEdit((s) => s.music)
  const title = useEdit((s) => s.title)
  const selected = useEdit((s) => s.selected)
  const plan = useEdit((s) => s.plan)
  const style = useEdit((s) => s.style)
  const voiceover = useEdit((s) => s.voiceover)
  const set = useEdit((s) => s.set)
  const select = useEdit((s) => s.select)
  const now = usePlay((s) => s.t)
  const playing = usePlay((s) => s.playing)

  // Відкрити проєкт
  useEffect(() => {
    let alive = true
    api.get(id).then((d) => {
      if (!alive) return
      setProject(d.project); setTier(d.tier); setSfx(d.sfx); setOwnFont(!!d.ownFont)
      // Голос за кадром: его файл не в «Мої файли», добавляем адрес вручную для превью
      const withVoice: Media = d.project.voiceover?.wav
        ? { ...d.media, 'voiceover.wav': { preview: voiceoverUrl(id), full: voiceoverUrl(id), strip: null, peaks: null, kind: 'video', len: null, inBin: false } as MediaInfo }
        : d.media
      setMedia(withVoice)
      useEdit.setState({ clips: d.project.clips, music: d.project.music, title: d.project.title, plan: d.project.plan, style: d.project.style || null, voiceover: d.project.voiceover || null, selected: null })
      history().clear()
      document.title = `${d.project.title} · tyne.pro`
    }).catch((e) => setError(e instanceof ApiError && e.status === 404 ? t('notFound') : t('noApp')))
    api.memes(id).then((m) => alive && setMemes(m)).catch(() => {})
    return () => { alive = false }
  }, [id])

  // Автозбереження монтажу на компʼютер
  const lastSaved = useRef<string>('')
  useEffect(() => {
    if (!project) return
    const body = JSON.stringify({ clips, music, title, plan: plan && { captions: plan.captions, headings: plan.headings, hook: plan.hook, memes: plan.memes }, style, voiceover })
    if (!lastSaved.current) { lastSaved.current = body; return }
    if (body === lastSaved.current) return
    setSave('busy')
    const timer = setTimeout(() => {
      api.save(id, JSON.parse(body)).then(() => { lastSaved.current = body; setSave('ok') }).catch(() => setSave('bad'))
    }, 600)
    return () => clearTimeout(timer)
  }, [clips, music, title, plan, style, voiceover, project, id])

  const total = useMemo(() => totalDuration({ clips }), [clips])
  const edit = useMemo(() => (project && plan ? { ...project, clips, music, title, plan, voiceover } : null), [project, clips, music, title, plan, voiceover])
  // Стиль за поточним тарифом; шрифти — з цього компʼютера (програма бере їх із Google Fonts один раз)
  const resolved = useMemo(() => resolveStyle(style, tier), [style, tier])
  useEffect(() => {
    for (const fid of [resolved.hookFont, resolved.subFont]) {
      if (fid && !faces[fid]) fontFaces(fid).then((f) => setFaces((m) => ({ ...m, [fid]: f }))).catch(() => {})
    }
  }, [resolved.hookFont, resolved.subFont, faces])
  const props = useMemo(() => edit && projectToProps(edit, {
    url: (src: string) => media[src]?.preview || '', memes, sfx, style: resolved,
    fontFaces: { hook: resolved.hookFont ? faces[resolved.hookFont] || null : null, sub: resolved.subFont ? faces[resolved.subFont] || null : null },
  }), [edit, media, memes, sfx, resolved, faces])
  const frames = Math.max(1, Math.round(total * FPS))

  // Плеєр ↔ шкала
  useEffect(() => {
    const p = player.current
    if (!p) return
    const onFrame = (e: { detail: { frame: number } }) => usePlay.getState().set({ t: e.detail.frame / FPS })
    const onPlay = () => usePlay.getState().set({ playing: true })
    const onPause = () => usePlay.getState().set({ playing: false })
    p.addEventListener('frameupdate', onFrame)
    p.addEventListener('play', onPlay)
    p.addEventListener('pause', onPause)
    return () => { p.removeEventListener('frameupdate', onFrame); p.removeEventListener('play', onPlay); p.removeEventListener('pause', onPause) }
  }, [props != null])
  const seek = useCallback((sec: number) => {
    const s = Math.max(0, Math.min(total - 1 / FPS, sec))
    player.current?.seekTo(Math.round(s * FPS))
    usePlay.getState().set({ t: s })
  }, [total])
  const toggle = () => player.current?.toggle()

  useEffect(() => { if (selected) setTab('sel') }, [selected])

  // Дії над кліпами
  const doSplit = useCallback(() => {
    const next = splitAt(useEdit.getState().clips, usePlay.getState().t)
    if (next !== useEdit.getState().clips) set({ clips: next })
  }, [set])
  const doDelete = useCallback(() => {
    const s = useEdit.getState()
    if (s.selected === 'music') { set({ music: null }); select(null); return }
    if (s.selected?.startsWith('cap:') && s.plan) { set({ plan: removeCaption(s.plan, Number(s.selected.slice(4))) }); select(null); return }
    if (s.selected?.startsWith('hd:') && s.plan) { set({ plan: removeHeading(s.plan, Number(s.selected.slice(3))) }); select(null); return }
    if (!s.selected || s.selected === 'hook') return
    set({ clips: removeClip(s.clips, s.selected) }); select(null)
  }, [set, select])
  const doDup = useCallback(() => {
    const s = useEdit.getState()
    if (!s.selected || s.selected === 'music' || s.selected.includes(':') || s.selected === 'hook' || !project) return
    const c = s.clips.find((x) => x.id === s.selected)
    if (c && totalDuration({ clips: s.clips }) + c.dur > project.maxSec) return toast(t('maxLen', { sec: project.maxSec }), { err: true })
    set({ clips: duplicateClip(s.clips, s.selected) })
  }, [set, project])

  // Файл із «Мої файли»: у кінець або замість вибраного кліпу
  const fileClip = useCallback((src: string): Clip => {
    const m = media[src]
    const kind = m?.kind === 'image' ? 'image' : project?.mode === 'cut' && src === 'video.mp4' ? 'main' : 'video'
    const len = m?.len ?? null
    // base далеко за межами ролику: на доданому кліпі немає чужих субтитрів
    return { id: newId(), kind, src, srcIn: 0, base: 100000 + Math.floor(Math.random() * 1e6), dur: Math.min(3, len ?? 3), srcLen: kind === 'image' ? null : len }
  }, [media, project])
  const addFile = (src: string) => {
    if (!project) return
    const c = fileClip(src)
    if (total + c.dur > project.maxSec) return toast(t('maxLen', { sec: project.maxSec }), { err: true })
    set({ clips: [...clips, c] }); select(c.id); setPick(src)
  }
  const replaceWith = useCallback((clipId: string, src: string) => {
    const s = useEdit.getState()
    const fresh = fileClip(src)
    set({ clips: s.clips.map((c) => (c.id === clipId ? { ...c, kind: fresh.kind, src, srcIn: 0, srcLen: fresh.srcLen, dur: fresh.srcLen ? Math.min(c.dur, fresh.srcLen) : c.dur } : c)) })
    select(clipId)
  }, [fileClip, set, select])

  // Голос за кадром сгенерирован (или убран): даём превью адрес файла озвучки
  const onVoiceGenerated = useCallback((_vo: Voiceover | null, src: string) => {
    setMedia((prev) => {
      const next = { ...prev }
      if (src) next['voiceover.wav'] = { preview: src, full: src, strip: null, peaks: null, kind: 'video', len: null, inBin: false }
      else delete next['voiceover.wav']
      return next
    })
  }, [])

  // Клавіші як у відеоредакторах
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      const mod = e.metaKey || e.ctrlKey
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? history().redo() : history().undo() }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); history().redo() }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); doDup() }
      else if (!mod && e.key.toLowerCase() === 's') { e.preventDefault(); doSplit() }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); doDelete() }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(usePlay.getState().t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / FPS)) }
      else if (e.key === 'Escape') select(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [doSplit, doDelete, doDup, seek, select])

  // Фінальна збірка 1080p на компʼютері
  const startRender = async () => {
    // Сначала сохраняем всё, что сейчас в редакторе (монтаж, тексты, стиль), и только потом собираем
    const body = { clips, music, title, plan: plan && { captions: plan.captions, headings: plan.headings, hook: plan.hook, memes: plan.memes }, style, voiceover }
    await api.save(id, body).then(() => { lastSaved.current = JSON.stringify(body); setSave('ok') }).catch(() => {})
    try {
      const job = await api.render(id)
      setRender({ job: job.id, progress: job.progress })
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setLocked(true)
      else toast(t('failed'), { err: true })
    }
  }
  useEffect(() => {
    if (!render) return
    const timer = setInterval(async () => {
      try {
        const j = await api.job(render.job)
        if (j.state === 'done') {
          setRender(null)
          const name = j.result || ''
          setProject((p) => (p ? { ...p, outputs: [...p.outputs, { file: name, at: Date.now() }] } : p))
          toast(t('finalDone'), { ms: 12000, action: { label: t('download'), run: () => { location.href = downloadUrl(name) } } })
        } else if (j.state === 'error') { setRender(null); toast(j.error || t('failed'), { err: true }) }
        else setRender({ job: render.job, progress: j.progress })
      } catch { /* програма зайнята — наступна спроба */ }
    }, 1000)
    return () => clearInterval(timer)
  }, [render])

  if (error) return (<><Header /><main className="page"><p className="empty" role="alert">{error}</p><a className="btn" href="#/">← {t('back')}</a></main></>)
  if (!project || !props) return (<><Header /><main className="page"><p className="muted" role="status">{t('loading')}</p></main></>)

  const placed = layout(clips)
  const sel = placed.find((c) => c.id === selected) || null
  const bin = Object.entries(media).filter(([, m]) => m.inBin)

  return (
    <div className="ed">
      <Header
        left={<a className="btn" href="#/" style={{ marginLeft: 8 }}>← {t('back')}</a>}
        right={tierName(tier) && <span className="pill ok"><span className="dot" />{t('connected')} · {tierName(tier)}</span>}
      />
      <div className="bar">
        <input className="title-in" value={title}  aria-label={t('clipName')} onChange={(e) => set({ title: e.target.value })} size={Math.min(46, Math.max(12, title.length + 2))} />
        <span className={`saved ${save === 'busy' ? 'busy' : save === 'bad' ? 'bad' : ''}`} role="status">● {t(save === 'busy' ? 'saving' : save === 'bad' ? 'notSaved' : 'saved')}</span>
        <span className="spacer" />
        <button className="btn ic" onClick={() => history().undo()} title={t('undoT')} aria-label={t('undoT')}>↶</button>
        <button className="btn ic" onClick={() => history().redo()} title={t('redoT')} aria-label={t('redoT')}>↷</button>
        {project.original && <a className="btn out" href={originalUrl(project.id)} download>⬇ {t('original')}</a>}
        {render
          ? <span className="btn" aria-live="polite">{t('rendering')} <span className="prog"><i style={{ width: `${Math.round(render.progress * 100)}%` }} /></span> {Math.round(render.progress * 100)}%</span>
          : <button className="btn main" onClick={startRender}>{t('makeFinal')}</button>}
      </div>

      <div className="mid">
        <aside className="panel">
          <h3>{t('files')}</h3>
          <div className="bin">
            {bin.map(([src, m]) => (
              <button key={src} draggable onDragStart={(e) => { e.dataTransfer.setData('text/farm-src', src); e.dataTransfer.effectAllowed = 'copy' }}
                onClick={() => addFile(src)} title={src} style={pick === src ? { borderColor: 'rgb(var(--acc))' } : undefined}>
                {m.kind === 'image' ? <img src={m.preview} alt="" loading="lazy" /> : <video src={`${m.preview}#t=0.3`} muted preload="metadata" />}
                {m.len ? <span>{fmt(m.len)}</span> : null}
              </button>
            ))}
          </div>
          <p className="hint">{t('addHint')}</p>
        </aside>

        <section className="stage" aria-label={t('preview')}>
          <div className="tags"><span className="tag">{t('preview')}</span><span className="tag">{t('fromPc')}</span></div>
          <div className="player">
            <Player
              ref={player}
              component={Farm as never}
              inputProps={props}
              durationInFrames={frames}
              compositionWidth={1080}
              compositionHeight={1920}
              fps={FPS}
              style={{ width: '100%', height: '100%' }}
              clickToPlay
              doubleClickToFullscreen
              spaceKeyToPlayOrPause={false}
              acknowledgeRemotionLicense
            />
          </div>
          <div className="ctl">
            <span>{fmt(now, true)} / {fmt(total, true)}</span>
            <button className="play" onClick={toggle} aria-label={playing ? t('pause') : t('play')}>{playing ? '❚❚' : '▶'}</button>
            <span className="kbd">Space</span>
          </div>
        </section>

        <aside className="panel r insp">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'style'} className={`chip${tab === 'style' ? ' on' : ''}`} onClick={() => setTab('style')}>{t('tabStyle')}</button>
            <button role="tab" aria-selected={tab === 'voice'} className={`chip${tab === 'voice' ? ' on' : ''}`} onClick={() => setTab('voice')}>{t('voTab')}</button>
            <button role="tab" aria-selected={tab === 'sel'} className={`chip${tab === 'sel' ? ' on' : ''}`} onClick={() => setTab('sel')}>{t('tabSel')}</button>
          </div>
          {tab === 'voice' ? <VoicePanel tier={tier} projectId={id} hasSubs={(plan?.captions?.length || 0) > 0} onGenerated={onVoiceGenerated} /> : tab === 'style' ? <StylePanel tier={tier} hasOwnFont={ownFont} /> : selected === 'hook' && plan ? (
            <>
              <h3>{t('hookT')}</h3>
              <label htmlFor="hook">{t('text')}</label>
              <input id="hook" className="field" defaultValue={(plan.hook.words || plan.hook.chunks.flat()).join(' ')} key={`hook-${plan.hook.chunks.length}`}
                onBlur={(e) => set({ plan: setHookText(plan, e.target.value) })} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
            </>
          ) : selected?.startsWith('hd:') && plan?.headings[Number(selected.slice(3))] ? (() => {
            const i = Number(selected.slice(3)); const h = plan.headings[i]
            return (
              <>
                <h3>{t('heading')}</h3>
                <label htmlFor="hd">{t('text')}</label>
                <input id="hd" className="field" value={h.text} onChange={(e) => set({ plan: setHeadingText(plan, i, e.target.value) })} />
                <button className="btn danger" style={{ width: '100%' }} onClick={doDelete}>🗑 {t('delCaption')} <span className="kbd">⌫</span></button>
              </>
            )
          })() : selected?.startsWith('cap:') && plan?.captions[Number(selected.slice(4))] ? (() => {
            const i = Number(selected.slice(4)); const c = plan.captions[i]
            return (
              <>
                <h3>{t('caption')}</h3>
                <label htmlFor="cap">{t('text')}</label>
                <textarea id="cap" className="field" rows={3} key={`cap-${i}-${captionText(c)}`} defaultValue={captionText(c)}
                  onBlur={(e) => set({ plan: setCaptionText(plan, i, e.target.value) })} />
                <div className="words">
                  {c.words.map((w, wi) => <button key={wi} className={`chip${w.accent ? ' on' : ''}`} onClick={() => set({ plan: toggleAccent(plan, i, wi) })}>{w.text}</button>)}
                </div>
                <p className="hint" style={{ margin: '8px 0 12px' }}>{t('captionHint')}</p>
                <button className="btn danger" style={{ width: '100%' }} onClick={doDelete}>🗑 {t('delCaption')} <span className="kbd">⌫</span></button>
              </>
            )
          })() : selected === 'music' && music ? (
            <>
              <h3>{t('music')}</h3>
              <label htmlFor="vol">{t('volume')} · {Math.round(music.volume * 100)}%</label>
              <input id="vol" type="range" min={0} max={1} step={0.01} value={music.volume} style={{ width: '100%', marginBottom: 12, accentColor: 'rgb(var(--acc))' }}
                onPointerDown={() => { const end = beginGesture(); window.addEventListener('pointerup', end, { once: true }) }}
                onChange={(e) => set({ music: { ...music, volume: Number(e.target.value) } })} />
              <p className="hint" style={{ marginBottom: 12 }}>{t('musicHint')}</p>
              <button className="btn danger" onClick={doDelete}>🗑 {t('del')} <span className="kbd">⌫</span></button>
            </>
          ) : sel ? (
            <>
              <h3>{t('clipOf', { n: placed.indexOf(sel) + 1, total: placed.length })}</h3>
              <div className="two">
                <div><label>{t('start')}</label><span className="field">{fmt(sel.start, true)}</span></div>
                <div>
                  <label htmlFor="len">{t('length')}</label>
                  <input id="len" className="field" type="number" min={0.2} step={0.1} value={Number(sel.dur.toFixed(2))}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (!(v >= 0.2)) return
                      const room = sel.srcLen ? sel.srcLen - sel.srcIn : Infinity
                      const other = total - sel.dur
                      const dur = Math.min(v, room, project.maxSec - other)
                      set({ clips: clips.map((c) => (c.id === sel.id ? { ...c, dur: Math.round(dur * 1000) / 1000 } : c)) })
                    }} />
                </div>
              </div>
              {sel.kind !== 'image' && sel.kind !== 'bg' && (
                <>
                  <label htmlFor="slip">{t('from')}</label>
                  <input id="slip" className="field" type="number" min={0} step={0.1} value={Number(sel.srcIn.toFixed(2))}
                    onChange={(e) => {
                      const v = Math.max(0, Number(e.target.value) || 0)
                      const max = sel.srcLen ? Math.max(0, sel.srcLen - sel.dur) : v
                      const srcIn = Math.min(v, max)
                      set({ clips: clips.map((c) => (c.id === sel.id ? { ...c, srcIn, base: c.base + (srcIn - c.srcIn) } : c)) })
                    }} />
                </>
              )}
              {sel.kind === 'bg' && <p className="hint" style={{ marginBottom: 12 }}>{t('bgClip')}</p>}
              <div className="two" style={{ marginBottom: 8 }}>
                <button className="btn" onClick={doSplit}>✂ {t('split')} <span className="kbd">S</span></button>
                <button className="btn" onClick={doDup}>⧉ {t('dup')}</button>
              </div>
              {pick && <button className="btn" style={{ width: '100%', marginBottom: 8 }} onClick={() => replaceWith(sel.id, pick)}>⇄ {t('replace')}</button>}
              <button className="btn danger" style={{ width: '100%' }} onClick={doDelete} disabled={clips.length < 2}>🗑 {t('del')} <span className="kbd">⌫</span></button>
              <p className="hint" style={{ marginTop: 14 }}>{t('textLater')}</p>
            </>
          ) : (
            <p className="hint">{t('nothing')}</p>
          )}
        </aside>
      </div>

      <Timeline project={project} media={media} total={total} seek={seek} split={doSplit} dup={doDup} del={doDelete} onDropFile={replaceWith} />

      <footer className="foot">
        <span>📁 {t('filesAt')}: <b>~/TyneFarm</b></span>
        <span>{t('traffic')}: <span className="ok">{t('trafficVal')}</span></span>
        <span className="spacer">{tierName(tier) ? `${tierName(tier)} · ` : ''}{fmt(total, true)} / {fmt(project.maxSec)}</span>
      </footer>

      {locked && (
        <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setLocked(false) }}>
          <div className="dialog" role="alertdialog" aria-modal="true">
            <h2>{t('makeFinal')}</h2>
            <p>{t('locked')}</p>
            <div className="row">
              <button className="btn" onClick={() => setLocked(false)}>{t('cancel')}</button>
              <a className="btn main" href={`${CABINET}?lang=${lang}#plans`}>{t('plans')}</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
