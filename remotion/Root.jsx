import React from 'react'
import { Composition } from 'remotion'
import { Farm } from './Farm.jsx'

const SIZES = {
  vertical: [1080, 1920],
  horizontal: [1920, 1080],
  talking: [1080, 1920],
}

export const Root = () => (
  <Composition
    id="Farm"
    component={Farm}
    fps={30}
    width={1080}
    height={1920}
    durationInFrames={30}
    defaultProps={{ format: 'talking', durationSec: 1, plan: null }}
    calculateMetadata={({ props }) => {
      const [width, height] = SIZES[props.format] || SIZES.vertical
      return { width, height, durationInFrames: Math.max(1, Math.round(props.durationSec * 30)) }
    }}
  />
)
