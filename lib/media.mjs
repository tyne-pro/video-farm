// ============================================================================
// Работа с медиа через ffmpeg/ffprobe: пробы, синхрон по звуку, громкость,
// джамп-каты по тишине, нарезка прокси и синтез звуковых эффектов.
// ============================================================================

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'

export function run(bin, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true })
    const out = []
    let err = ''
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => {
      const s = d.toString()
      err += s
      if (err.length > 200_000) err = err.slice(-100_000)
      onStderr?.(s)
    })
    p.on('error', (e) => reject(new Error(`${bin} не запустился: ${e.message}`)))
    p.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err })
      else reject(new Error(`${bin} завершился с кодом ${code}: ${err.split('\n').slice(-8).join('\n')}`))
    })
  })
}

export const ffmpeg = (args, opts) => run(FFMPEG, ['-hide_banner', '-y', ...args], opts)

export async function probe(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ])
  const j = JSON.parse(stdout.toString())
  const v = j.streams.find((s) => s.codec_type === 'video')
  const a = j.streams.find((s) => s.codec_type === 'audio')
  let width = v?.width || 0
  let height = v?.height || 0
  // Телефоны пишут вертикаль как горизонталь + поворот в метаданных
  const rot = Number(v?.tags?.rotate || v?.side_data_list?.find((s) => s.rotation != null)?.rotation || 0)
  if (Math.abs(rot) === 90 || Math.abs(rot) === 270) [width, height] = [height, width]
  return {
    duration: Number(j.format.duration) || Number(v?.duration) || 0,
    width,
    height,
    hasAudio: !!a,
  }
}

// --- Синхронизация двух записей по звуку ------------------------------------

const ENV_RATE = 100 // точек огибающей в секунду (шаг 10 мс)

/** Огибающая громкости (RMS по 10 мс) первых maxSec секунд дорожки. */
async function loudnessEnvelope(file, maxSec) {
  const sr = 8000
  const { stdout } = await ffmpeg([
    '-i', file, '-t', String(maxSec), '-vn', '-ac', '1', '-ar', String(sr),
    '-af', 'highpass=f=120,lowpass=f=3500', '-f', 's16le', 'pipe:1',
  ])
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2))
  const hop = sr / ENV_RATE
  const n = Math.floor(samples.length / hop)
  const env = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < hop; k++) {
      const x = samples[i * hop + k] / 32768
      s += x * x
    }
    env[i] = Math.log10(1e-6 + Math.sqrt(s / hop))
  }
  // Нормируем: ноль в среднем, единичная дисперсия — чтобы разная
  // громкость микрофонов не влияла на корреляцию
  let mean = 0
  for (const x of env) mean += x
  mean /= n || 1
  let v = 0
  for (let i = 0; i < n; i++) { env[i] -= mean; v += env[i] * env[i] }
  const sd = Math.sqrt(v / (n || 1)) || 1
  for (let i = 0; i < n; i++) env[i] /= sd
  return env
}

function fft(re, im, invert) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (invert ? -1 : 1)
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j]
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr
        re[i + j] = ur + vr; im[i + j] = ui + vi
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
  if (invert) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}

/**
 * Сдвиг второй записи относительно первой (сек): событие в момент t головы
 * находится в планшете в момент t - offset. Кросс-корреляция огибающих через
 * FFT. confidence — во сколько раз пик выше фона (≥ 4 — уверенно).
 */
export async function findAudioOffset(headFile, tabletFile, maxSec = 600) {
  const a = await loudnessEnvelope(headFile, maxSec)
  const b = await loudnessEnvelope(tabletFile, maxSec)
  if (a.length < ENV_RATE * 2 || b.length < ENV_RATE * 2) return { offset: 0, confidence: 0 }
  let n = 1
  while (n < a.length + b.length) n <<= 1
  const ar = new Float64Array(n), ai = new Float64Array(n)
  const br = new Float64Array(n), bi = new Float64Array(n)
  ar.set(a); br.set(b)
  fft(ar, ai, false); fft(br, bi, false)
  for (let i = 0; i < n; i++) {
    // A · conj(B)
    const r = ar[i] * br[i] + ai[i] * bi[i]
    const im = ai[i] * br[i] - ar[i] * bi[i]
    ar[i] = r; ai[i] = im
  }
  fft(ar, ai, true)
  // ar[k] — корреляция при сдвиге k (голова отстаёт от планшета на k точек),
  // ar[n-k] — при отрицательном сдвиге
  let best = -Infinity, bestLag = 0, sum = 0, sumSq = 0, cnt = 0
  const maxLag = Math.min(n - 1, Math.max(a.length, b.length))
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const idx = lag >= 0 ? lag : n + lag
    // Нормируем на длину перекрытия, чтобы края не выигрывали
    const overlap = Math.min(a.length, b.length + lag) - Math.max(0, lag)
    if (overlap < ENV_RATE * 2) continue
    const v = ar[idx] / overlap
    sum += v; sumSq += v * v; cnt++
    if (v > best) { best = v; bestLag = lag }
  }
  const mean = sum / cnt
  const sd = Math.sqrt(Math.max(1e-12, sumSq / cnt - mean * mean))
  return { offset: bestLag / ENV_RATE, confidence: (best - mean) / sd }
}

