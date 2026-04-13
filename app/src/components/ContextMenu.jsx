import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const EDGE_PADDING = 12

export default function ContextMenu({ x, y, options, onClose }) {
  const menuRef = useRef(null)

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return

    const rect = menu.getBoundingClientRect()
    const maxLeft = Math.max(EDGE_PADDING, window.innerWidth - rect.width - EDGE_PADDING)
    const maxTop = Math.max(EDGE_PADDING, window.innerHeight - rect.height - EDGE_PADDING)
    const nextLeft = Math.min(Math.max(x, EDGE_PADDING), maxLeft)
    const nextTop = Math.min(Math.max(y, EDGE_PADDING), maxTop)

    menu.style.left = `${nextLeft}px`
    menu.style.top = `${nextTop}px`
  }, [x, y, options.length])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose()
      }
    }
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Adjust position to stay on screen
  const style = {
    position: 'fixed',
    top: y,
    left: x,
    zIndex: 2000,
  }

  return createPortal(
    <div ref={menuRef} className="context-menu" style={style}>
      <div className="dropdown-menu-inner">
        {options.map((opt, i) => (
          <button
            key={i}
            className={`dropdown-item ${opt.danger ? 'danger' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              opt.onClick()
              onClose()
            }}
          >
            {opt.icon && <span style={{ marginRight: '8px' }}>{opt.icon}</span>}
            {opt.label}
          </button>
        ))}
      </div>
    </div>,
    document.body
  )
}
