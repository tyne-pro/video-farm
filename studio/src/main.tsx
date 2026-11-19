import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { List } from './List'
import { Editor } from './Editor'
import { Toasts } from './ui'

// Дві сторінки: #/ — мої ролики, #/edit/<id> — редактор
function useRoute() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

function App() {
  const hash = useRoute()
  const edit = hash.match(/^#\/edit\/([a-f0-9]{6,32})/)
  return (
    <>
      {edit ? <Editor key={edit[1]} id={edit[1]} /> : <List />}
      <Toasts />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
