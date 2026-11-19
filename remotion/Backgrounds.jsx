// ============================================================================
// Анимированные фоны, которые рисуются прямо при рендере (без файлов и интернета):
// живой градиент, мягкие частицы, волны, сияние и плёночное зерно. Цвета — из
// палитры под тему ролика. Всё детерминировано по кадру: рендер повторяем.
// ============================================================================

import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'

// Палитры: [фон, акцент 1, акцент 2, акцент 3]. Имя приходит из плана (ИИ по теме) или по хешу темы.
export const PALETTES = {
  sunset: ['#1a0f1f', '#ff7a59', '#ffb347', '#c2477a'],
  ocean: ['#071a2b', '#1fb6ff', '#2fe2c4', '#3a5bff'],
  forest: ['#0c1a12', '#3ddc84', '#a3e635', '#1f8a5b'],
  neon: ['#0d0a1f', '#ff3df2', '#5b5bff', '#00e5ff'],
  peach: ['#2a1612', '#ff9a8b', '#ffd1a8', '#ff6f91'],
  amber: ['#1c140a', '#f0a33a', '#ffd166', '#e2622f'],
  berry: ['#1a0b16', '#d6336c', '#9b5de5', '#f15bb5'],
  sky: ['#0b1426', '#7dd3fc', '#a78bfa', '#38bdf8'],
}
const NAMES = Object.keys(PALETTES)

export function paletteFor(name, seedText = '') {
  if (name && PALETTES[name]) return PALETTES[name]
  let h = 0
  for (const ch of String(seedText)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTES[NAMES[h % NAMES.length]]
}

const rnd = (seed) => {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

/** Живой градиент: 4 больших размытых пятна плывут по плавным траекториям */
const Mesh = ({ pal, seed }) => {
  const frame = useCurrentFrame()
  const t = frame / 30
  const r = rnd(seed)
  const blobs = [1, 2, 3, 1].map((c, i) => {
    const ph = r() * Math.PI * 2, sp = 0.15 + r() * 0.2, rad = 0.32 + r() * 0.16
    const x = 50 + Math.sin(t * sp + ph) * 30 * (i % 2 ? 1 : -1)
    const y = 20 + i * 22 + Math.cos(t * sp * 0.8 + ph) * 12
    return `radial-gradient(${Math.round(rad * 1920)}px ${Math.round(rad * 1920)}px at ${x}% ${y}%, ${pal[c]}b0 0%, ${pal[c]}55 30%, ${pal[c]}00 72%)`
  })
  return <AbsoluteFill style={{ background: `${blobs.join(',')}, ${pal[0]}`, filter: 'saturate(1.15)' }} />
}

/** Мягкие частицы: светлые точки с размытием поднимаются с разной скоростью (параллакс) */
const Particles = ({ pal, seed, count = 36 }) => {
  const frame = useCurrentFrame()
  const r = rnd(seed + 7)
  return (
    <AbsoluteFill>
      {Array.from({ length: count }, (_, i) => {
        const x = r() * 1080, size = 6 + r() * 26, speed = 0.6 + r() * 2.2, blur = r() < 0.4 ? 6 : 1
        const y = (((r() * 2100) - frame * speed) % 2100 + 2100) % 2100 - 90
        const sway = Math.sin((frame + i * 13) / 40) * 18
        return <div key={i} style={{ position: 'absolute', left: x + sway, top: y, width: size, height: size, borderRadius: '50%', background: pal[1 + (i % 3)], opacity: 0.25 + (i % 4) * 0.12, filter: `blur(${blur}px)` }} />
      })}
    </AbsoluteFill>
  )
}

/** Абстрактные волны: три слоя синусоид с разной фазой внизу и вверху кадра */
const Waves = ({ pal }) => {
  const frame = useCurrentFrame()
  const path = (amp, len, phase, base, flip) => {
    let d = `M 0 ${flip ? 0 : 1920} L 0 ${base}`
    for (let x = 0; x <= 1080; x += 30) d += ` L ${x} ${base + Math.sin(x / len + phase) * amp}`
    return d + ` L 1080 ${flip ? 0 : 1920} Z`
  }
  return (
    <AbsoluteFill>
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{ position: 'absolute', inset: 0 }}>
        {[0, 1, 2].map((i) => (
          <path key={`b${i}`} d={path(40 + i * 18, 160 + i * 40, frame / (24 + i * 8) + i, 1380 + i * 110, false)} fill={pal[1 + i]} opacity={0.32 - i * 0.06} />
        ))}
        {[0, 1].map((i) => (
          <path key={`t${i}`} d={path(30 + i * 14, 140 + i * 50, -frame / (30 + i * 10) + i * 2, 300 - i * 90, true)} fill={pal[3 - i]} opacity={0.22 - i * 0.06} />
        ))}
      </svg>
    </AbsoluteFill>
  )
}

/** Сияние: медленно вращающийся конический градиент, размытый в мягкие полосы */
const Aurora = ({ pal }) => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', left: -540, top: -200, width: 2160, height: 2320,
        background: `conic-gradient(from ${frame * 0.6}deg at 50% 45%, ${pal[1]}, ${pal[2]}, ${pal[3]}, ${pal[1]})`,
        filter: 'blur(140px)', opacity: 0.55,
      }} />
    </AbsoluteFill>
  )
}

/** Плёночное зерно поверх всего: шум, который меняется каждые 2 кадра */
export const Grain = ({ opacity = 0.07 }) => {
  const frame = useCurrentFrame()
  const seed = Math.floor(frame / 2) % 50
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity, mixBlendMode: 'overlay' }}>
      <svg width="1080" height="1920">
        <filter id={`g${seed}`}><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} stitchTiles="stitch" /></filter>
        <rect width="1080" height="1920" filter={`url(#g${seed})`} />
      </svg>
    </AbsoluteFill>
  )
}

/** Мягкая виньетка: держит взгляд в центре и добавляет контраст тексту */
export const Vignette = ({ strength = 0.55 }) => (
  <AbsoluteFill style={{ pointerEvents: 'none', background: `radial-gradient(120% 85% at 50% 45%, rgba(0,0,0,0) 45%, rgba(0,0,0,${strength}) 100%)` }} />
)

const STYLES = [
  ({ pal, seed }) => <><Mesh pal={pal} seed={seed} /><Particles pal={pal} seed={seed} /></>,
  ({ pal, seed }) => <><Mesh pal={pal} seed={seed + 3} /><Waves pal={pal} /></>,
  ({ pal, seed }) => <><AbsoluteFill style={{ background: pal[0] }} /><Aurora pal={pal} /><Particles pal={pal} seed={seed} count={22} /></>,
]

/** Фон экрана: стиль чередуется по номеру экрана, чтобы ролик не был однообразным */
export const GeneratedBackground = ({ palette, index }) => {
  const Style = STYLES[index % STYLES.length]
  return <AbsoluteFill><Style pal={palette} seed={1000 + index * 97} /></AbsoluteFill>
}
