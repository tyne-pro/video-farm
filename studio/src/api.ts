// Запити до програми на цьому компʼютері (той самий адрес, що й сторінка). Відео нікуди не йде.

export type ClipKind = 'main' | 'video' | 'image' | 'bg'
export type Clip = { id: string; kind: ClipKind; src: string | null; srcIn: number; base: number; dur: number; bg?: number; srcLen?: number | null }
export type Music = { src: string; start: number; srcIn: number; dur: number; volume: number; loop?: boolean; toEnd?: boolean; srcLen?: number | null }
export type Word = { text: string; start: number; end: number; accent?: boolean }
export type Plan = {
  hook: { end: number; chunks: string[][]; chunkDur: number; words?: string[] }
  captions: { start: number; end: number; words: Word[]; style?: string; pos?: string; _i?: number; _whole?: boolean }[]
  headings: { start: number; dur: number; text: string; _i?: number }[]
  memes: { start: number; dur: number; id: string }[]
  zooms: { start: number; dur: number; scale: number }[]
  sfx: { t: number; kind: string }[]
  palette?: string
  title?: string
}
export type Project = {
  v: number; id: string; title: string; mode: 'cut' | 'clips' | 'script'; lang: string; createdAt: number; updatedAt: number
  limits: { watermark?: boolean; music?: boolean; maxSec: number }; maxSec: number; landscape: boolean; captionColor: string; emoji: string
  plan: Plan; style?: import('../../remotion/style.js').Style | null; clips: Clip[]; voice: string | null; music: Music | null; voiceover?: Voiceover | null; original: string | null; outputs: { file: string; at: number }[]
}
export type VoiceoverCaption = { start: number; end: number; style?: string; words: { text: string; start: number; end: number }[] }
export type Voiceover = {
  enabled: boolean; textSource: 'manual' | 'subtitles'; text: string; voice: string; lang: string
  speed: number; pitch: number; volume: number; mode: 'replace' | 'overlay'; autoSubtitles: boolean
  wav: string | null; durationMs: number | null; captions: VoiceoverCaption[]
}
export type TtsVoice = { id: string; name: string; lang: string; gender: string; quality: string; desc: string; mb: number; downloaded: boolean }
export type MediaInfo = { full: string; preview: string; strip: string | null; peaks: string | null; kind: 'video' | 'image'; len: number | null; inBin: boolean }
export type Media = Record<string, MediaInfo>
export type Item = {
  id: string | null; file?: string; title: string; mode?: Project['mode']; createdAt: number; updatedAt: number; duration?: number
  outputs: { file: string; at: number }[]; hasOriginal?: boolean; edited?: boolean; thumb: string | null; video: string | null; job: string | null
}
export type Job = { id: string; state: 'uploading' | 'queued' | 'running' | 'done' | 'error'; progress: number; error: string | null; code: string | null; result: string | null; projectId: string | null }

export class ApiError extends Error { constructor(public status: number, public code?: string) { super(code || `HTTP ${status}`) } }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined })
  } catch {
    throw new ApiError(0, 'offline')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data?.error)
  return data as T
}

const enc = encodeURIComponent
export const api = {
  list: () => req<{ items: Item[]; tier: string | null; version: string }>('/api/projects'),
  get: (id: string) => req<{ project: Project; media: Media; tier: string | null; ownFont: boolean; sfx: Record<string, string> }>(`/api/projects/${enc(id)}`),
  memes: (id: string) => req<Record<string, { kind: string; src: string }>>(`/api/projects/${enc(id)}/memes`),
  save: (id: string, body: { clips: Clip[]; music: Music | null; title: string; plan?: Pick<Plan, 'captions' | 'headings' | 'hook'> | null; style?: unknown; voiceover?: Voiceover | null }) => req<{ ok: true; updatedAt: number }>(`/api/projects/${enc(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string) => req<{ undo: string }>(`/api/projects/${enc(id)}`, { method: 'DELETE' }),
  removeFile: (name: string) => req<{ undo: string }>(`/api/projects/file?name=${enc(name)}`, { method: 'DELETE' }),
  restore: (undo: string) => req<{ ok: true }>('/api/projects/restore', { method: 'POST', body: JSON.stringify({ undo }) }),
  reveal: (id: string) => req<{ ok: true }>(`/api/projects/${enc(id)}/reveal`, { method: 'POST' }),
  revealFile: (name: string) => req<{ ok: true }>(`/api/projects/file/reveal?name=${enc(name)}`, { method: 'POST' }),
  render: (id: string) => req<Job>(`/api/projects/${enc(id)}/render`, { method: 'POST', body: JSON.stringify({ draft: false }) }),
  job: (id: string) => req<Job>(`/api/jobs/${enc(id)}`),
  ttsVoices: () => req<{ voices: TtsVoice[]; tier: string; ready: boolean; demoVoice: string }>('/tts/voices'),
  ttsPreview: (body: { voice: string; text?: string }) => req<{ src: string }>('/tts/preview', { method: 'POST', body: JSON.stringify(body) }),
  ttsGenerate: (body: Record<string, unknown>) => req<{ voiceover: Voiceover; src: string; durationMs: number; captions: VoiceoverCaption[] }>('/tts/generate', { method: 'POST', body: JSON.stringify(body) }),
}

/** Адрес сгенерированного голоса для превью (тот же сервер, что и страница) */
export const voiceoverUrl = (id: string) => `/root/.projects/${enc(id)}/voiceover.wav`

export type Face = { src: string; weight: number; style: string; unicodeRange?: string }
export const fontFaces = (id: string) => req<Face[]>(`/api/fonts/${enc(id)}`)

export const downloadUrl = (name: string) => `/api/projects/file/download?name=${enc(name)}`
export const originalUrl = (id: string) => `/api/projects/${enc(id)}/original`
export const CABINET = 'https://cp.tyne.pro/tools/farm'
