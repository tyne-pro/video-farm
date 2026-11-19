// ============================================================================
// Композиция ролика 1080×1920. Режимы:
//   cut    — одно видео автора (вертикальное на весь кадр, горизонтальное — по центру
//            на размытом фоне), паузы вырезаны, субтитры по речи, зумы
//   clips / script — экраны из клипов и картинок (или фона) с текстом по экранам
// Общее: хук по 1–2 слова, субтитры с акцентами, заголовки тем, стикеры, ролер, звук,
// водяной знак демо, свой шрифт (Pro).
// ============================================================================

import React, { useEffect, useState } from 'react'
import {
  AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence,
  continueRender, delayRender, interpolate, useCurrentFrame, useVideoConfig,
} from 'remotion'
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat'
import { loadFont as loadUnbounded } from '@remotion/google-fonts/Unbounded'
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay'
import { loadFont as loadEmoji } from '@remotion/google-fonts/NotoColorEmoji'

const subsets = ['latin', 'cyrillic']
const montserrat = loadMontserrat('normal', { weights: ['600', '800'], subsets }).fontFamily
const unbounded = loadUnbounded('normal', { weights: ['700'], subsets }).fontFamily
const playfair = loadPlayfair('italic', { weights: ['700'], subsets }).fontFamily
const emojiFont = loadEmoji('normal', { subsets: ['emoji'] }).fontFamily

// Палитра: белый, чёрный, масляный. Без обводок и теней.
const WHITE = '#FFFFFF'
const BLACK = '#111111'
const BUTTER = '#FBE7A1'

const FPS = 30
const f = (sec) => Math.round(sec * FPS)

// --- Раскладка ------------------------------------------------------------------

const L = {
  captions: { left: 90, top: 1180, width: 900, height: 300, align: 'center', size: 62, lineSize: 88, blockWidth: 820 },
  // Лицо в кадре обычно на 30–55% высоты: стикер — выше, под шапкой TikTok
  meme: { cx: 540, cy: 420, max: 460 },
  hookMeme: { cx: 540, cy: 1400, max: 520 },
  hook: { left: 80, top: 260, width: 920, height: 760, size: 116 },
  heading: { cx: 540, bottom: 1920 - 1160, size: 72 },
  roller: { top: 1770, size: 100 },
}
// Экраны с текстом: текст по центру крупно
const LS = {
  ...L,
  captions: { left: 80, top: 760, width: 920, height: 520, align: 'center', size: 76, lineSize: 92, blockWidth: 900 },
  meme: { cx: 540, cy: 1460, max: 480 },
}
const BACKGROUNDS = ['#2a2418', '#1c2430', '#2b1d27', '#1d2a22', '#2c2516', '#221e30']

// --- Зум головы ------------------------------------------------------------------

function zoomAt(frame, zooms) {
  for (const z of zooms) {
    const s = f(z.start), e = f(z.start + z.dur)
    if (frame < s || frame > e) continue
    const ramp = Math.min(f(0.25), Math.floor((e - s) / 2))
    // Чередуем плавный наезд и резкий punch-in для живости
    const punch = Math.round(z.start) % 2 === 0
    return interpolate(frame, [s, s + (punch ? 2 : ramp), e - ramp, e], [1, z.scale, z.scale, 1], {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
  }
  return 1
}

/** Видео автора: вертикальное — на весь кадр, горизонтальное — по центру на размытом фоне */
const MainVideo = ({ src, zoom, landscape }) => (
  <AbsoluteFill style={{ backgroundColor: '#000', overflow: 'hidden' }}>
    {landscape && (
      <OffthreadVideo src={src} muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(40px) brightness(0.55)', transform: 'scale(1.2)' }} />
    )}
    <OffthreadVideo
      src={src}
      muted
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: landscape ? 'contain' : 'cover', transform: `scale(${zoom})`, transformOrigin: landscape ? '50% 50%' : '50% 35%' }}
    />
  </AbsoluteFill>
)

/** Экран из клипа, картинки (медленный наезд) или цветного фона */
const Screen = ({ screen, index }) => {
  const frame = useCurrentFrame()
  const total = Math.max(1, f(screen.dur))
  const k = interpolate(frame, [0, total], [1, 1.08], { extrapolateRight: 'clamp' })
  const fade = interpolate(frame, [0, 4], [0.4, 1], { extrapolateRight: 'clamp' })
  const m = screen.media
  return (
    <AbsoluteFill style={{ backgroundColor: '#000', opacity: fade }}>
      {m?.kind === 'video' && <OffthreadVideo src={m.src} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      {m?.kind === 'image' && <Img src={m.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${k})` }} />}
      {!m && <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 30%, ${BACKGROUNDS[index % BACKGROUNDS.length]} 0%, #121110 65%, #0a0a0a 100%)` }} />}
      {m && <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.2) 100%)' }} />}
    </AbsoluteFill>
  )
}

