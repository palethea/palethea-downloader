import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import HomePage from './pages/HomePage'
import Home from './pages/Home'
import Downloaded from './pages/Downloaded'
import Settings from './pages/Settings'
import Utilities from './pages/Utilities'
import { normalizeDownloadEntry } from './utilityTransforms'
import { isDesktopApp } from './api'

const UTILITIES_STORAGE_KEY = 'palethea-utility-item'

function loadSavedUtilityItem() {
  try {
    const raw = localStorage.getItem(UTILITIES_STORAGE_KEY)
    return raw ? normalizeDownloadEntry(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export default function App() {
  const desktopApp = isDesktopApp()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('palethea-sidebar') === 'collapsed'
  })
  const [settings, setSettings] = useState({
    defaultFormat: 'mp4',
    defaultQuality: '1080p',
    autoDownload: false,
    notifications: true,
  })
  const [utilityItem, setUtilityItem] = useState(() => loadSavedUtilityItem())

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      localStorage.setItem('palethea-sidebar', prev ? 'expanded' : 'collapsed')
      return !prev
    })
  }

  const handleUtilityItemChange = (item) => {
    const normalizedItem = item ? normalizeDownloadEntry(item) : null
    setUtilityItem(normalizedItem)

    if (normalizedItem) {
      localStorage.setItem(UTILITIES_STORAGE_KEY, JSON.stringify(normalizedItem))
      return
    }

    localStorage.removeItem(UTILITIES_STORAGE_KEY)
  }

  return (
    <div className={`app-shell ${desktopApp ? 'desktop-app-shell' : ''}`}>
      {desktopApp ? <TitleBar onToggleSidebar={toggleSidebar} /> : null}
      <div className="app-frame">
        <Sidebar collapsed={sidebarCollapsed} />
        <main className="app-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/download" element={<Home settings={settings} />} />
            <Route path="/library" element={<Downloaded utilityItem={utilityItem} onSelectUtilityItem={handleUtilityItemChange} onClearUtilityItem={() => handleUtilityItemChange(null)} />} />
            <Route path="/utilities" element={<Utilities item={utilityItem} onItemChange={handleUtilityItemChange} />} />
            <Route path="/settings" element={<Settings settings={settings} onChange={setSettings} />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
