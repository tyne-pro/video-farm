// ============================================================================
// Композиция ролика: сплит-скрин (голова + планшет) или
// разговорное видео, хук по 1–2 слова, субтитры квадратом с акцентами,
// заголовки тем, поп-ин мемы, зумы, emoji roller и звук.
// ============================================================================

import React from 'react'
import {
  AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence,
  interpolate, useCurrentFrame, useVideoConfig,
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

// --- Раскладки -----------------------------------------------------------------

const LAYOUTS = {
  vertical: {
    head: { left: 60, top: 80, width: 960, height: 860, radius: 40 },
    tablet: { left: 60, top: 1250, width: 960, height: 540, radius: 28 },
    captions: { left: 70, top: 955, width: 940, height: 280, align: 'varies', size: 60, lineSize: 84, blockWidth: 760 },
    // Мемы — поверх планшета , субтитры остаются видны
    meme: { cx: 540, cy: 1460, max: 600 },
    hookMeme: { cx: 540, cy: 1460, max: 560 },
    hook: { left: 80, top: 160, width: 920, height: 700, size: 108 },
    heading: { cx: 540, top: 1270, size: 64 },
    roller: { top: 1800, size: 96 },
  },
  horizontal: {
    head: { left: 40, top: 40, width: 600, height: 1000, radius: 36 },
    tablet: { left: 680, top: 345, width: 1200, height: 675, radius: 24 },
    captions: { left: 690, top: 40, width: 1180, height: 290, align: 'left', size: 50, lineSize: 76, blockWidth: 640 },
    meme: { cx: 1180, cy: 560, max: 520 },
    hookMeme: { cx: 340, cy: 600, max: 480 },
    hook: { left: 700, top: 360, width: 1160, height: 640, size: 112 },
    heading: { cx: 1280, top: 370, size: 64 },
    roller: { top: 1000, size: 72 },
  },
  talking: {
    head: { left: 0, top: 0, width: 1080, height: 1920, radius: 0 },
    tablet: null,
    captions: { left: 90, top: 1180, width: 900, height: 300, align: 'center', size: 62, lineSize: 88, blockWidth: 820 },
    // Лицо в разговорном кадре обычно на 30–55% высоты: мем — выше головы,
    // под шапкой TikTok, заголовок — над субтитрами
    meme: { cx: 540, cy: 400, max: 460 },
    hookMeme: { cx: 540, cy: 1380, max: 560 },
    hook: { left: 80, top: 260, width: 920, height: 760, size: 116 },
    // Низ заголовка над субтитрами: длинный в две строки растёт вверх
    heading: { cx: 540, bottom: 1920 - 1160, size: 72 },
    roller: { top: 1770, size: 100 },
  },
}

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

const Frame = ({ box, src, zoom = 1, origin = '50% 35%' }) => (
  <div style={{
    position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height,
    borderRadius: box.radius, overflow: 'hidden', backgroundColor: '#000',
  }}>
    <OffthreadVideo
      src={src}
      muted
      style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})`, transformOrigin: origin }}
    />
  </div>
)

// --- Хук ---------------------------------------------------------------------------

const Hook = ({ hook, box, color }) => {
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
            fontFamily: italic ? playfair : unbounded,
            fontStyle: italic ? 'italic' : 'normal',
            fontWeight: 700,
            fontSize: italic ? box.size * 0.9 : box.size,
            lineHeight: 1.02,
            color: i === hook.chunks.length - 1 ? (color === WHITE ? BUTTER : '#7A4E00') : color,
            textAlign: 'center',
            transform: `scale(${k})`,
            letterSpacing: italic ? 0 : -1,
          }}>
            {italic ? chunk.join(' ').toLowerCase() : chunk.join(' ')}
          </div>
        )
      })}
    </div>
  )
}

// --- Субтитры -------------------------------------------------------------------

const Captions = ({ captions, box, color, hookEnd }) => {
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
        fontFamily: line ? unbounded : montserrat,
        fontWeight: line ? 700 : 600,
        fontSize: line ? box.lineSize : box.size,
        lineHeight: 1.15,
        color,
        textTransform: line ? 'uppercase' : 'none',
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

const Heading = ({ text, box, color }) => {
  const frame = useCurrentFrame()
  const y = interpolate(frame, [0, 5], [30, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  const o = interpolate(frame, [0, 3, f(1.8) - 5, f(1.8)], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  return (
    <div style={{
      position: 'absolute', left: box.cx - 520, width: 1040, top: box.top, bottom: box.bottom,
      textAlign: 'center', fontFamily: unbounded, fontWeight: 700, fontSize: box.size,
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
  const { format, plan, headSrc, tabletSrc, voiceSrc, musicSrc, musicVolume = 0.03, sfx, memes, captionColor = WHITE, emoji = '🍓', rollerSrc, backgroundSrc } = props
  const frame = useCurrentFrame()
  const { width } = useVideoConfig()
  if (!plan) return <AbsoluteFill style={{ backgroundColor: '#000' }} />
  const L = LAYOUTS[format] || LAYOUTS.vertical
  const zoom = zoomAt(frame, plan.zooms)
  const overVideo = format === 'talking'
  const textColor = overVideo ? captionColor : WHITE

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 80% at 50% 30%, #2a2418 0%, #121110 60%, #0a0a0a 100%)' }}>
      {backgroundSrc && format !== 'talking' && (
        <Img src={backgroundSrc} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}

      <Frame box={L.head} src={headSrc} zoom={zoom} />
      {L.tablet && tabletSrc && <Frame box={L.tablet} src={tabletSrc} origin="50% 50%" />}

      <Captions captions={plan.captions} box={L.captions} color={textColor} hookEnd={plan.hook.end} />

      {plan.headings.map((h, i) => (
        <Sequence key={`h${i}`} from={f(h.start)} durationInFrames={f(h.dur)} layout="none">
          <Heading text={h.text} box={L.heading} color={WHITE} />
        </Sequence>
      ))}

      {plan.memes.map((m, i) => {
        const meme = memes[m.id]
        if (!meme) return null
        return (
          <Sequence key={`m${i}`} from={f(m.start)} durationInFrames={Math.max(8, f(m.dur))} layout="none">
            {/* Мем рядом с хуком — сбоку, чтобы не перекрывать заголовок */}
            <Meme meme={meme} box={m.start < plan.hook.end ? L.hookMeme : L.meme} durFrames={Math.max(8, f(m.dur))} />
          </Sequence>
        )
      })}

      <Hook hook={plan.hook} box={L.hook} color={overVideo ? captionColor : WHITE} />

      <Roller emoji={emoji} rollerSrc={rollerSrc} box={L.roller} width={width} />

      <Audio src={voiceSrc} volume={1} />
      {musicSrc && <Audio src={musicSrc} loop volume={musicVolume} />}
      {plan.sfx.map((s, i) => (
        <Sequence key={`s${i}`} from={f(s.t)} durationInFrames={f(0.5)} layout="none">
          <Audio src={sfx[s.kind]} volume={s.kind === 'type' ? 0.35 : s.kind === 'whoosh' ? 0.3 : 0.55} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
