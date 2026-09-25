import { createRoot } from 'react-dom/client'
import { App } from '../../src/popup/app'
import '../../src/styles/globals.css'

const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
