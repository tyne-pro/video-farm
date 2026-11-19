import React from 'react'
import { Composition } from 'remotion'
import { Farm } from './Farm.jsx'

// Все режимы — вертикаль 1080×1920 для TikTok, Reels и Shorts
export const Root = () => (
  <Composition
    id="Farm"
    component={Farm}
    fps={30}
    width={1080}
    height={1920}
    durationInFrames={30}
    defaultProps={{ mode: 'cut', durationSec: 1, plan: null }}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.round(props.durationSec * 30)) })}
  />
)
