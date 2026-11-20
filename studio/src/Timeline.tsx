import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { layout, mapPlan, moveClip, trimClip, MIN_CLIP } from '../../remotion/project.js'
import type { Clip, Media, Music, Plan, Project } from './api'
import { setCaptionEdge, shiftCaption, shiftHeading } from './text'
import { fmt, t } from './i18n'
import { beginGesture, useEdit, usePlay } from './store'

const ROWS = { ruler: 26, video: 64, text: 30, stickers: 30, voice: 44, music: 40, vo: 40 }
const SNAP_PX = 8
const TILE_W = 54 * ((ROWS.video - 12) / 96) // кадр полоски 54×96, вписаний у висоту кліпу

type Peaks = { rate: number; data: number[] }
type Drag =
  | { kind: 'trim'; id: string; edge: 'in' | 'out'; x0: number; clips: Clip[]; end: () => void }
  | { kind: 'move'; id: string; x0: number; dx: number; moved: boolean; to: number }
  | { kind: 'music'; mode: 'move' | 'in' | 'out'; x0: number; music: Music; end: () => void }
  | { kind: 'text'; what: 'cap' | 'hd'; i: number; mode: 'move' | 'in' | 'out'; x0: number; plan: Plan; end: () => void; moved: boolean }
  | { kind: 'scrub' }

function usePeaks(url: string | null | undefined) {
  const [p, setP] = useState<Peaks | null>(null)
  useEffect(() => { if (url) fetch(url).then((r) => r.json()).then(setP).catch(() => {}) }, [url])
  return p
}

/** Хвиля звуку на відрізку файлу [from, from+dur] */
function Wave({ peaks, from, dur, color, loop }: { peaks: Peaks | null; from: number; dur: number; color: string; loop?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const c = ref.current
    if (!c || !peaks) return
    const w = c.clientWidth, h = c.clientHeight
    const dpr = window.devicePixelRatio || 1
    c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr))
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.fillStyle = color
    const n = peaks.data.length
    for (let x = 0; x < w; x += 2) {
      let i = Math.floor((from + (x / w) * dur) * peaks.rate)
      if (loop && n) i %= n
      const v = (peaks.data[i] || 0) / 100
      const bh = Math.max(1, v * (h - 8))
      g.fillRect(x, (h - bh) / 2, 1.2, bh)
    }
  })
  return <canvas ref={ref} />
}

