import { Link, NavLink } from 'react-router-dom'
import { SettingsIcon } from './Icons'

export default function Nav({ onSettingsClick }) {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link to="/" className="nav-brand">Palethea</Link>
        <div className="nav-links">
          <NavLink to="/how-it-works" className={({ isActive }) => isActive ? 'active' : ''}>
            How it Works
          </NavLink>
          <NavLink to="/supported-sites" className={({ isActive }) => isActive ? 'active' : ''}>
            Supported Sites
          </NavLink>
          <NavLink to="/premium" className={({ isActive }) => isActive ? 'active' : ''}>
            Premium
          </NavLink>
        </div>
        <button className="nav-settings" aria-label="Settings" onClick={onSettingsClick}>
          <SettingsIcon />
        </button>
      </div>
    </nav>
  )
}
