// ============================================================================
// Стиль ролика: шрифты (бесплатные Google Fonts с кириллицей и латиницей),
// цвета, как выделять акцентное слово и подложка под субтитры.
// Общий для редактора (превью) и сборки на компьютере. Хранится в project.style.
// ============================================================================

/** Шрифты: id — имя на Google Fonts без пробелов; w — начертание; i — курсив; g — группа в списке */
export const FONTS = [
  { id: 'Unbounded', name: 'Unbounded', w: 700, g: 'display' },
  { id: 'RussoOne', name: 'Russo One', w: 400, g: 'display' },
  { id: 'Oswald', name: 'Oswald', w: 600, g: 'display' },
  { id: 'PlayfairDisplay', name: 'Playfair Display', w: 700, i: true, g: 'display' },
  { id: 'Exo2', name: 'Exo 2', w: 800, g: 'display' },
  { id: 'DelaGothicOne', name: 'Dela Gothic One', w: 400, g: 'display' },
  { id: 'Tektur', name: 'Tektur', w: 700, g: 'display' },
  { id: 'YesevaOne', name: 'Yeseva One', w: 400, g: 'display' },
  { id: 'MontserratAlternates', name: 'Montserrat Alternates', w: 800, g: 'display' },
  { id: 'Philosopher', name: 'Philosopher', w: 700, g: 'display' },
  { id: 'Comfortaa', name: 'Comfortaa', w: 700, g: 'display' },
  { id: 'Lora', name: 'Lora', w: 700, i: true, g: 'display' },
  { id: 'Caveat', name: 'Caveat', w: 700, g: 'hand' },
  { id: 'Pacifico', name: 'Pacifico', w: 400, g: 'hand' },
  { id: 'Lobster', name: 'Lobster', w: 400, g: 'hand' },
  { id: 'AmaticSC', name: 'Amatic SC', w: 700, g: 'hand' },
  { id: 'BadScript', name: 'Bad Script', w: 400, g: 'hand' },
  { id: 'Neucha', name: 'Neucha', w: 400, g: 'hand' },
  { id: 'Montserrat', name: 'Montserrat', w: 700, g: 'text' },
  { id: 'Rubik', name: 'Rubik', w: 700, g: 'text' },
  { id: 'GolosText', name: 'Golos Text', w: 600, g: 'text' },
  { id: 'Nunito', name: 'Nunito', w: 800, g: 'text' },
  { id: 'Manrope', name: 'Manrope', w: 700, g: 'text' },
  { id: 'Inter', name: 'Inter', w: 700, g: 'text' },
  { id: 'Onest', name: 'Onest', w: 700, g: 'text' },
  { id: 'Geologica', name: 'Geologica', w: 700, g: 'text' },
  { id: 'Raleway', name: 'Raleway', w: 700, g: 'text' },
  { id: 'Jost', name: 'Jost', w: 600, g: 'text' },
  { id: 'Commissioner', name: 'Commissioner', w: 700, g: 'text' },
  { id: 'PTSans', name: 'PT Sans', w: 700, g: 'text' },
  { id: 'Ubuntu', name: 'Ubuntu', w: 700, g: 'text' },
  { id: 'FiraSansCondensed', name: 'Fira Sans Condensed', w: 700, g: 'text' },
  { id: 'RobotoSlab', name: 'Roboto Slab', w: 700, g: 'text' },
  { id: 'Merriweather', name: 'Merriweather', w: 700, g: 'text' },
]
export const FONT = Object.fromEntries(FONTS.map((f) => [f.id, f]))

export const ACCENT_MODES = ['color', 'marker', 'glow', 'bigger']
export const BACKINGS = ['shadow', 'plate', 'outline', 'none']
export const TEXT_SWATCHES = ['#FFFFFF', '#111111', '#FBE7A1', '#FFD400']
export const ACCENT_SWATCHES = ['#FBE7A1', '#FFD400', '#00E5FF', '#FF3DF2', '#3EE6A8', '#FF7A59']

/**
 * Готовые стили. classic — исходный вид фермы (свои смешанные шрифты хука, цвет текста по кадру).
 * text: null — цвет текста подбирается по яркости кадра.
 */
export const PRESETS = {
  classic: { hookFont: null, subFont: null, text: null, accent: '#FBE7A1', accentMode: 'color', backing: 'shadow' },
  neon: { hookFont: 'RussoOne', subFont: 'Exo2', text: '#FFFFFF', accent: '#00E5FF', accentMode: 'glow', backing: 'none' },
  plate: { hookFont: 'Caveat', subFont: 'Rubik', text: '#111111', accent: '#FFD400', accentMode: 'marker', backing: 'plate' },
  minimal: { hookFont: 'Inter', subFont: 'Inter', text: '#FFFFFF', accent: '#FFFFFF', accentMode: 'bigger', backing: 'shadow' },
  magazine: { hookFont: 'PlayfairDisplay', subFont: 'Manrope', text: '#FFFFFF', accent: '#FF7A59', accentMode: 'color', backing: 'shadow' },
  handwritten: { hookFont: 'Caveat', subFont: 'Comfortaa', text: '#FFFFFF', accent: '#FBE7A1', accentMode: 'color', backing: 'outline' },
}
export const PRESET_IDS = Object.keys(PRESETS)
/** В демо — три готовых стиля без своих настроек */
export const DEMO_PRESETS = ['classic', 'neon', 'plate']

const HEX = /^#[0-9a-f]{6}$/i

/** Тариф по лимитам проекта, если текущий неизвестен */
export const tierOf = (limits) => (!limits || limits.watermark ? 'demo' : limits.fonts ? 'pro' : 'premium')

/**
 * Стиль с учётом тарифа: в демо — только готовый стиль целиком; дальше — любые шрифты из списка,
 * цвета, акценты и подложки; свой шрифт из папки fonts — только Pro.
 */
export function resolveStyle(style, tier) {
  const preset = PRESETS[style?.preset] ? style.preset : 'classic'
  const base = { preset, ...PRESETS[preset], ownFont: false }
  if (!style || tier === 'demo' || !tier) return DEMO_PRESETS.includes(preset) ? base : { ...PRESETS.classic, preset: 'classic', ownFont: false }
  return {
    preset,
    hookFont: style.hookFont === null ? null : FONT[style.hookFont] ? style.hookFont : base.hookFont,
    subFont: style.subFont === null ? null : FONT[style.subFont] ? style.subFont : base.subFont,
    text: style.text === null ? null : HEX.test(style.text || '') ? style.text : base.text,
    accent: HEX.test(style.accent || '') ? style.accent : base.accent,
    accentMode: ACCENT_MODES.includes(style.accentMode) ? style.accentMode : base.accentMode,
    backing: BACKINGS.includes(style.backing) ? style.backing : base.backing,
    ownFont: tier === 'pro' && style.ownFont === true,
  }
}

/** Светлый ли цвет: для текста на маркере и цвета плашки */
export function isLight(hex) {
  const m = HEX.test(hex || '') ? hex : '#FFFFFF'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(m.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 150
}

/** Параметр family для css2 Google Fonts */
export const googleFamily = (f) => `${f.name.replace(/ /g, '+')}:${f.i ? `ital,wght@1,${f.w}` : `wght@${f.w}`}`