// --- Громкость и джамп-каты -------------------------------------------------

/** Голос: шумодав-лайт + компрессия + loudnorm до -14 LUFS (уровень TikTok). */
export async function normalizeVoice(input, output) {
  await ffmpeg([
    '-i', input, '-vn', '-ac', '1', '-ar', '48000',
    '-af', [
      'highpass=f=80',
      'afftdn=nf=-25',
      'acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2',
      'loudnorm=I=-14:TP=-1.5:LRA=9',
    ].join(','),
    '-c:a', 'pcm_s16le', output,
  ])
}

/**
 * Участки речи по silencedetect. Паузы длиннее minSilence вырезаются,
 * вокруг речи оставляется pad секунд «воздуха».
 */
export async function speechSegments(audioFile, duration, { noiseDb = -38, minSilence = 0.5, pad = 0.12 } = {}) {
  const { stderr } = await ffmpeg([
    '-i', audioFile, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`, '-f', 'null', '-',
  ])
  const silences = []
  let start = null
  for (const line of stderr.split('\n')) {
    const s = line.match(/silence_start: ([\d.]+)/)
    const e = line.match(/silence_end: ([\d.]+)/)
    if (s) start = Number(s[1])
    if (e && start != null) { silences.push([start, Number(e[1])]); start = null }
  }
  if (start != null) silences.push([start, duration])
  const segs = []
  let cur = 0
  for (const [s, e] of silences) {
    const segEnd = Math.min(duration, s + pad)
    if (segEnd - cur > 0.25) segs.push([Math.max(0, cur), segEnd])
    cur = Math.max(0, e - pad)
  }
  if (duration - cur > 0.25) segs.push([cur, duration])
  // Склеиваем слишком близкие куски (разрыв < 80 мс не даёт «прыжка»)
  const merged = []
  for (const s of segs) {
    const last = merged[merged.length - 1]
    if (last && s[0] - last[1] < 0.08) last[1] = s[1]
    else merged.push([...s])
  }
  return merged.length ? merged : [[0, duration]]
}

// Оставить только кадры/сэмплы внутри сегментов и сомкнуть время
function selectExpr(segs) {
  return segs.map(([s, e]) => `between(t,${s.toFixed(3)},${(e - 0.0005).toFixed(3)})`).join('+')
}

// ffmpeg ≥ 7.1 читает граф из файла через «-/filter_complex», старые — через
// -filter_complex_script (в 8.x его убрали). Пробуем новый синтаксис первым.
async function ffmpegScript(pre, script, post, opts) {
  try {
    return await ffmpeg([...pre, '-/filter_complex', script, ...post], opts)
  } catch (e) {
    if (!/Unrecognized option|Option not found/.test(e.message)) throw e
    return ffmpeg([...pre, '-filter_complex_script', script, ...post], opts)
  }
}

async function withFilterScript(dir, name, filter, fn) {
  // Длинные графы (сотни склеек) не влезают в командную строку Windows
  const file = path.join(dir, name)
  fs.writeFileSync(file, filter)
  try { return await fn(file) } finally { fs.rmSync(file, { force: true }) }
}

/** Режет аудио по сегментам и склеивает подряд. */
export async function cutAudio(input, segs, output, workDir) {
  const filter = `[0:a]aselect='${selectExpr(segs)}',asetpts=N/SR/TB[out]`
  await withFilterScript(workDir, 'cut-audio.txt', filter, (script) =>
    ffmpegScript(['-i', input], script, ['-map', '[out]', '-c:a', 'pcm_s16le', output]))
}

/**
 * Прокси видео: CFR 30 fps, H.264, нужный размер, без звука, сразу с
 * джамп-катами. shift — сдвиг дорожки (сек) для синхрона планшета с головой.
 */
export async function cutVideo(input, segs, output, workDir, { maxW, maxH, shift = 0, totalDuration, onProgress }) {
  const scale = `scale=w='min(${maxW},iw)':h='min(${maxH},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
  let pre = `[0:v]fps=30,${scale},format=yuv420p`
  // Планшет начат позже головы → вставляем в начало застывший первый кадр
  if (shift > 0) pre += `,tpad=start_duration=${shift.toFixed(3)}:start_mode=clone`
  if (shift < 0) pre += `,trim=start=${(-shift).toFixed(3)},setpts=PTS-STARTPTS`
  // Короче головы → держим последний кадр до конца
  pre += `,tpad=stop_duration=${Math.ceil(totalDuration + 5)}:stop_mode=clone`
  const finalFilter = `${pre},select='${selectExpr(segs)}',setpts=N/30/TB[out]`
  const outDur = segs.reduce((s, [a, b]) => s + (b - a), 0)
  await withFilterScript(workDir, `cut-${path.basename(output)}.txt`, finalFilter, (script) =>
    ffmpegScript(['-i', input], script, [
      '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '30', output,
    ], {
      onStderr: (s) => {
        const m = s.match(/time=(\d+):(\d+):([\d.]+)/)
        if (m && onProgress) onProgress(Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / (outDur || 1)))
      },
    }))
}

/** Средняя яркость (0..1) области кадра — чтобы выбрать белые/чёрные субтитры. */
export async function regionBrightness(file, duration, { x, y, w, h }) {
  try {
    const times = [0.15, 0.35, 0.55, 0.75, 0.9].map((k) => (duration * k).toFixed(2))
    let sum = 0, cnt = 0
    for (const t of times) {
      const { stdout } = await ffmpeg([
        '-ss', t, '-i', file, '-frames:v', '1',
        '-vf', `crop=iw*${w}:ih*${h}:iw*${x}:ih*${y},scale=1:1,format=gray`,
        '-f', 'rawvideo', 'pipe:1',
      ])
      if (stdout.length) { sum += stdout[0] / 255; cnt++ }
    }
    return cnt ? sum / cnt : 0.3
  } catch {
    return 0.3
  }
}

// --- Звуковые эффекты (синтез, без лицензий) ---------------------------------

const SFX = {
  // Клик мышки: короткий щелчок шума + высокий «тик»
  click: "aevalsrc='(random(0)*2-1)*exp(-t*900)*0.9+sin(2*PI*3200*t)*exp(-t*600)*0.5':s=48000:d=0.06",
  // Пишущая машинка: удар (шум) + низкий «тук» каретки
  type: "aevalsrc='(random(0)*2-1)*exp(-t*350)*0.7+sin(2*PI*180*t)*exp(-t*60)*0.6':s=48000:d=0.09",
  // Поп мема: свип вверх 250→1100 Гц с быстрым затуханием
  pop: "aevalsrc='sin(2*PI*(250*t+5000*t*t))*exp(-t*28)*0.9':s=48000:d=0.16",
  // Свуш для заголовков тем: шум с нарастанием и спадом
  whoosh: "aevalsrc='(random(0)*2-1)*sin(PI*t/0.35)*0.5':s=48000:d=0.35",
}

export async function ensureSfx(dir) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, src] of Object.entries(SFX)) {
    const out = path.join(dir, `${name}.wav`)
    if (fs.existsSync(out)) continue
    const extra = name === 'whoosh' ? ['-af', 'bandpass=f=1800:w=1600'] : ['-af', 'highpass=f=60']
    await ffmpeg(['-f', 'lavfi', '-i', src, ...extra, '-ac', '2', out])
  }
}