/** Демо: водяной знак в углу и внизу */
const Watermark = () => (
  <>
    <div style={{ position: 'absolute', right: 36, top: 120, padding: '10px 18px', borderRadius: 999, background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.85)', fontFamily: montserrat, fontWeight: 600, fontSize: 30 }}>tyne.pro · демо</div>
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 210, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontFamily: unbounded, fontWeight: 700, fontSize: 44, letterSpacing: 2 }}>TYNE.PRO</div>
  </>
)

/** Свой шрифт (Pro) из папки fonts */
function useCustomFont(src) {
  const [family, setFamily] = useState(null)
  const [handle] = useState(() => (src ? delayRender('font') : null))
  useEffect(() => {
    if (!src) return
    const face = new FontFace('FarmCustom', `url(${src})`)
    face.load().then((loaded) => { document.fonts.add(loaded); setFamily('FarmCustom') }).catch(() => {}).finally(() => continueRender(handle))
  }, [src, handle])
  return family
}

// --- Хук ---------------------------------------------------------------------------

const Hook = ({ hook, box, color, font }) => {
  const frame = useCurrentFrame()
  if (frame > f(hook.end)) return null
  const fadeOut = interpolate(frame, [f(hook.end) - 6, f(hook.end)], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <div style={{
      position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      gap: 8, opacity: fadeOut,
    }}>
      {hook.chunks.map((chunk, i) => {
        const at = f(0.05 + i * hook.chunkDur)
        if (frame < at) return null
        const k = interpolate(frame - at, [0, 3, 6], [0.4, 1.12, 1], { extrapolateRight: 'clamp' })
        // Каждый второй кусок — курсивом-серифом, как микс шрифтов в референсах
        const italic = i % 3 === 1
        return (
          <div key={i} style={{
            fontFamily: italic ? playfair : (font || unbounded),
            fontStyle: italic ? 'italic' : 'normal',
            fontWeight: 700,
            fontSize: italic ? box.size * 0.9 : box.size,
            lineHeight: 1.02,
            color: i === hook.chunks.length - 1 ? (color === WHITE ? BUTTER : '#7A4E00') : color,
            textAlign: 'center',
            transform: `scale(${k})`,
            letterSpacing: italic ? 0 : -1,
            textShadow: color === WHITE ? '0 3px 18px rgba(0,0,0,0.5)' : 'none',
          }}>
            {italic ? chunk.join(' ').toLowerCase() : chunk.join(' ')}
          </div>
        )
      })}
    </div>
  )
}

// --- Субтитры -------------------------------------------------------------------

