import { useEffect } from 'react'
import { CheckIcon, AlertCircleIcon, XIcon } from './Icons'

export default function Toast({ message, type = 'info', onClose, duration = 4000 }) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [message, duration, onClose])

  if (!message) return null

  const icon = type === 'success' ? <CheckIcon size={16} /> : <AlertCircleIcon />

  return (
    <div className={`toast toast-${type}`}>
      <span className="toast-icon">{icon}</span>
      <span className="toast-message">{message}</span>
      <button className="toast-close" onClick={onClose} aria-label="Dismiss">
        <XIcon size={14} />
      </button>
    </div>
  )
}
