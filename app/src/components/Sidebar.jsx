import { NavLink } from 'react-router-dom'
import { HomeIcon, DownloadIcon, SettingsIcon, ArchiveIcon, WrenchIcon } from './Icons'

export default function Sidebar({ collapsed }) {
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <HomeIcon />
          <span className="sidebar-label">Home</span>
        </NavLink>
        <NavLink to="/download" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <DownloadIcon />
          <span className="sidebar-label">Download</span>
        </NavLink>
        <NavLink to="/library" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <ArchiveIcon />
          <span className="sidebar-label">Library</span>
        </NavLink>
        <NavLink to="/utilities" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <WrenchIcon size={18} />
          <span className="sidebar-label">Utilities</span>
        </NavLink>
      </nav>

      <div className="sidebar-bottom">
        <NavLink to="/settings" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <SettingsIcon />
          <span className="sidebar-label">Settings</span>
        </NavLink>
      </div>
    </aside>
  )
}
