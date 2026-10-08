import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { PresetWindow } from './PresetEditor'
import './index.css'
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow'

const isPresetWindow = new URLSearchParams(window.location.search).get('window') === 'preset'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPresetWindow ? <PresetWindow /> : <App />}
  </React.StrictMode>,
)

if (!isPresetWindow) {
  window.setTimeout(async () => {
    try {
      await (await WebviewWindow.getByLabel('splash'))?.close()
    } catch (e) {
      console.error('splash close failed', e)
    }
    try {
      await getCurrentWebviewWindow().show()
    } catch (e) {
      console.error('main show failed', e)
    }
  }, 1500)
}
