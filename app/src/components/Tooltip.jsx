import { InfoIcon } from './Icons'

export function Tooltip({ label, message, align = 'right', side = 'bottom', children, triggerClassName = '' }) {
  if (!message) {
    return children ?? null
  }

  const wrapperClassName = `app-tooltip app-tooltip-${align} app-tooltip-${side}`
  const anchorClassName = ['app-tooltip-anchor', triggerClassName].filter(Boolean).join(' ')

  return (
    <span className={wrapperClassName}>
      {children ? (
        <span className={anchorClassName} tabIndex={0} aria-label={label}>
          {children}
        </span>
      ) : (
        <button type="button" className={`app-tooltip-trigger ${triggerClassName}`.trim()} aria-label={label}>
          <InfoIcon size={14} />
        </button>
      )}
      <span className="app-tooltip-bubble" role="tooltip">{message}</span>
    </span>
  )
}

export function InfoTooltip(props) {
  return <Tooltip {...props} />
}