/**
 * Фоновая музыка по умолчанию: спокойный синтезированный пэд (аккорды Am–F–C–G
 * по 4 с, 120 с, зациклен в рендере). Свою музыку можно положить в папку music/.
 */
export async function ensureDefaultMusic(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, 'pad.m4a')
  if (fs.existsSync(out)) return out
  const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]]
  // Номер аккорда = floor(t/4) mod 4; выбираем частоты вложенными if()
  const pick = (k) => {
    const c = (i) => chords[i][k]
    return `if(lt(mod(t,16),4),${c(0)},if(lt(mod(t,16),8),${c(1)},if(lt(mod(t,16),12),${c(2)},${c(3)})))`
  }
  const voice = (k) => `sin(2*PI*${pick(k)}*t)*0.18+sin(2*PI*${pick(k)}*2*t)*0.04`
  const env = '(0.6+0.4*sin(PI*mod(t,4)/4))'
  const expr = `(${voice(0)}+${voice(1)}+${voice(2)})*${env}`
  await ffmpeg([
    '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=44100:d=64`,
    '-af', 'lowpass=f=1800,aecho=0.8:0.7:120|240:0.35|0.2,volume=0.8',
    '-ac', '2', '-c:a', 'aac', '-b:a', '128k', out,
  ])
  return out
}
