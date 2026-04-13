import { useEffect, useState } from 'react'
import { closeWindow, getWindowState, isDesktopApp, minimizeWindow, onWindowStateChange, toggleMaximizeWindow } from '../api'
import { PanelLeftIcon, TitleBarCloseIcon, TitleBarMaximizeIcon, TitleBarMinimizeIcon, TitleBarRestoreIcon } from './Icons'

export default function TitleBar({ onToggleSidebar }) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (!isDesktopApp()) {
      return undefined
    }

    let cancelled = false

    getWindowState().then((result) => {
      if (!cancelled && result?.ok) {
        setIsMaximized(Boolean(result.isMaximized))
      }
    })

    const unsubscribe = onWindowStateChange((payload) => {
      setIsMaximized(Boolean(payload?.isMaximized))
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (!isDesktopApp()) {
    return null
  }

  const handleToggleMaximize = async () => {
    const result = await toggleMaximizeWindow()
    if (result?.ok) {
      setIsMaximized(Boolean(result.isMaximized))
    }
  }

  return (
    <header className="titlebar-shell">
      <div className="titlebar-sidebar-bridge">
        <span className="titlebar-sidebar-brand">Palethea</span>
        <button className="titlebar-sidebar-toggle" type="button" aria-label="Toggle sidebar" onClick={onToggleSidebar}>
          <PanelLeftIcon />
        </button>
      </div>
      <div className="titlebar-drag-region" onDoubleClick={handleToggleMaximize} />

      <div className="titlebar-window-controls">
        <button className="titlebar-window-btn" type="button" aria-label="Minimize window" onClick={() => minimizeWindow()}>
          <TitleBarMinimizeIcon />
        </button>
        <button
          className="titlebar-window-btn"
          type="button"
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          onClick={handleToggleMaximize}
        >
          {isMaximized ? <TitleBarRestoreIcon /> : <TitleBarMaximizeIcon />}
        </button>
        <button className="titlebar-window-btn close" type="button" aria-label="Close window" onClick={() => closeWindow()}>
          <TitleBarCloseIcon />
        </button>
      </div>
    </header>
  )
}