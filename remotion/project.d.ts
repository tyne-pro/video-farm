// Типы формата проекта для страницы редактора (сам код — project.js)
export type ClipKind = 'main' | 'video' | 'image' | 'bg'
export interface Clip { id: string; kind: ClipKind; src: string | null; srcIn: number; base: number; dur: number; bg?: number; srcLen?: number | null }
export interface Placed extends Clip { start: number }
export interface Music { src: string; start: number; srcIn: number; dur: number; volume: number; loop?: boolean; toEnd?: boolean; srcLen?: number | null }
export interface Word { text: string; start: number; end: number; accent?: boolean }
export interface Caption { start: number; end: number; words: Word[]; style?: string; pos?: string; _i?: number; _whole?: boolean }
export interface Span { start: number; dur: number }
export interface Plan {
  hook: { end: number; chunks: string[][]; chunkDur: number; words?: string[] }
  captions: Caption[]
  headings: (Span & { text: string; _i?: number })[]
  memes: (Span & { id: string; _i?: number })[]
  zooms: (Span & { scale: number })[]
  sfx: { t: number; kind: string }[]
  palette?: string
  title?: string
}
export interface ProjectLike { clips: Clip[]; plan: Plan; mode: string; landscape?: boolean; music?: Music | null; voice?: string | null; limits?: { watermark?: boolean }; captionColor?: string; emoji?: string }

export const PROJECT_VERSION: number
export const FPS: number
export const MIN_CLIP: number
export function layout<T extends Clip>(clips: T[]): (T & { start: number })[]
export function totalDuration(project: { clips: Clip[] }): number
export function mapTime(placed: Placed[], t: number): { at: number; clip: Placed } | null
export function mapPlan(project: ProjectLike): Plan
export function projectToProps(project: ProjectLike, opts: {
  url: (src: string) => string; memes?: Record<string, { kind: string; src: string }>; sfx?: Record<string, string>
  musicFallback?: string | null; rollerSrc?: string | null; fontSrc?: string | null; captionColor?: string
  style?: unknown; fontFaces?: { hook: unknown[] | null; sub: unknown[] | null } | null
}): Record<string, unknown>
export function splitAt(clips: Clip[], t: number): Clip[]
export function trimClip(clips: Clip[], id: string, edge: 'in' | 'out', delta: number, opts?: { maxLen?: number }): Clip[]
export function moveClip(clips: Clip[], id: string, toIndex: number): Clip[]
export function removeClip(clips: Clip[], id: string): Clip[]
export function duplicateClip(clips: Clip[], id: string): Clip[]
export function newId(): string
