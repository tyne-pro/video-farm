import { useCallback, useEffect, useState } from 'react'
import { api, downloadUrl, originalUrl, CABINET, type Item } from './api'
import { fmt, lang, t, when } from './i18n'
import { Confirm, Header, tierName, toast } from './ui'

type Filter = 'all' | 'ready' | 'drafts'
const MODE = { cut: 'modeCut', clips: 'modeClips', script: 'modeScript' } as const

export function List() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [tier, setTier] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [ask, setAsk] = useState<Item | null>(null)

  const load = useCallback(() => {
    api.list().then((d) => { setItems(d.items); setTier(d.tier); setOffline(false) }).catch(() => setOffline(true))
  }, [])
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i) }, [load])

  const remove = async (it: Item) => {
    try {
      const { undo } = it.id ? await api.remove(it.id) : await api.removeFile(it.file!)
      setItems((list) => list?.filter((x) => x !== it) ?? null)
      toast(t('deleted'), { ms: 15000, action: { label: t('undo'), run: () => api.restore(undo).then(() => { toast(t('restored')); load() }).catch(() => toast(t('failed'), { err: true })) } })
    } catch { toast(t('failed'), { err: true }) }
  }
  const reveal = (it: Item) => (it.id ? api.reveal(it.id) : api.revealFile(it.file!)).catch(() => toast(t('failed'), { err: true }))

  const ready = items?.filter((x) => x.outputs.length && !x.edited) ?? []
  const drafts = items?.filter((x) => x.id && (x.edited || !x.outputs.length)) ?? []
  const shown = filter === 'ready' ? ready : filter === 'drafts' ? drafts : items ?? []

  return (
    <>
      <Header right={tierName(tier) && <span className="pill ok"><span className="dot" />{t('connected')} · {tierName(tier)}</span>} />
      <main className="page">
        <h1>{t('myClips')}</h1>
        <p className="sub">{t('listSub')}</p>
        {offline && <p className="empty" role="alert">{t('noApp')}</p>}
        {items && items.length > 0 && (
          <div className="tabs" role="tablist">
            {([['all', items.length], ['ready', ready.length], ['drafts', drafts.length]] as const).map(([k, n]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{t(k)} · {n}</button>
            ))}
          </div>
        )}
        {items && items.length === 0 && (
          <div className="empty"><p>{t('empty')}</p><a className="btn main" href={`${CABINET}?lang=${lang}`}>{t('openFarm')}</a></div>
        )}
        <div className="grid">
          {shown.map((it, i) => {
            const last = it.outputs.at(-1)
            const changed = !!it.id && (it.edited || !last)
            return (
              <article key={it.id || it.file} className="card" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                <div className="thumb">
                  {it.video
                    ? <video src={`${it.video}#t=0.8`} muted playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => { e.currentTarget.pause() }} />
                    : it.thumb && <video src={`${it.thumb}#t=0.5`} muted playsInline preload="metadata" />}
                  <span className={`badge ${changed ? 'b-draft' : 'b-final'}`}>{changed ? t('draft') : t('final')}</span>
                  {it.duration ? <span className="dur">{fmt(it.duration)}</span> : null}
                </div>
                <div className="body">
                  <div>
                    <p className="t">{it.title}</p>
                    <p className="meta">{when(it.updatedAt)} · {it.mode ? t(MODE[it.mode]) : t('noProject')}</p>
                  </div>
                  <div className="row">
                    {it.id && <a className="btn main" href={`#/edit/${it.id}`}>✎ {t('edit')}</a>}
                    {last && <a className="btn" href={downloadUrl(last.file)} download>⬇ {t('download')}</a>}
                  </div>
                  <div className="row">
                    {it.id && it.hasOriginal && <a className="btn" href={originalUrl(it.id)} download>⬇ {t('original')}</a>}
                    <button className="btn" onClick={() => reveal(it)}>📁 {t('inFolder')}</button>
                    <button className="btn danger" onClick={() => setAsk(it)} aria-label={t('remove')} title={t('remove')}>🗑</button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
        {items && items.length > 0 && <p className="note">{t('note')}</p>}
      </main>
      {ask && <Confirm title={t('delTitle')} text={t('delText')} ok={t('remove')} danger onOk={() => remove(ask)} onClose={() => setAsk(null)} />}
    </>
  )
}
