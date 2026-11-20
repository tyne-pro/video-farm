// Типы стиля ролика для страницы редактора (сам код — style.js)
export interface FontInfo { id: string; name: string; w: number; i?: boolean; g: 'display' | 'hand' | 'text' }
export type AccentMode = 'color' | 'marker' | 'glow' | 'bigger'
export type Backing = 'shadow' | 'plate' | 'outline' | 'none'
export interface Style { preset: string; hookFont?: string | null; subFont?: string | null; text?: string | null; accent?: string; accentMode?: AccentMode; backing?: Backing; ownFont?: boolean }
export const FONTS: FontInfo[]
export const FONT: Record<string, FontInfo>
export const ACCENT_MODES: AccentMode[]
export const BACKINGS: Backing[]
export const TEXT_SWATCHES: string[]
export const ACCENT_SWATCHES: string[]
export const PRESETS: Record<string, Required<Omit<Style, 'preset' | 'ownFont'>>>
export const PRESET_IDS: string[]
export const DEMO_PRESETS: string[]
export function tierOf(limits: unknown): 'demo' | 'premium' | 'pro'
export function resolveStyle(style: Style | null | undefined, tier: string | null | undefined): Required<Style>
export function isLight(hex: string): boolean
export function googleFamily(f: FontInfo): string
