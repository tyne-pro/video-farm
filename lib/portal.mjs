// ============================================================================
// Связь с кабинетом tyne.pro: адрес портала, личный ключ, учёт ролика и текстовый план.
// Видео сюда не попадает: на сервер уходит только ключ, режим, длина и текст.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = () => process.env.FARM_DATA || here
const readText = (name) => { try { return fs.readFileSync(path.join(dataDir(), name), 'utf8').trim() } catch { return '' } }

export const PORTAL = (process.env.FARM_PORTAL || readText('.portal') || 'https://cp.tyne.pro').replace(/\/$/, '')
/** Ключ программы (кнопка «Підключити кабінет»); страница кабинета может передать свой */
export const savedKey = () => process.env.FARM_KEY || readText('.portal-key')

export class PortalError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

async function post(pathname, body) {
  let res
  try {
    res = await fetch(`${PORTAL}${pathname}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
    })
  } catch {
    throw new PortalError('offline', 'offline')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) throw new PortalError('auth', 'auth')
  if (res.status === 402) throw new PortalError('limit', 'limit')
  if (res.status === 429) throw new PortalError('busy', 'busy')
  if (!res.ok) throw new PortalError('server', data?.error || `HTTP ${res.status}`)
  return data
}

/** Засчитать ролик: { runId, tier, limits, left } */
export const portalRun = (k, mode, sec) => post('/api/farm/run', { k, mode, sec })
/** Вернуть ролик в лимит, если монтаж сорвался */
export const portalRefund = (k, runId) => post('/api/farm/refund', { k, runId }).catch(() => null)
/** Текстовый план ролика от языковой модели на сервере */
export const portalPlan = (k, body) => post('/api/farm/plan', { k, ...body }).then((d) => d.plan)

/** Тариф и остаток для окна программы */
export async function portalMe(k) {
  if (!k) return null
  try {
    const res = await fetch(`${PORTAL}/api/farm/me?k=${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(15_000) })
    return res.ok ? res.json() : null
  } catch { return null }
}

export const withKey = (url, k) => (k && url.startsWith(PORTAL) ? `${url}${url.includes('?') ? '&' : '?'}k=${encodeURIComponent(k)}` : url)
