import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from './Icons'

export default function ConfirmationModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onClose,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose?.()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isSubmitting, onClose])

  const handleConfirm = async () => {
    if (isSubmitting) {
      return
    }

    setIsSubmitting(true)
    try {
      await onConfirm?.()
    } finally {
      setIsSubmitting(false)
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={() => { if (!isSubmitting) onClose?.() }}>
      <div className="modal confirmation-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close confirmation" disabled={isSubmitting}>
            <XIcon />
          </button>
        </div>

        <p className="confirmation-modal-message">{message}</p>

        <div className="confirmation-modal-actions">
          <button className="btn-secondary confirmation-modal-cancel" onClick={onClose} disabled={isSubmitting}>
            {cancelLabel}
          </button>
          <button
            className={`btn-primary btn-auto confirmation-modal-confirm ${tone === 'danger' ? 'danger' : ''}`}
            onClick={handleConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}