export function Timeline({ project, media, total, seek, split, dup, del, onDropFile }: {
  project: Project; media: Media; total: number; seek: (s: number) => void; split: () => void; dup: () => void; del: () => void; onDropFile: (clipId: string, src: string) => void
}) {
  const clips = useEdit((s) => s.clips)
  const music = useEdit((s) => s.music)
  const voiceover = useEdit((s) => s.voiceover)
  const plan = useEdit((s) => s.plan) || project.plan
  const selected = useEdit((s) => s.selected)
  const set = useEdit((s) => s.set)
  const select = useEdit((s) => s.select)
  const now = usePlay((s) => s.t)
  const playing = usePlay((s) => s.playing)

  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState(800)
  const [pps, setPps] = useState<number | null>(null) // пікселів на секунду; null — увесь ролик
  const [magnet, setMagnet] = useState(true)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [snap, setSnap] = useState<number | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setView(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fit = Math.max(8, (view - 40) / Math.max(total, 3))
  const k = pps ?? fit
  const width = Math.max(view, (total + 2) * k)
  const placed = useMemo(() => layout(clips), [clips])
  const mapped = useMemo(() => mapPlan({ ...project, clips, plan }), [project, clips, plan])
  const voicePeaks = usePeaks(project.voice ? media[project.voice]?.peaks : null)
  const musicPeaks = usePeaks(music ? media[music.src]?.peaks : null)

  // Точки прилипання: межі кліпів, курсор і паузи між словами (у часі ролику)
  const snapTargets = useMemo(() => {
    const list = [0, now, ...placed.map((c) => c.start), ...placed.map((c) => c.start + c.dur)]
    for (const block of mapped.captions) { list.push(block.start, block.end); for (const w of block.words) list.push(w.start, w.end) }
    return list
  }, [placed, mapped, now])
  const snapTo = (time: number, skip?: (x: number) => boolean) => {
    if (!magnet) return { time, hit: null as number | null }
    let best: number | null = null
    for (const x of snapTargets) if (!skip?.(x) && Math.abs(x - time) * k <= SNAP_PX && (best === null || Math.abs(x - time) < Math.abs(best - time))) best = x
    return best === null ? { time, hit: null } : { time: best, hit: best }
  }

  // Курсор у полі зору під час відтворення
  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const x = now * k
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = Math.max(0, x - 80)
  }, [now, k, playing])

  // Масштаб колесом з ⌘/Ctrl навколо курсора миші; звичайне колесо гортає вбік
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const at = (e.clientX - rect.left + el.scrollLeft) / k
        const next = Math.max(4, Math.min(600, k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
        setPps(next)
        requestAnimationFrame(() => { el.scrollLeft = at * next - (e.clientX - rect.left) })
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [k])

  const timeAt = (clientX: number) => {
    const el = scroller.current!
    return (clientX - el.getBoundingClientRect().left + el.scrollLeft) / k
  }

  // --- Жести -------------------------------------------------------------------------
  const onScrubDown = (e: RPointerEvent) => {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ kind: 'scrub' })
    seek(timeAt(e.clientX))
    if (e.target === e.currentTarget) select(null)
  }
  const onClipDown = (e: RPointerEvent, c: Clip, edge?: 'in' | 'out') => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    select(c.id)
    if (edge) setDrag({ kind: 'trim', id: c.id, edge, x0: e.clientX, clips, end: beginGesture() })
    else setDrag({ kind: 'move', id: c.id, x0: e.clientX, dx: 0, moved: false, to: clips.findIndex((x) => x.id === c.id) })
  }
  const onTextDown = (e: RPointerEvent, what: 'cap' | 'hd', i: number, mode: 'move' | 'in' | 'out') => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    select(`${what}:${i}`)
    setDrag({ kind: 'text', what, i, mode, x0: e.clientX, plan, end: beginGesture(), moved: false })
  }
  const onMusicDown = (e: RPointerEvent, mode: 'move' | 'in' | 'out') => {
    if (e.button !== 0 || !music) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    select('music')
    setDrag({ kind: 'music', mode, x0: e.clientX, music: music.toEnd ? { ...music, dur: Math.max(MIN_CLIP, total - music.start) } : music, end: beginGesture() })
  }

  const onMove = (e: RPointerEvent) => {
    if (!drag) return
    if (drag.kind === 'scrub') { seek(timeAt(e.clientX)); return }
    if (drag.kind === 'trim') {
      const c0 = drag.clips.find((x) => x.id === drag.id)!
      const p0 = layout(drag.clips).find((x) => x.id === drag.id)!
      let delta = (e.clientX - drag.x0) / k
      // Межа, що рухається: для кінця — у часі ролику, для початку — паузи між словами в тому ж кліпі
      if (drag.edge === 'out') {
        const s = snapTo(p0.start + p0.dur + delta, (x) => Math.abs(x - (p0.start + p0.dur)) < 1e-6 && false)
        delta = s.time - (p0.start + p0.dur)
        setSnap(s.hit)
      } else {
        const s = snapTo(p0.start + delta)
        delta = s.time - p0.start
        setSnap(s.hit != null ? p0.start : null)
      }
      const others = total - c0.dur
      set({ clips: trimClip(drag.clips, drag.id, drag.edge, delta, { maxLen: project.maxSec - (others - (drag.edge === 'out' ? 0 : 0)) }) })
      if (drag.edge === 'out') seek(Math.min(p0.start + Math.max(MIN_CLIP, p0.dur + delta), total) - 1 / 30)
      else seek(p0.start)
      return
    }
    if (drag.kind === 'move') {
      const dx = e.clientX - drag.x0
      if (!drag.moved && Math.abs(dx) < 4) return
      const me = placed.find((x) => x.id === drag.id)!
      const centre = me.start + me.dur / 2 + dx / k
      const rest = placed.filter((x) => x.id !== drag.id)
      const to = rest.filter((x) => x.start + x.dur / 2 < centre).length
      setDrag({ ...drag, dx, moved: true, to })
      return
    }
    if (drag.kind === 'text') {
      const d = (e.clientX - drag.x0) / k
      if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return
      if (!drag.moved) setDrag({ ...drag, moved: true })
      if (drag.what === 'hd') set({ plan: shiftHeading(drag.plan, drag.i, d) })
      else set({ plan: drag.mode === 'move' ? shiftCaption(drag.plan, drag.i, d) : setCaptionEdge(drag.plan, drag.i, drag.mode, d) })
      return
    }
    if (drag.kind === 'music') {
      const m0 = drag.music
      let d = (e.clientX - drag.x0) / k
      if (drag.mode === 'move') {
        const s = snapTo(m0.start + d)
        d = s.time - m0.start
        setSnap(s.hit)
        set({ music: { ...m0, start: Math.max(0, Math.min(total - MIN_CLIP, m0.start + d)) } })
      } else if (drag.mode === 'out') {
        const s = snapTo(m0.start + m0.dur + d)
        setSnap(s.hit)
        set({ music: { ...m0, toEnd: false, dur: Math.max(MIN_CLIP, Math.min(project.maxSec, s.time - m0.start, m0.loop || !m0.srcLen ? Infinity : m0.srcLen - m0.srcIn)) } })
      } else {
        const s = snapTo(m0.start + d)
        d = Math.max(-m0.start, Math.min(m0.dur - MIN_CLIP, s.time - m0.start))
        setSnap(s.hit)
        set({ music: { ...m0, start: m0.start + d, srcIn: Math.max(0, m0.srcIn + d), dur: m0.dur - d } })
      }
    }
  }
  const onUp = () => {
    if (!drag) return
    if (drag.kind === 'trim' || drag.kind === 'music' || drag.kind === 'text') drag.end()
    if (drag.kind === 'text' && !drag.moved) {
      const c = drag.what === 'cap' ? mapped.captions.find((x) => x._i === drag.i) : mapped.headings.find((x) => x._i === drag.i)
      if (c) seek(c.start + 0.05)
    }
    if (drag.kind === 'move') {
      if (drag.moved) {
        const from = clips.findIndex((x) => x.id === drag.id)
        if (drag.to !== from) set({ clips: moveClip(clips, drag.id, drag.to) })
      } else {
        const c = placed.find((x) => x.id === drag.id)
        if (c && (now < c.start || now >= c.start + c.dur)) seek(c.start)
      }
    }
    setDrag(null)
    setSnap(null)
  }

  // --- Шкала -------------------------------------------------------------------------
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * k >= 64) || 300
  const ticks: number[] = []
  for (let x = 0; x <= width / k; x += step / 5) ticks.push(Math.round(x * 1000) / 1000)

  const moveDrag = drag?.kind === 'move' && drag.moved ? drag : null
  const insertAt = moveDrag ? (() => { const rest = placed.filter((x) => x.id !== moveDrag.id); return moveDrag.to >= rest.length ? total - (placed.find((x) => x.id === moveDrag.id)?.dur || 0) : rest[moveDrag.to].start })() : null
  const insertX = moveDrag && insertAt != null ? (() => {
    const me = placed.find((x) => x.id === moveDrag.id)!
    return (insertAt >= me.start ? insertAt + me.dur : insertAt) * k
  })() : null

  const laneTop = { video: ROWS.ruler, text: ROWS.ruler + ROWS.video, stickers: ROWS.ruler + ROWS.video + ROWS.text, voice: ROWS.ruler + ROWS.video + ROWS.text + ROWS.stickers }
  const hasMusic = !!music
  const musicDur = music ? Math.max(MIN_CLIP, Math.min(music.toEnd ? total - music.start : music.dur, total - music.start)) : 0

  return (
    <section className="tl" aria-label="Таймлайн">
      <div className="tbar">
        <button className="btn" onClick={split} title="S">✂ {t('split')}</button>
        <button className="btn" onClick={dup} disabled={!selected || selected === 'music' || selected === 'hook' || selected.includes(':')} title="⌘D">⧉ {t('dup')}</button>
        <button className="btn danger" onClick={del} disabled={!selected || selected === 'hook'} title="⌫">🗑 {t('del')}</button>
        <button className={`btn${magnet ? ' on' : ''}`} onClick={() => setMagnet(!magnet)} aria-pressed={magnet}>🧲 {t('magnet')}</button>
        <span className="spacer muted" style={{ fontSize: 12 }}>{t('zoom')}</span>
        <button className="btn ic" onClick={() => setPps(Math.max(4, k / 1.5))} aria-label="−">−</button>
        <button className="btn ic" onClick={() => setPps(Math.min(600, k * 1.5))} aria-label="+">+</button>
        <button className={`btn${pps == null ? ' on' : ''}`} onClick={() => setPps(null)}>{t('fit')}</button>
      </div>
      <div className="tracks">
        <div className="labels">
          <div className="lbl" style={{ height: ROWS.ruler }} />
          <div className="lbl" style={{ height: ROWS.video }}>🎞 {t('video')}</div>
          <div className="lbl" style={{ height: ROWS.text + 8 }}>Т {t('text')}</div>
          <div className="lbl" style={{ height: ROWS.stickers }}>☺ {t('stickers')}
            {(plan.memes?.length ?? 0) > 0 && (
              <button type="button" className="lbl-x" title={t('clearStickers')} aria-label={t('clearStickers')}
                onClick={() => set({ plan: { ...plan, memes: [] } })}>✕</button>
            )}
          </div>
          {project.voice && <div className="lbl" style={{ height: ROWS.voice }}>🎙 {t('voice')}</div>}
          {voiceover?.wav && <div className="lbl" style={{ height: ROWS.vo }}>🎤 {t('voTab')}</div>}
          {hasMusic && <div className="lbl" style={{ height: ROWS.music }}>♪ {t('music')}</div>}
        </div>
        <div className="scroller" ref={scroller} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="canvas" style={{ width }}>
            <div className="ruler" onPointerDown={onScrubDown}>
              {ticks.map((x) => {
                const big = Math.abs(x / step - Math.round(x / step)) < 1e-6
                return big
                  ? <span key={x} style={{ left: x * k }}>{fmt(x)}<i className="big" style={{ left: -3 }} /></span>
                  : <i key={x} style={{ left: x * k }} />
              })}
            </div>

            {/* Відео: основна доріжка без пустот */}
            <div className="lane" style={{ height: ROWS.video }} onPointerDown={onScrubDown}>
              {placed.map((c) => {
                const m = c.src ? media[c.src] : null
                const dragging = moveDrag?.id === c.id
                const w = Math.max(6, c.dur * k)
                const tiles = m?.strip ? Math.min(400, Math.ceil(w / TILE_W)) : 0
                return (
                  <div key={c.id}
                    className={`clip v${selected === c.id ? ' selc' : ''}${dragging ? ' drag' : ''}`}
                    style={{ left: c.start * k + (dragging ? moveDrag!.dx : 0), width: w, outline: dropOn === c.id ? '2px dashed rgb(var(--sky))' : undefined,
                      background: m?.kind === 'image' ? `center / cover url("${m.preview}")` : c.kind === 'bg' ? 'linear-gradient(135deg, rgb(var(--violet) / .45), rgb(var(--sky) / .35))' : undefined }}
                    onPointerDown={(e) => onClipDown(e, c)}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes('text/farm-src')) { e.preventDefault(); setDropOn(c.id) } }}
                    onDragLeave={() => setDropOn(null)}
                    onDrop={(e) => { const src = e.dataTransfer.getData('text/farm-src'); setDropOn(null); if (src) onDropFile(c.id, src) }}
                    title={`${fmt(c.start, true)} – ${fmt(c.start + c.dur, true)}`}>
                    {tiles > 0 && (
                      <div className="tiles">
                        {Array.from({ length: tiles }, (_, i) => {
                          const at = c.srcIn + (i * TILE_W) / k
                          const frame = Math.min(599, Math.floor(at * 2))
                          return <div key={i} style={{ width: TILE_W, backgroundImage: `url("${m!.strip}")`, backgroundSize: `${600 * TILE_W}px 100%`, backgroundPosition: `${-frame * TILE_W}px 0` }} />
                        })}
                      </div>
                    )}
                    {c.kind === 'bg' && <span className="cap">✦</span>}
                    {w > 70 && <span className="cap">{fmt(c.dur, true)}</span>}
                    <span className="h l" onPointerDown={(e) => onClipDown(e, c, 'in')} aria-label="Початок" />
                    <span className="h r" onPointerDown={(e) => onClipDown(e, c, 'out')} aria-label="Кінець" />
                  </div>
                )
              })}
              {insertX != null && <div className="insert" style={{ left: insertX }} />}
            </div>

            {/* Тексти й стікери їдуть за монтажем */}
            <div className="lane" style={{ height: ROWS.text + 8 }} onPointerDown={onScrubDown}>
              {mapped.hook?.end > 0 && <div className={`clip hd tsel${selected === 'hook' ? ' selc' : ''}`} style={{ left: 0, width: mapped.hook.end * k, top: 4, bottom: 4 }}
                onPointerDown={(e) => { e.stopPropagation(); select('hook'); seek(0) }}>{(mapped.hook.words || mapped.hook.chunks.flat()).join(' ')}</div>}
              {mapped.captions.map((b, i) => (
                <div key={`c${i}`} className={`clip tx tsel${selected === `cap:${b._i}` ? ' selc' : ''}`} style={{ left: b.start * k, width: Math.max(4, (b.end - b.start) * k - 2), top: 4, bottom: 4 }}
                  title={b.words.map((w) => w.text).join(' ')} onPointerDown={(e) => onTextDown(e, 'cap', b._i!, 'move')}>
                  {b.words.map((w) => w.text).join(' ')}
                  {b._whole && <><span className="h l" onPointerDown={(e) => onTextDown(e, 'cap', b._i!, 'in')} /><span className="h r" onPointerDown={(e) => onTextDown(e, 'cap', b._i!, 'out')} /></>}
                </div>
              ))}
              {mapped.headings.map((h, i) => (
                <div key={`h${i}`} className={`clip hd tsel${selected === `hd:${h._i}` ? ' selc' : ''}`} style={{ left: h.start * k, width: Math.max(4, h.dur * k), top: 4, bottom: 4 }}
                  onPointerDown={(e) => onTextDown(e, 'hd', h._i!, 'move')}>{h.text}</div>
              ))}
            </div>
            <div className="lane" style={{ height: ROWS.stickers }} onPointerDown={onScrubDown}>
              {mapped.memes.map((m: { start: number; dur: number }, i: number) => (
                <div key={`m${i}`} className="clip sk" style={{ left: m.start * k, width: Math.max(10, m.dur * k), top: 4, bottom: 4 }}>☺</div>
              ))}
            </div>

            {/* Голос привʼязаний до кліпів відео */}
            {project.voice && <div className="lane" style={{ height: ROWS.voice }} onPointerDown={onScrubDown}>
              {placed.map((c) => (
                <div key={`v${c.id}`} className="clip au" style={{ left: c.start * k + (moveDrag && moveDrag.id === c.id ? moveDrag.dx : 0), width: Math.max(4, c.dur * k) }}>
                  <Wave peaks={voicePeaks} from={c.base} dur={c.dur} color="rgb(62 230 168 / .75)" />
                </div>
              ))}
            </div>}

            {/* Озвучка: голос за кадром грає з початку ролика */}
            {voiceover?.wav && (
              <div className="lane" style={{ height: ROWS.vo }} onPointerDown={onScrubDown}>
                <div className="clip vo-clip" style={{ left: 0, width: Math.max(8, Math.min((voiceover.durationMs || 0) / 1000, total) * k) }}
                  onPointerDown={(e) => { e.stopPropagation(); seek(0) }} title={t('voTab')}>
                  <span className="cap">🎤 {fmt(Math.min((voiceover.durationMs || 0) / 1000, total), true)}</span>
                </div>
              </div>
            )}

            {hasMusic && (
              <div className="lane" style={{ height: ROWS.music }} onPointerDown={onScrubDown}>
                <div className={`clip mu${selected === 'music' ? ' selc' : ''}`} style={{ left: music!.start * k, width: Math.max(8, musicDur * k) }} onPointerDown={(e) => onMusicDown(e, 'move')}>
                  <Wave peaks={musicPeaks} from={music!.srcIn} dur={musicDur} color="rgb(169 139 255 / .8)" loop={music!.loop} />
                  <span className="h l" onPointerDown={(e) => onMusicDown(e, 'in')} />
                  <span className="h r" onPointerDown={(e) => onMusicDown(e, 'out')} />
                </div>
              </div>
            )}

            {snap != null && <div className="snapline" style={{ left: snap * k }} />}
            <div className="ph" style={{ left: now * k }} />
          </div>
        </div>
      </div>
    </section>
  )
}