const Captions = ({ captions, box, color, hookEnd, font }) => {
  const frame = useCurrentFrame()
  const t = frame / FPS
  if (t < hookEnd) return null
  const block = captions.find((c) => t >= c.start && t < c.end)
  if (!block) return null
  const line = block.style === 'line'
  const align = box.align === 'varies' ? block.pos : box.align
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
  const appear = interpolate(frame - f(block.start), [0, 3], [0.92, 1], { extrapolateRight: 'clamp' })
  return (
    <div style={{
      position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height,
      display: 'flex', alignItems: 'center', justifyContent: justify,
    }}>
      <div style={{
        maxWidth: line ? '100%' : box.blockWidth,
        textAlign: align,
        transform: `scale(${appear})`,
        transformOrigin: `${align} center`,
        fontFamily: font || (line ? unbounded : montserrat),
        fontWeight: line ? 700 : 600,
        fontSize: line ? box.lineSize : box.size,
        lineHeight: 1.15,
        color,
        textTransform: line ? 'uppercase' : 'none',
        textShadow: color === WHITE ? '0 2px 14px rgba(0,0,0,0.55)' : 'none',
      }}>
        {block.words.map((w, i) => {
          const shown = t >= w.start - 0.05
          return (
            <span key={i} style={{
              opacity: shown ? 1 : 0,
              color: w.accent ? (color === WHITE ? BUTTER : '#8A5A00') : color,
              fontWeight: w.accent ? 800 : undefined,
            }}>
              {w.text}{i < block.words.length - 1 ? ' ' : ''}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// --- Заголовки тем ------------------------------------------------------------

const Heading = ({ text, box, color, font }) => {
  const frame = useCurrentFrame()
  const y = interpolate(frame, [0, 5], [30, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  const o = interpolate(frame, [0, 3, f(1.8) - 5, f(1.8)], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  return (
    <div style={{
      position: 'absolute', left: box.cx - 520, width: 1040, top: box.top, bottom: box.bottom,
      textAlign: 'center', fontFamily: font || unbounded, fontWeight: 700, fontSize: box.size,
      lineHeight: 1.05, color, opacity: o, transform: `translateY(${y}px)`, textTransform: 'uppercase',
    }}>
      {text}
    </div>
  )
}

// --- Мемы ---------------------------------------------------------------------

const Meme = ({ meme, box, durFrames }) => {
  const frame = useCurrentFrame()
  // Поп-ин 0.1–0.2 с, затем быстрое схлопывание
  const scale = interpolate(frame, [0, 3, 6, durFrames - 4, durFrames], [0.2, 1.1, 1, 1, 0.2], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  const rot = ((meme.src.length * 7) % 9) - 4
  const style = {
    maxWidth: box.max, maxHeight: box.max, objectFit: 'contain',
    borderRadius: meme.kind === 'image' ? 18 : 0,
  }
  return (
    <div style={{
      position: 'absolute', left: box.cx - box.max / 2, top: box.cy - box.max / 2,
      width: box.max, height: box.max, display: 'flex', alignItems: 'center', justifyContent: 'center',
      transform: `scale(${scale}) rotate(${rot}deg)`,
    }}>
      {meme.kind === 'video'
        ? <OffthreadVideo src={meme.src} muted transparent style={style} />
        : <Img src={meme.src} style={style} />}
    </div>
  )
}

// --- Emoji roller ---------------------------------------------------------------

const Roller = ({ emoji, rollerSrc, box, width }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const pad = 24
  const size = box.size
  const p = frame / Math.max(1, durationInFrames - 1)
  const x = pad + p * (width - size - pad * 2)
  // Катится без проскальзывания: угол = путь / радиус
  const deg = ((x - pad) / (size / 2)) * (180 / Math.PI)
  const common = {
    position: 'absolute', left: x, top: box.top, width: size, height: size,
    transform: `rotate(${deg}deg)`,
  }
  return rollerSrc
    ? <Img src={rollerSrc} style={{ ...common, objectFit: 'contain' }} />
    : <div style={{ ...common, fontFamily: emojiFont, fontSize: size * 0.86, lineHeight: `${size}px`, textAlign: 'center' }}>{emoji}</div>
}

// --- Композиция ------------------------------------------------------------------

export const Farm = (props) => {
  const { mode = 'cut', plan, videoSrc, voiceSrc, landscape, screens = [], musicSrc, musicVolume = 0.05, sfx, memes, captionColor = WHITE, emoji = '', rollerSrc, fontSrc, watermark } = props
  const frame = useCurrentFrame()
  const { width } = useVideoConfig()
  const font = useCustomFont(fontSrc)
  if (!plan) return <AbsoluteFill style={{ backgroundColor: '#000' }} />
  const slides = mode !== 'cut'
  const box = slides ? LS : L
  const zoom = slides ? 1 : zoomAt(frame, plan.zooms || [])
  const textColor = slides || landscape ? WHITE : captionColor

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0a' }}>
      {!slides && videoSrc && <MainVideo src={videoSrc} zoom={zoom} landscape={landscape} />}
      {slides && screens.map((sc, i) => (
        <Sequence key={`sc${i}`} from={f(sc.start)} durationInFrames={Math.max(1, f(sc.dur))} layout="none">
          <Screen screen={sc} index={i} />
        </Sequence>
      ))}

      <Captions captions={plan.captions} box={box.captions} color={textColor} hookEnd={plan.hook.end} font={font} />

      {plan.headings.map((h, i) => (
        <Sequence key={`h${i}`} from={f(h.start)} durationInFrames={f(h.dur)} layout="none">
          <Heading text={h.text} box={box.heading} color={WHITE} font={font} />
        </Sequence>
      ))}

      {plan.memes.map((m, i) => {
        const meme = memes[m.id]
        if (!meme) return null
        return (
          <Sequence key={`m${i}`} from={f(m.start)} durationInFrames={Math.max(8, f(m.dur))} layout="none">
            <Meme meme={meme} box={m.start < plan.hook.end ? box.hookMeme : box.meme} durFrames={Math.max(8, f(m.dur))} />
          </Sequence>
        )
      })}

      <Hook hook={plan.hook} box={box.hook} color={textColor} font={font} />

      {(emoji || rollerSrc) && <Roller emoji={emoji} rollerSrc={rollerSrc} box={box.roller} width={width} />}
      {watermark && <Watermark />}

      {voiceSrc && <Audio src={voiceSrc} volume={1} />}
      {musicSrc && <Audio src={musicSrc} loop volume={musicVolume} />}
      {plan.sfx.map((s, i) => (
        <Sequence key={`s${i}`} from={f(s.t)} durationInFrames={f(0.5)} layout="none">
          <Audio src={sfx[s.kind]} volume={s.kind === 'type' ? 0.35 : s.kind === 'whoosh' ? 0.3 : 0.55} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
