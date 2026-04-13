import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDownloads, removeDownload, removeDownloads, clearDownloads, replaceDownloads } from '../downloadHistory'
import { clearLibraryFiles, copyItemToClipboard, deleteLibraryItemFolder, getDownloadUrl, getLibraryFileUrl, isDesktopApp, listLibraryFiles, openLibraryFolder, openItemDefault, showItemInFolder } from '../api'
import { DownloadIcon, XIcon, FileIcon, ClockIcon, PlayIcon, FolderOpenIcon, WrenchIcon, TrashIcon } from '../components/Icons'
import MediaPlayer from '../components/MediaPlayer'
import ThumbnailImage from '../components/ThumbnailImage'
import { Tooltip } from '../components/Tooltip'
import { getMediaFormatChipClass, normalizeMediaQuality } from '../mediaLabels'
import { formatFps } from '../mediaMetadata'
import { getSourceBranding } from '../sourceBranding'
import Toast from '../components/Toast'
import CustomDropdown from '../components/CustomDropdown'
import ContextMenu from '../components/ContextMenu'
import ConfirmationModal from '../components/ConfirmationModal'

function formatDuration(seconds) {
  if (seconds == null || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatBytes(bytes) {
  if (bytes == null) return '—'
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000).toFixed(0)} KB`
}

function formatRelativeTime(isoString) {
  const now = new Date()
  const date = new Date(isoString)
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function formatProviderLabel(source) {
  const brandingLabel = getSourceBranding(source)?.label
  if (brandingLabel) return brandingLabel

  if (typeof source !== 'string' || !source.trim()) return 'Unknown'

  const normalizedSource = source.trim()
  return normalizedSource.charAt(0).toUpperCase() + normalizedSource.slice(1)
}

function formatFormatLabel(format) {
  if (typeof format !== 'string' || !format.trim()) return 'Unknown'
  return format.trim().toUpperCase()
}

function getLibraryMediaTooltip(item) {
  const details = []
  const quality = normalizeMediaQuality(item?.quality, item?.format, item?.fileName)
  const fps = item?.format === 'mp4' ? formatFps(item?.fps) : null

  if (quality) details.push(quality)
  if (fps) details.push(fps)

  if (details.length === 0) return undefined
  return details.join(' • ')
}

export default function Downloaded({ utilityItem, onSelectUtilityItem, onClearUtilityItem }) {
  const navigate = useNavigate()
  const desktopApp = isDesktopApp()
  const [downloads, setDownloads] = useState(() => getDownloads())
  const [activeItem, setActiveItem] = useState(null)
  const [toast, setToast] = useState(null)
  const [confirmation, setConfirmation] = useState(null)

  const [providerFilter, setProviderFilter] = useState('all')
  const [formatFilter, setFormatFilter] = useState('all')
  const [qualityFilter, setQualityFilter] = useState('all')

  const availableProviders = useMemo(() => [...new Set(downloads.map(d => d.source).filter(Boolean))], [downloads])
  const availableFormats = useMemo(() => [...new Set(downloads.map(d => d.format).filter(Boolean))], [downloads])
  const availableQualities = useMemo(() => [...new Set(downloads.map(d => d.quality).filter(Boolean))], [downloads])

  const filteredDownloads = useMemo(() => {
    return downloads.filter(d => {
      if (providerFilter !== 'all' && d.source !== providerFilter) return false
      if (formatFilter !== 'all' && d.format !== formatFilter) return false
      if (qualityFilter !== 'all' && d.quality !== qualityFilter) return false
      return true
    })
  }, [downloads, providerFilter, formatFilter, qualityFilter])

  useEffect(() => {
    if (!desktopApp) {
      return undefined
    }

    let cancelled = false

    const syncDownloadsWithLibrary = async () => {
      const result = await listLibraryFiles()
      if (!result?.ok || cancelled) {
        return
      }

      const existingFiles = new Set((result.files || []).map((fileName) => String(fileName).toLowerCase()))
      const nextDownloads = getDownloads().filter((download) => {
        if (!download?.fileName) {
          return true
        }

        return existingFiles.has(String(download.fileName).toLowerCase())
      })

      const currentDownloads = getDownloads()
      if (nextDownloads.length === currentDownloads.length) {
        return
      }

      replaceDownloads(nextDownloads)
      setDownloads(nextDownloads)

      if (activeItem?.jobId && !nextDownloads.some((download) => download.jobId === activeItem.jobId)) {
        setActiveItem(null)
      }

      if (nextDownloads.length === 0) {
        onClearUtilityItem?.()
      }
    }

    syncDownloadsWithLibrary()

    return () => {
      cancelled = true
    }
  }, [desktopApp, activeItem?.jobId, onClearUtilityItem])

  const handleRemove = (jobId) => {
    if (activeItem?.jobId === jobId) setActiveItem(null)
    removeDownload(jobId)
    setDownloads(getDownloads())

    if (utilityItem?.jobId === jobId) {
      onClearUtilityItem?.()
    }
  }

  const handleDeleteFromDisk = async (item) => {
    if (!desktopApp || !item?.fileName) {
      return
    }

    const result = await deleteLibraryItemFolder(item.fileName)
    if (!result?.ok) {
      setToast({ message: result?.error || 'Could not delete this library folder.', type: 'error' })
      return
    }

    const deletedFiles = new Set((result.deletedFiles || []).map((fileName) => String(fileName).toLowerCase()))
    const deletedJobIds = downloads
      .filter((download) => download?.fileName && deletedFiles.has(String(download.fileName).toLowerCase()))
      .map((download) => download.jobId)

    if (deletedJobIds.length > 0) {
      removeDownloads(deletedJobIds)
    }

    const nextDownloads = getDownloads()
    setDownloads(nextDownloads)

    if (activeItem?.fileName && deletedFiles.has(String(activeItem.fileName).toLowerCase())) {
      setActiveItem(null)
    }

    if (utilityItem?.fileName && deletedFiles.has(String(utilityItem.fileName).toLowerCase())) {
      onClearUtilityItem?.()
    }

    setToast({ message: 'Deleted the library folder from disk.', type: 'success' })
  }

  const handleClear = async () => {
    clearDownloads()
    setDownloads([])
    setActiveItem(null)
    onClearUtilityItem?.()
  }

  const handleDeleteAll = async () => {
    if (!desktopApp) {
      return
    }

    const result = await clearLibraryFiles()
    if (!result?.ok) {
      setToast({ message: result?.error || 'Could not clear the library folder.', type: 'error' })
      return
    }

    clearDownloads()
    setDownloads([])
    setActiveItem(null)
    onClearUtilityItem?.()
    setToast({ message: 'Deleted all library folders from disk.', type: 'success' })
  }

  const requestRemove = (item) => {
    setConfirmation({
      title: 'Remove From History',
      message: `Remove "${item.title}" from the Library list? The file stays on disk.`,
      confirmLabel: 'Remove',
      tone: 'default',
      onConfirm: async () => {
        handleRemove(item.jobId)
        setConfirmation(null)
      },
    })
  }

  const requestClearAll = () => {
    setConfirmation({
      title: 'Clear Library History',
      message: 'Remove every item from the Library list? The files and folders on disk will stay untouched.',
      confirmLabel: 'Clear History',
      tone: 'default',
      onConfirm: async () => {
        await handleClear()
        setConfirmation(null)
      },
    })
  }

  const requestDeleteFromDisk = (item) => {
    setConfirmation({
      title: 'Delete Folder From Disk',
      message: `Delete the entire folder for "${item.title}"? This removes the file and any related outputs saved in that same library folder.`,
      confirmLabel: 'Delete Folder',
      tone: 'danger',
      onConfirm: async () => {
        await handleDeleteFromDisk(item)
        setConfirmation(null)
      },
    })
  }

  const requestDeleteAll = () => {
    setConfirmation({
      title: 'Delete All Library Folders',
      message: 'Delete every library folder from disk? This also removes every item from the Library list.',
      confirmLabel: 'Delete All',
      tone: 'danger',
      onConfirm: async () => {
        await handleDeleteAll()
        setConfirmation(null)
      },
    })
  }

  const [contextMenu, setContextMenu] = useState(null)
  const handleContextMenu = (e, item) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }

  const handleDesktopItemAction = async (action, fallbackMessage) => {
    try {
      const result = await action()
      if (!result?.ok) {
        setToast({ message: result?.error || fallbackMessage, type: 'error' })
        return false
      }
      return true
    } catch {
      setToast({ message: fallbackMessage, type: 'error' })
      return false
    }
  }

  const handleUseUtilities = (item) => {
    onSelectUtilityItem?.(item)
    navigate('/utilities')
  }

  const getContextMenuOptions = (item) => {
    const options = []
    if (desktopApp && item.fileName) {
      options.push({
        label: 'Copy File to Clipboard',
        onClick: async () => {
          const res = await copyItemToClipboard(item.fileName)
          if (res && res.ok) {
            setToast({ message: 'File copied to clipboard', type: 'success' })
          } else {
            setToast({ message: res?.error || 'Could not copy this file to clipboard.', type: 'error' })
          }
        }
      })
      options.push({
        label: 'Open with Default Player',
        onClick: () => handleDesktopItemAction(
          () => openItemDefault(item.fileName),
          'Could not open this file in the default app.'
        )
      })
      options.push({
        label: 'Show in Folder',
        onClick: () => handleDesktopItemAction(
          () => showItemInFolder(item.fileName),
          'Could not reveal this file in the library folder.'
        )
      })
    }
    options.push({
      label: 'Remove from History',
      danger: true,
      onClick: () => requestRemove(item)
    })
    if (desktopApp && item.fileName) {
      options.push({
        label: 'Delete Folder from Disk',
        danger: true,
        onClick: () => requestDeleteFromDisk(item)
      })
    }
    return options
  }

  const handlePlay = (d) => {
    const url = d.fileName ? getLibraryFileUrl(d.fileName) : (d.downloadUrl || getDownloadUrl(d.jobId))
    const playItem = { ...d, downloadUrl: url }
    setActiveItem(activeItem?.jobId === d.jobId ? null : playItem)
  }

  const getSourceLogo = (source) => getSourceBranding(source)?.logoSrc || null

  const getSourceLabel = (source) => getSourceBranding(source)?.label || source

  const handleOpenFolder = async () => {
    const result = await openLibraryFolder()
    if (!result?.ok) {
      setToast({ message: 'Could not open the library folder.', type: 'error' })
    }
  }

  const toastElement = toast ? (
    <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
  ) : null

  const confirmationElement = confirmation ? (
    <ConfirmationModal
      title={confirmation.title}
      message={confirmation.message}
      confirmLabel={confirmation.confirmLabel}
      tone={confirmation.tone}
      onConfirm={confirmation.onConfirm}
      onClose={() => setConfirmation(null)}
    />
  ) : null

  if (downloads.length === 0) {
    return (
      <div className="page-wrapper">
        {toastElement}
        <div className="library-page">
          <div className="library-empty animate-in">
            <div className="library-empty-icon">
              <DownloadIcon />
            </div>
            <h2>No downloads yet</h2>
            <p>Your converted media will be auto-saved into the Palethea library folder.</p>
            {desktopApp && (
              <div style={{ marginTop: 'var(--space-md)' }}>
                <button className="btn-tertiary" onClick={handleOpenFolder}>
                  <FolderOpenIcon size={20} />
                  Open Library Folder
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-wrapper">
      {toastElement}
      <div className="library-page">
        <div className="library-header animate-in" style={{ animationDelay: '0.1s' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
              <h1 className="display-sm">Library</h1>
              {desktopApp && (
                <button className="btn-tertiary" onClick={handleOpenFolder} title="Open Library Folder">
                  <FolderOpenIcon size={24} />
                </button>
              )}
            </div>
            <p className="body-lg">{downloads.length} item{downloads.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="library-header-actions">
            <button className="btn-tertiary" onClick={requestClearAll}>Clear All</button>
            {desktopApp ? <button className="btn-tertiary btn-danger" onClick={requestDeleteAll}>Delete All</button> : null}
          </div>
        </div>

        <div className="library-filters animate-in" style={{ animationDelay: '0.15s' }}>
          {availableProviders.length > 0 && (
            <CustomDropdown
              prefixLabel="Provider"
              value={providerFilter}
              onChange={setProviderFilter}
              options={[
                { value: 'all', label: 'All' },
                ...availableProviders.map(p => ({ value: p, label: formatProviderLabel(p) }))
              ]}
            />
          )}
          {availableFormats.length > 0 && (
            <CustomDropdown
              prefixLabel="Format"
              value={formatFilter}
              onChange={setFormatFilter}
              options={[
                { value: 'all', label: 'All' },
                ...availableFormats.map(f => ({ value: f, label: formatFormatLabel(f) }))
              ]}
            />
          )}
          {availableQualities.length > 0 && (
            <CustomDropdown
              prefixLabel="Quality"
              value={qualityFilter}
              onChange={setQualityFilter}
              options={[
                { value: 'all', label: 'All' },
                ...availableQualities.map(q => ({ value: q, label: q }))
              ]}
            />
          )}
        </div>

        {activeItem && (
          <MediaPlayer
            key={activeItem.jobId}
            item={activeItem}
            onClose={() => setActiveItem(null)}
          />
        )}

        <div className="library-list">
          {filteredDownloads.length === 0 ? (
            <div className="library-empty animate-in" style={{ animationDelay: '0.2s', padding: 'var(--space-2xl) 0' }}>
              <p>No downloads match your filters.</p>
              <button 
                className="btn-tertiary" 
                onClick={() => { setProviderFilter('all'); setFormatFilter('all'); setQualityFilter('all'); }}
                style={{ marginTop: 'var(--space-md)' }}
              >
                Clear Filters
              </button>
            </div>
          ) : (
            filteredDownloads.map((d, index) => (
              <div
                key={d.jobId}
                className={`library-item animate-in ${activeItem?.jobId === d.jobId ? 'active' : ''} playable`}
                style={{ animationDelay: `${0.15 + index * 0.05}s` }}
                onClick={() => handlePlay(d)}
                onContextMenu={(e) => handleContextMenu(e, d)}
              >
                <div className="library-item-thumb">
                <ThumbnailImage thumbnailUrl={d.thumbnailUrl} refererUrl={d.webpageUrl} alt={d.title} />
                {getSourceLogo(d.source) && (
                  <img
                    src={getSourceLogo(d.source)}
                    alt={getSourceLabel(d.source)}
                    style={{ position: 'absolute', top: 4, left: 4, width: 18, height: 18, borderRadius: 4, objectFit: 'contain' }}
                  />
                )}
                {d.duration != null && d.duration > 0 && <span className="duration">{formatDuration(d.duration)}</span>}
                <div className="library-item-play-overlay">
                    <PlayIcon size={20} />
                  </div>
              </div>
              <div className="library-item-info">
                <h3>{d.title}</h3>
                <div className="library-item-meta">
                  <Tooltip label="Media details" message={getLibraryMediaTooltip(d)} align="center" side="top">
                    <span className={`chip ${getMediaFormatChipClass(d.format)}`}>
                      {formatFormatLabel(d.format)}
                    </span>
                  </Tooltip>
                  <span className="library-meta-detail"><FileIcon /> {formatBytes(d.fileSize)}</span>
                  <span className="library-meta-detail"><ClockIcon /> {formatRelativeTime(d.downloadedAt)}</span>
                </div>
              </div>
              <div className="library-item-actions">
                <button
                  className="library-utility-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleUseUtilities(d)
                  }}
                >
                  <WrenchIcon size={14} />
                  Use Utilities
                </button>
                {desktopApp && d.fileName ? (
                  <button
                    className="btn-icon btn-icon-danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      requestDeleteFromDisk(d)
                    }}
                    aria-label="Delete folder from disk"
                    title="Delete folder from disk"
                  >
                    <TrashIcon size={14} />
                  </button>
                ) : null}
                <button className="btn-icon" onClick={(e) => { e.stopPropagation(); requestRemove(d) }} aria-label="Remove from history">
                  <XIcon size={14} />
                </button>
              </div>
            </div>
            ))
          )}
        </div>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={getContextMenuOptions(contextMenu.item)}
          onClose={() => setContextMenu(null)}
        />
      )}
      {confirmationElement}
    </div>
  )
}
