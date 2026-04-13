import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDownload } from '../downloadHistory'
import { compressMediaToSize, extractAudioFromMedia, fixTikTok120Fps, isDesktopApp, onUtilityProgress, openItemDefault, showItemInFolder } from '../api'
import MediaPlayer from '../components/MediaPlayer'
import { InfoTooltip } from '../components/Tooltip'
import Toast from '../components/Toast'
import { formatFps } from '../mediaMetadata'
import { getMediaBadgeLabel, getMediaFormatChipClass } from '../mediaLabels'
import { getSourceBranding } from '../sourceBranding'
import { ArrowRightIcon, FolderOpenIcon, GlobeIcon, PlayIcon, WrenchIcon } from '../components/Icons'
import {
  appendUtilityTransformation,
  formatTargetSizeMb,
  formatUtilityTransformationLabel,
  hasUtilityTransformation,
  isUtilityModified,
  normalizeTransformations,
  UTILITY_TRANSFORMATIONS,
} from '../utilityTransforms'

function formatBytes(bytes) {
  if (bytes == null) return '—'
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000).toFixed(0)} KB`
}

function formatDuration(seconds) {
  if (seconds == null || seconds <= 0) return '—'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function deriveDefaultTargetSizeMb(fileSize) {
  const currentSizeMb = typeof fileSize === 'number' ? fileSize / 1000000 : 0
  if (!Number.isFinite(currentSizeMb) || currentSizeMb <= 0) {
    return '25'
  }

  const targetSizeMb = Math.max(1, Math.min(currentSizeMb - 0.2, currentSizeMb * 0.72))
  if (targetSizeMb >= currentSizeMb) {
    return Math.max(1, Math.floor(currentSizeMb)).toString()
  }

  const rounded = Math.round(targetSizeMb * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function buildDerivedUtilityJobId(item, suffix) {
  const baseId = typeof item?.jobId === 'string' && item.jobId.trim() ? item.jobId.trim() : 'utility'
  return `${baseId}:${suffix}:${Date.now()}`
}

function ProgressButton({ busy, progress, idleLabel, busyLabel, onClick, disabled }) {
  const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0

  return (
    <button
      className={`btn-primary utility-action-btn ${busy ? 'busy' : ''}`}
      onClick={onClick}
      disabled={disabled}
      style={busy ? { '--utility-progress': `${safeProgress}%` } : undefined}
    >
      {busy ? (
        <>
          <span className="utility-action-btn-fill" aria-hidden="true" />
          <span className="utility-action-btn-content">
            <span>{busyLabel}</span>
            <span>{safeProgress}%</span>
          </span>
        </>
      ) : idleLabel}
    </button>
  )
}

export default function Utilities({ item, onItemChange }) {
  const navigate = useNavigate()
  const desktopApp = isDesktopApp()
  const [isFixingFps, setIsFixingFps] = useState(false)
  const [isExtractingAudio, setIsExtractingAudio] = useState(false)
  const [isCompressing, setIsCompressing] = useState(false)
  const [utilityProgress, setUtilityProgress] = useState({})
  const [targetSizeMbInput, setTargetSizeMbInput] = useState(() => deriveDefaultTargetSizeMb(item?.fileSize))
  const [toast, setToast] = useState(null)

  useEffect(() => {
    setTargetSizeMbInput(deriveDefaultTargetSizeMb(item?.fileSize))
  }, [item?.fileSize, item?.jobId, item?.fileName])

  useEffect(() => {
    const unsubscribe = onUtilityProgress((payload) => {
      if (!payload?.operation) {
        return
      }

      setUtilityProgress((current) => ({
        ...current,
        [payload.operation]: {
          progress: Number.isFinite(payload.progress) ? payload.progress : 0,
          stage: payload.stage || 'running',
        },
      }))
    })

    return unsubscribe
  }, [])

  const sourceBranding = item?.source ? getSourceBranding(item.source) : null
  const transformations = useMemo(() => normalizeTransformations(item?.transformations, item?.fileName), [item])
  const isModifiedCopy = isUtilityModified(item)
  const hasFpsCompatibilityTransform = hasUtilityTransformation(item, UTILITY_TRANSFORMATIONS.TIKTOK_60FPS_COMPAT)
  const hasAudioExtractionTransform = hasUtilityTransformation(item, UTILITY_TRANSFORMATIONS.AUDIO_EXTRACTION)
  const hasCompressionTransform = hasUtilityTransformation(item, UTILITY_TRANSFORMATIONS.TARGET_SIZE_COMPRESSION)
  const targetSizeMb = Number(targetSizeMbInput)
  const currentSizeMb = typeof item?.fileSize === 'number' ? item.fileSize / 1000000 : null
  const supportsCompression = Boolean(item?.fileName && item?.duration && (item?.format === 'mp4' || item?.format === 'mp3'))
  const canExtractAudio = Boolean(item?.fileName && item?.format === 'mp4' && !hasAudioExtractionTransform)
  const canCreateCompatibilityVersion = Boolean(
    item?.fileName &&
    item?.source === 'tiktok' &&
    item?.format === 'mp4' &&
    !hasFpsCompatibilityTransform
  )
  const canCompressToTargetSize = Boolean(
    supportsCompression &&
    !hasCompressionTransform &&
    Number.isFinite(targetSizeMb) &&
    targetSizeMb > 0 &&
    typeof item?.fileSize === 'number' &&
    targetSizeMb * 1000000 < item.fileSize
  )

  const compressionNote = (() => {
    if (!supportsCompression) {
      return 'Compression is currently available only for MP4 and MP3 files with duration metadata.'
    }
    if (hasCompressionTransform) {
      return 'This file is already a compressed output. Duplicate compression is locked.'
    }
    if (!Number.isFinite(targetSizeMb) || targetSizeMb <= 0) {
      return 'Enter a valid target size in MB.'
    }
    if (typeof item?.fileSize === 'number' && targetSizeMb * 1000000 >= item.fileSize) {
      return 'Target size must be smaller than the current file size.'
    }
    return 'Creates a new compressed copy beside the current file and swaps this library entry to it.'
  })()

  const fileStatusMessage = isModifiedCopy
    ? 'Utilities already changed this file. Duplicate transformations stay locked so the same operation cannot be stacked again.'
    : 'This is the original download. Running a tool will replace this library entry with the new output.'

  const compatibilityMessage = canCreateCompatibilityVersion
    ? 'Creates a smoother 60 FPS TikTok fix and replaces the active file in this workspace.'
    : hasFpsCompatibilityTransform
      ? 'This file already has the 60 FPS compatibility fix, so running it again is locked.'
      : 'Available only for original TikTok MP4 files saved in your library.'

  const extractAudioMessage = canExtractAudio
    ? 'Pulls the audio track out of this MP4 and adds the MP3 as a separate library item.'
    : hasAudioExtractionTransform
      ? 'This file is already an extracted audio output, so running it again is locked.'
      : 'Available only for MP4 video files in your library.'

  const compressionMessage = `Re-encodes this file toward a target size while keeping the same format. ${compressionNote}`

  const handleDesktopAction = async (action, fallbackMessage) => {
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

  const handleCreateCompatibilityVersion = async () => {
    if (!item?.fileName || isFixingFps || !canCreateCompatibilityVersion) return

    setIsFixingFps(true)
    setUtilityProgress((current) => ({
      ...current,
      'tiktok-fix': { progress: 0, stage: 'running' },
    }))
    let completed = false
    try {
      const result = await fixTikTok120Fps(item.fileName)
      if (!result?.ok) {
        setToast({ message: result?.error || 'Could not create the compatibility version.', type: 'error' })
        return
      }

      const updatedItem = {
        ...item,
        fileName: result.fileName,
        fileSize: result.fileSize,
        duration: result.duration ?? item.duration,
        fps: result.fps ?? 60,
        transformations: appendUtilityTransformation(item, {
          type: UTILITY_TRANSFORMATIONS.TIKTOK_60FPS_COMPAT,
          sourceFileName: item.fileName,
          createdAt: new Date().toISOString(),
        }),
      }

      addDownload({
        jobId: item.jobId,
        fileName: result.fileName,
        fileSize: result.fileSize,
        duration: result.duration ?? item.duration,
        fps: result.fps ?? 60,
        transformations: updatedItem.transformations,
      })
      onItemChange?.(updatedItem)
      setToast({ message: 'Created a 60 FPS fix.', type: 'success' })
      completed = true
    } finally {
      setIsFixingFps(false)
      if (completed) {
        setUtilityProgress((current) => ({
          ...current,
          'tiktok-fix': { progress: 100, stage: 'completed' },
        }))
      }
    }
  }

  const handleCompressToTargetSize = async () => {
    if (!item?.fileName || isCompressing || !canCompressToTargetSize) return

    setIsCompressing(true)
    setUtilityProgress((current) => ({
      ...current,
      compress: { progress: 0, stage: 'running' },
    }))
    let completed = false
    try {
      const result = await compressMediaToSize(item.fileName, targetSizeMb, item.duration, item.format)
      if (!result?.ok) {
        setToast({ message: result?.error || 'Could not compress this file to the requested size.', type: 'error' })
        return
      }

      const updatedItem = {
        ...item,
        fileName: result.fileName,
        fileSize: result.fileSize,
        duration: result.duration ?? item.duration,
        fps: result.fps ?? item.fps,
        transformations: appendUtilityTransformation(item, {
          type: UTILITY_TRANSFORMATIONS.TARGET_SIZE_COMPRESSION,
          targetSizeMb,
          sourceFileName: item.fileName,
          createdAt: new Date().toISOString(),
        }),
      }

      addDownload({
        jobId: item.jobId,
        fileName: result.fileName,
        fileSize: result.fileSize,
        duration: result.duration ?? item.duration,
        fps: result.fps ?? item.fps,
        transformations: updatedItem.transformations,
      })
      onItemChange?.(updatedItem)
      setToast({ message: `Compressed this file toward ${formatTargetSizeMb(targetSizeMb)}.`, type: 'success' })
      completed = true
    } finally {
      setIsCompressing(false)
      if (completed) {
        setUtilityProgress((current) => ({
          ...current,
          compress: { progress: 100, stage: 'completed' },
        }))
      }
    }
  }

  const handleExtractAudio = async () => {
    if (!item?.fileName || isExtractingAudio || !canExtractAudio) return

    setIsExtractingAudio(true)
    setUtilityProgress((current) => ({
      ...current,
      'extract-audio': { progress: 0, stage: 'running' },
    }))
    let completed = false
    try {
      const result = await extractAudioFromMedia(item.fileName)
      if (!result?.ok) {
        setToast({ message: result?.error || 'Could not extract audio from this file.', type: 'error' })
        return
      }

      const updatedItem = {
        ...item,
        transformations: appendUtilityTransformation(item, {
          type: UTILITY_TRANSFORMATIONS.AUDIO_EXTRACTION,
          sourceFileName: item.fileName,
          createdAt: new Date().toISOString(),
        }),
      }

      addDownload({
        jobId: item.jobId,
        transformations: updatedItem.transformations,
      })

      addDownload({
        ...item,
        jobId: buildDerivedUtilityJobId(item, 'audio-extraction'),
        fileName: result.fileName,
        fileSize: result.fileSize,
        format: 'mp3',
        quality: '320k',
        duration: result.duration ?? item.duration,
        fps: null,
        transformations: appendUtilityTransformation(null, {
          type: UTILITY_TRANSFORMATIONS.AUDIO_EXTRACTION,
          sourceFileName: item.fileName,
          createdAt: new Date().toISOString(),
        }),
      })
      onItemChange?.(updatedItem)
      setToast({ message: 'Extracted audio and added it to the library.', type: 'success' })
      completed = true
    } finally {
      setIsExtractingAudio(false)
      if (completed) {
        setUtilityProgress((current) => ({
          ...current,
          'extract-audio': { progress: 100, stage: 'completed' },
        }))
      }
    }
  }

  const tiktokFixProgress = utilityProgress['tiktok-fix']?.progress ?? 0
  const extractAudioProgress = utilityProgress['extract-audio']?.progress ?? 0
  const compressionProgress = utilityProgress.compress?.progress ?? 0

  if (!item) {
    return (
      <div className="page-wrapper">
        <div className="utilities-page">
          <div className="utilities-empty animate-in">
            <div className="utilities-empty-icon">
              <WrenchIcon size={28} />
            </div>
            <h1 className="display-sm">Utilities</h1>
            <p>Choose a file from your library to start working with it here.</p>
            <button className="btn-primary btn-auto" onClick={() => navigate('/library')}>
              Open Library
              <ArrowRightIcon />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-wrapper">
      {toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null}
      <div className="utilities-page">
        <div className="utilities-header animate-in">
          <div className="utilities-header-copy">
            <p className="label-lg">Selected File</p>
            <h1 className="display-sm">Utilities</h1>
          </div>
          <div className="utilities-header-actions">
            {desktopApp ? (
              <button
                className="utilities-header-icon"
                type="button"
                aria-label="Open file"
                title="Open file"
                onClick={() => handleDesktopAction(
                  () => openItemDefault(item.fileName),
                  'Could not open this file in the default app.'
                )}
              >
                <PlayIcon size={16} />
              </button>
            ) : null}
            {desktopApp ? (
              <button
                className="utilities-header-icon"
                type="button"
                aria-label="Show in folder"
                title="Show in folder"
                onClick={() => handleDesktopAction(
                  () => showItemInFolder(item.fileName),
                  'Could not reveal this file in the library folder.'
                )}
              >
                <FolderOpenIcon size={16} />
              </button>
            ) : null}
            {item.webpageUrl ? (
              <a
                className="utilities-header-icon"
                href={item.webpageUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open source"
                title="Open source"
              >
                <GlobeIcon />
              </a>
            ) : null}
            <button className="btn-secondary" onClick={() => navigate('/library')}>
              Choose Another File
            </button>
          </div>
        </div>

        <div className="utilities-layout">
          <section className="utilities-stage animate-in" style={{ animationDelay: '0.08s' }}>
            <div className="utilities-identity">
              <div className="utilities-titleblock">
                <div className="utilities-badge-row">
                  {sourceBranding?.logoSrc ? <img className="utilities-source-logo" src={sourceBranding.logoSrc} alt={sourceBranding.label} /> : null}
                  <span className="chip chip-neutral">{sourceBranding?.label || item.source || 'Media'}</span>
                  <span className={`chip ${getMediaFormatChipClass(item.format)}`}>{getMediaBadgeLabel(item)}</span>
                  {item.format === 'mp4' && formatFps(item.fps) ? <span className="chip chip-neutral">{formatFps(item.fps)}</span> : null}
                </div>
                <div className="utilities-title-row">
                  <h2>{item.title}</h2>
                  <InfoTooltip label="About this file" message={fileStatusMessage} align="left" />
                </div>
              </div>
            </div>

            <div className="utilities-preview-shell">
              <MediaPlayer item={item} inline />
            </div>

            <div className="utilities-stage-details">
              <div className="utilities-stat-grid">
                <div className="utilities-stat">
                  <span className="utilities-stat-label">Size</span>
                  <strong>{formatBytes(item.fileSize)}</strong>
                </div>
                <div className="utilities-stat">
                  <span className="utilities-stat-label">Duration</span>
                  <strong>{formatDuration(item.duration)}</strong>
                </div>
                <div className="utilities-stat">
                  <span className="utilities-stat-label">Format</span>
                  <strong>{item.format?.toUpperCase() || '—'}</strong>
                </div>
                <div className="utilities-stat">
                  <span className="utilities-stat-label">Frame Rate</span>
                  <strong>{formatFps(item.fps) || '—'}</strong>
                </div>
              </div>

              <div className="utilities-history-panel">
                <div className="utilities-history-head">
                  <div className="utilities-history-title">
                    <p className="label-lg">File Status</p>
                    <div className="utilities-history-title-row">
                      <h3>{isModifiedCopy ? 'Modified in Utilities' : 'Original Download'}</h3>
                      <InfoTooltip label="File status details" message={fileStatusMessage} />
                    </div>
                  </div>
                  <span className={`chip ${isModifiedCopy ? 'chip-primary' : 'chip-success'}`}>
                    {transformations.length > 0 ? `${transformations.length} Change${transformations.length !== 1 ? 's' : ''}` : 'Clean Source'}
                  </span>
                </div>

                {transformations.length > 0 ? (
                  <div className="utilities-history-list">
                    {transformations.map((transformation) => (
                      <div className="utilities-history-item" key={transformation.type}>
                        <strong>{formatUtilityTransformationLabel(transformation)}</strong>
                        <span>
                          {transformation.createdAt
                            ? new Date(transformation.createdAt).toLocaleString()
                            : 'Detected from the current output file'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="utilities-history-empty">No utilities have modified this file yet.</p>
                )}
              </div>
            </div>
          </section>

          <aside className="utilities-rail animate-in" style={{ animationDelay: '0.14s' }}>
            <div className="utilities-section">
              <div className="utilities-section-head">
                <p className="label-lg">Actions</p>
                <InfoTooltip label="Utilities overview" message="Each tool creates a new output and then makes that output the active file shown here." />
              </div>

              <div className={`utility-action ${canCreateCompatibilityVersion ? 'available' : 'locked'}`}>
                <div className="utility-action-head">
                  <div className="utility-action-title">
                    <h3>TikTok 60 FPS Fix</h3>
                    <InfoTooltip label="Compatibility version details" message={compatibilityMessage} />
                  </div>
                  <span className={`utility-state-pill ${canCreateCompatibilityVersion ? 'ready' : 'locked'}`}>
                    {canCreateCompatibilityVersion ? 'Ready' : 'Locked'}
                  </span>
                </div>
                <ProgressButton
                  busy={isFixingFps}
                  progress={tiktokFixProgress}
                  idleLabel="Run Utility"
                  busyLabel="Fixing..."
                  onClick={handleCreateCompatibilityVersion}
                  disabled={!canCreateCompatibilityVersion || isFixingFps}
                />
              </div>

              <div className={`utility-action ${canExtractAudio ? 'available' : 'locked'}`}>
                <div className="utility-action-head">
                  <div className="utility-action-title">
                    <h3>Extract Audio</h3>
                    <InfoTooltip label="Extract audio details" message={extractAudioMessage} />
                  </div>
                  <span className={`utility-state-pill ${canExtractAudio ? 'ready' : 'locked'}`}>
                    {canExtractAudio ? 'Ready' : 'Locked'}
                  </span>
                </div>
                <ProgressButton
                  busy={isExtractingAudio}
                  progress={extractAudioProgress}
                  idleLabel="Run Utility"
                  busyLabel="Extracting..."
                  onClick={handleExtractAudio}
                  disabled={!canExtractAudio || isExtractingAudio}
                />
              </div>

              <div className={`utility-action ${canCompressToTargetSize ? 'available' : 'locked'}`}>
                <div className="utility-action-head">
                  <div className="utility-action-title">
                    <h3>Compress to Specific Size</h3>
                    <InfoTooltip label="Compression details" message={compressionMessage} />
                  </div>
                  <span className={`utility-state-pill ${canCompressToTargetSize ? 'ready' : 'locked'}`}>
                    {canCompressToTargetSize ? 'Ready' : 'Locked'}
                  </span>
                </div>
                <div className="utility-inline-form">
                  <label className="utility-input-field">
                    <span className="utility-input-label">Target Size</span>
                    <div className="utility-input-wrap">
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={targetSizeMbInput}
                        onChange={(event) => setTargetSizeMbInput(event.target.value)}
                      />
                      <span>MB</span>
                    </div>
                  </label>
                  {currentSizeMb ? (
                    <p className="utility-input-hint">Current size: {formatTargetSizeMb(currentSizeMb)}</p>
                  ) : null}
                </div>
                <ProgressButton
                  busy={isCompressing}
                  progress={compressionProgress}
                  idleLabel="Run Utility"
                  busyLabel="Compressing..."
                  onClick={handleCompressToTargetSize}
                  disabled={!canCompressToTargetSize || isCompressing}
                />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}