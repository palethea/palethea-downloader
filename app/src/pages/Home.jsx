import { useState, useEffect, useCallback, useRef } from 'react'
import { LinkIcon, ArrowRightIcon, ArrowLeftIcon, BoltIcon, LockIcon, CheckIcon, XIcon, DownloadIcon, FileIcon, ClockIcon, WrenchIcon, AlertCircleIcon, FolderOpenIcon } from '../components/Icons'
import Toast from '../components/Toast'
import ThumbnailImage from '../components/ThumbnailImage'
import { inspect, createJob, getJob, getDownloadUrl, openLibraryFolder, isDesktopApp, ApiError } from '../api'
import { addDownload } from '../downloadHistory'
import { getMediaBadgeLabel, getMediaFormatChipClass } from '../mediaLabels'
import { formatFps, getFrameRateForQuality } from '../mediaMetadata'
import { getSourceBranding } from '../sourceBranding'

function formatDuration(seconds) {
  if (seconds == null || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatBytes(bytes) {
  if (bytes == null) return { value: '—', unit: '' }
  if (bytes >= 1_000_000_000) return { value: (bytes / 1_000_000_000).toFixed(2), unit: 'GB' }
  if (bytes >= 1_000_000) return { value: (bytes / 1_000_000).toFixed(1), unit: 'MB' }
  return { value: (bytes / 1_000).toFixed(0), unit: 'KB' }
}

const STAGE_LABELS = {
  queued: 'Queued — waiting for a processing slot…',
  downloading: 'Downloading source media…',
  converting: 'Converting to your selected format…',
  ready: 'Finalizing your download…',
}

const PLACEHOLDERS = [
  'https://youtube.com/watch?v=...',
  'https://soundcloud.com/artist/track',
  'https://instagram.com/reel/Cxxx...',
  'https://tiktok.com/@user/video/...'
]

export default function Home({ settings }) {
  const desktopApp = isDesktopApp()
  const [view, setView] = useState('home')
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState(settings?.defaultFormat || 'mp4')
  const [quality, setQuality] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)

  // Typewriter state
  const [placeholderText, setPlaceholderText] = useState('')
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)

  // Inspect result
  const [meta, setMeta] = useState(null)

  // Job state
  const [job, setJob] = useState(null)
  const [downloadHref, setDownloadHref] = useState('')
  const pollRef = useRef(null)

  const selectedFps = getFrameRateForQuality(meta?.frameRates, quality)
  const formattedSelectedFps = formatFps(selectedFps)
  const sourceBranding = getSourceBranding(meta?.source)

  useEffect(() => {
    setFormat(settings?.defaultFormat || 'mp4')
  }, [settings?.defaultFormat])

  // When meta loads, pick default quality for the selected format
  useEffect(() => {
    if (!meta) return
    const fmtInfo = meta.availableFormats?.[format]
    if (fmtInfo) {
      setQuality(fmtInfo.defaultQuality)
      return
    }

    const fallbackFormat = Object.keys(meta.availableFormats || {})[0]
    if (fallbackFormat && fallbackFormat !== format) {
      setFormat(fallbackFormat)
    }
  }, [meta, format])

  // Typewriter effect
  useEffect(() => {
    if (url || loading) return // pause when user is typing or loading

    let timer
    const currentFullLine = PLACEHOLDERS[placeholderIndex]

    if (isDeleting) {
      timer = setTimeout(() => {
        setPlaceholderText(currentFullLine.substring(0, placeholderText.length - 1))
        if (placeholderText.length === 0) {
          setIsDeleting(false)
          setPlaceholderIndex((placeholderIndex + 1) % PLACEHOLDERS.length)
        }
      }, 50) // typing speed backward
    } else {
      timer = setTimeout(() => {
        setPlaceholderText(currentFullLine.substring(0, placeholderText.length + 1))
        if (placeholderText.length === currentFullLine.length) {
          timer = setTimeout(() => setIsDeleting(true), 2500) // pause at end
        }
      }, 80) // typing speed forward
    }

    return () => clearTimeout(timer)
  }, [placeholderText, isDeleting, placeholderIndex, url, loading])

  // Clean up polling on unmount
  useEffect(() => () => { clearInterval(pollRef.current) }, [])

  // --- Step 1: Inspect ---
  const handleInspect = useCallback(async () => {
    setError('')
    if (!url.trim()) {
      setError('Please paste a YouTube, SoundCloud, Instagram, or TikTok URL to continue.')
      return
    }

    setLoading(true)
    try {
      const data = await inspect(url.trim())
      setMeta(data)
      const fmtInfo = data.availableFormats?.[format]
      if (fmtInfo) {
        setQuality(fmtInfo.defaultQuality)
      } else {
        const fallbackFormat = Object.keys(data.availableFormats || {})[0]
        if (fallbackFormat) {
          setFormat(fallbackFormat)
          setQuality(data.availableFormats[fallbackFormat]?.defaultQuality || '')
        }
      }
      setView('metadata')
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Could not reach the server. Please check your connection and try again.')
      }
    } finally {
      setLoading(false)
    }
  }, [url, format])

  // --- Polling ---
  const startPolling = useCallback((jobId) => {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const data = await getJob(jobId)
        setJob(data)
        if (data.status === 'completed') {
          clearInterval(pollRef.current)
          setDownloadHref(getDownloadUrl(jobId))
          setView('complete')
          addDownload({
            jobId,
            title: data.title || data.fileName || meta?.title,
            thumbnailUrl: meta?.thumbnailUrl,
            webpageUrl: meta?.webpageUrl,
            source: meta?.source || 'unknown',
            format,
            quality,
            fileSize: data.fileSize,
            duration: meta?.duration,
            fps: format === 'mp4' ? getFrameRateForQuality(meta?.frameRates, quality) : null,
            fileName: data.fileName,
            downloadUrl: getDownloadUrl(jobId),
          })
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current)
          setToast({ message: data.error?.message || 'Conversion failed. Please try again.', type: 'error' })
          setError(data.error?.message || 'Conversion failed. Please try again.')
          setView('metadata')
        } else if (data.status === 'expired') {
          clearInterval(pollRef.current)
          setToast({ message: 'This job has expired. Please start a new conversion.', type: 'error' })
          setError('This job has expired. Please start a new conversion.')
          setView('metadata')
        }
      } catch {
        clearInterval(pollRef.current)
        setToast({ message: 'Lost connection while checking progress. Please try again.', type: 'error' })
        setView('metadata')
      }
    }, 1500)
  }, [format, meta, quality])

  // --- Step 2: Start job ---
  const handleStartJob = useCallback(async () => {
    if (!meta || !quality) return
    setLoading(true)
    setError('')
    try {
      const data = await createJob(url.trim(), format, quality)
      setJob(data.job)
      setDownloadHref(data.downloadUrl)
      setView('processing')
      startPolling(data.job.id)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setToast({ message: err.message, type: 'error' })
      } else {
        setToast({ message: 'Failed to start conversion. Please try again.', type: 'error' })
      }
    } finally {
      setLoading(false)
    }
  }, [meta, url, format, quality, startPolling])

  const handleCancel = () => {
    clearInterval(pollRef.current)
    setView('metadata')
    setJob(null)
  }

  const handleConvertAnother = () => {
    clearInterval(pollRef.current)
    setUrl('')
    setError('')
    setMeta(null)
    setJob(null)
    setQuality('')
    setDownloadHref('')
    setView('home')
  }

  const handlePrimaryCompleteAction = async () => {
    if (desktopApp) {
      const result = await openLibraryFolder()
      if (!result?.ok) {
        setToast({ message: 'Could not open the library folder.', type: 'error' })
      }
      return
    }

    if (!downloadHref) return
    const a = document.createElement('a')
    a.href = downloadHref
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const toastElement = toast ? (
    <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
  ) : null

  // --- View: Processing ---
  if (view === 'processing') {
    const stage = job?.stage || 'queued'
    const progress = job?.progress ?? 0
    return (
      <div className="page-wrapper download-wrapper">
        {toastElement}
        <div className="processing-page">
          <span className="processing-brand">Palethea</span>
          <div className="card processing-card">
            <div className="processing-thumbnail">
              <ThumbnailImage thumbnailUrl={meta?.thumbnailUrl} refererUrl={meta?.webpageUrl} alt={meta?.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <span className="chip chip-secondary processing-badge">
                <WrenchIcon />
                {stage === 'queued' ? 'Queued' : 'Processing'}
              </span>
            </div>
            <div className="processing-info">
              <div>
                <div className="processing-filename">{job?.title || meta?.title}</div>
                <div className="processing-format">
                  Converting to {quality} {format.toUpperCase()} {format === 'mp4' ? '(H.264)' : ''}{formattedSelectedFps ? ` · ${formattedSelectedFps}` : ''}
                </div>
              </div>
              <div className="processing-progress">
                <span className="processing-percent">{progress}%</span>
                <div className="processing-eta">
                  <div className="eta-label">Stage</div>
                  <div className="eta-value" style={{ fontSize: 'var(--label-lg)', textTransform: 'capitalize' }}>{stage}</div>
                </div>
              </div>
              <div className="progress-track">
                <div className={`progress-fill ${stage === 'queued' ? 'secondary' : ''}`} style={{ width: `${progress}%` }} />
              </div>
              <dl className="processing-meta">
                <div>
                  <dt>Format</dt>
                  <dd>{format.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Quality</dt>
                  <dd>{quality}</dd>
                </div>
              </dl>
            </div>
            <div className="processing-actions">
              <span className="processing-status-text body-md" style={{ color: 'var(--on-surface-variant)' }}>
                {STAGE_LABELS[stage] || 'Processing…'}
              </span>
              <button className="btn-secondary" onClick={handleCancel}>
                <XIcon size={16} />
                Cancel
              </button>
            </div>
          </div>
          <div className="processing-status">
            <span className="chip chip-neutral">
              <span style={{ width: 6, height: 6, borderRadius: 9999, background: '#2e8b57', display: 'inline-block' }} />
              Palethea Engine is running at 100% efficiency.
            </span>
          </div>
        </div>
      </div>
    )
  }

  // --- View: Complete ---
  if (view === 'complete') {
    const size = formatBytes(job?.fileSize)
    const dur = formatDuration(meta?.duration)
    return (
      <div className="page-wrapper download-wrapper">
        {toastElement}
        <div className="complete-page">
          <div className="complete-layout">
            <div className="complete-left animate-in">
              <div className="complete-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className="check-badge">
                  <CheckIcon size={12} />
                </span>
              </div>
              <h1>Ready for Pickup.</h1>
              <p className="body-lg">
                {desktopApp
                  ? 'Your media has been saved automatically to the Palethea library folder.'
                  : 'Your media has been processed and is ready for local storage.'}
              </p>
              <button className="btn-tertiary" onClick={handleConvertAnother}>
                <ArrowLeftIcon />
                Convert another video
              </button>
            </div>
            <div className="complete-right animate-in">
              <div className="card" style={{ padding: 'var(--space-xl)' }}>
                <div className="video-info">
                  <div className="video-thumb">
                    <ThumbnailImage thumbnailUrl={meta?.thumbnailUrl} refererUrl={meta?.webpageUrl} alt={meta?.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <span className="duration">{dur}</span>
                  </div>
                  <div className="video-details">
                    <span className={`chip ${getMediaFormatChipClass(format)}`} style={{ marginBottom: '0.5rem', fontSize: '0.625rem' }}>
                      {getMediaBadgeLabel({ quality, format })}
                    </span>
                    {formattedSelectedFps ? (
                      <span className="chip chip-neutral" style={{ marginBottom: '0.5rem', fontSize: '0.625rem' }}>
                        {formattedSelectedFps}
                      </span>
                    ) : null}
                    <h3>{job?.fileName || job?.title || meta?.title}</h3>
                      <span className="source" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        {sourceBranding?.logoSrc ? <img src={sourceBranding.logoSrc} alt={sourceBranding.label} style={{ width: 14, height: 14, borderRadius: 2 }} /> : null}
                        {sourceBranding?.label || meta?.source || 'unknown'}
                      </span>
                  </div>
                </div>
                <div className="file-stats" style={{ marginTop: 'var(--space-lg)' }}>
                  <div className="stat-block">
                    <div className="stat-label">
                      <FileIcon />
                      File Size
                    </div>
                    <span className="stat-value">{size.value}</span>
                    <span className="stat-unit">{size.unit}</span>
                  </div>
                  <div className="stat-block">
                    <div className="stat-label">
                      <ClockIcon />
                      Duration
                    </div>
                    <span className="stat-value">{dur}</span>
                    <span className="stat-unit">min</span>
                  </div>
                  {formattedSelectedFps ? (
                    <div className="stat-block">
                      <div className="stat-label">
                        <BoltIcon />
                        Frame Rate
                      </div>
                      <span className="stat-value">{Math.round(selectedFps * 100) / 100}</span>
                      <span className="stat-unit">fps</span>
                    </div>
                  ) : null}
                </div>
                <button
                  className="btn-primary"
                  onClick={handlePrimaryCompleteAction}
                  style={{ marginTop: 'var(--space-lg)' }}
                >
                  {desktopApp ? <FolderOpenIcon /> : <DownloadIcon />}
                  {desktopApp ? 'Open Library Folder' : 'Download Now'}
                </button>
                <div className="download-footer" style={{ marginTop: 'var(--space-lg)' }}>
                  <div className="download-badges">
                    <span><span className="badge-dot green" /> Virus Scanned</span>
                    <span><span className="badge-dot blue" /> Direct Link</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // --- View: Metadata / Quality picker ---
  if (view === 'metadata' && meta) {
    const fmtInfo = meta.availableFormats?.[format]
    const qualities = fmtInfo?.qualities || []
    const estSizes = meta.estimatedSizes?.[format] || {}
    const dur = formatDuration(meta.duration)
    return (
      <div className="page-wrapper download-wrapper">
        {toastElement}
        <div className="metadata-page">
          <button className="btn-tertiary" onClick={handleConvertAnother} style={{ marginBottom: 'var(--space-lg)' }}>
            <ArrowLeftIcon />
            Back
          </button>

          <div className="metadata-layout">
            <div className="metadata-preview animate-in">
              <div className="metadata-thumb">
                <ThumbnailImage thumbnailUrl={meta?.thumbnailUrl} refererUrl={meta?.webpageUrl} alt={meta?.title} />
                <span className="duration">{dur}</span>
              </div>
              <div className="metadata-details">
                <h2 className="headline-md">{meta.title}</h2>
                <span className="body-md" style={{ color: 'var(--on-surface-variant)' }}>{meta.channel}</span>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                    <span className="chip chip-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      {sourceBranding?.logoSrc ? <img src={sourceBranding.logoSrc} alt={sourceBranding.label} style={{ width: 14, height: 14, borderRadius: 2 }} /> : null}
                      {sourceBranding?.label || meta.source}
                    </span>
                  <span className="chip chip-neutral">{dur}</span>
                  {formattedSelectedFps ? <span className="chip chip-neutral">{formattedSelectedFps}</span> : null}
                </div>
              </div>
            </div>

            <div className="card metadata-options animate-in">
              <span className="label-md" style={{ marginBottom: 'var(--space-sm)', display: 'block' }}>Format</span>
              <div className="toggle-group" style={{ marginBottom: 'var(--space-lg)' }}>
                {Object.keys(meta.availableFormats).map((f) => (
                  <button
                    key={f}
                    className={`toggle-btn ${format === f ? 'active' : ''}`}
                    onClick={() => setFormat(f)}
                  >
                    {f.toUpperCase()} {f === 'mp4' ? 'Video' : 'Audio'}
                  </button>
                ))}
              </div>

              <span className="label-md" style={{ marginBottom: 'var(--space-sm)', display: 'block' }}>Quality</span>
              <div className="quality-list">
                {qualities.map((q) => {
                  const est = estSizes[q]
                  const size = formatBytes(est)
                  const fps = format === 'mp4' ? formatFps(getFrameRateForQuality(meta.frameRates, q)) : null
                  return (
                    <button
                      key={q}
                      className={`quality-option ${quality === q ? 'active' : ''}`}
                      onClick={() => setQuality(q)}
                    >
                      <span className="quality-label">{fps ? `${q} · ${fps}` : q}</span>
                      {est ? (
                        <span className="quality-size">{size.value} {size.unit}</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>

              {error && (
                <div className="error-message" style={{ marginTop: 'var(--space-md)' }}>
                  <AlertCircleIcon />
                  {error}
                </div>
              )}

              <button
                className="btn-primary"
                onClick={handleStartJob}
                disabled={loading || !quality}
                style={{ marginTop: 'var(--space-lg)' }}
              >
                {loading ? 'Starting…' : 'Convert Now'}
                {!loading && <ArrowRightIcon />}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // --- View: Home (URL input) ---
  return (
    <div className="page-wrapper download-wrapper">
      {toastElement}
      <section className="home-hero">
        <div className="home-header animate-in">
          <h1 className="display-sm" style={{ fontSize: 'var(--display-md)' }}>
            Convert &amp; <span className="accent">Download.</span>
          </h1>
          <p className="body-lg" style={{ marginTop: 'var(--space-sm)' }}>
            Paste a link to extract high-fidelity media directly to your drive. Built for precision.
          </p>
        </div>

        <div className="home-action-area animate-in" style={{ animationDelay: '0.1s' }}>
          <div className="card home-card">
            <span className="label-md card-label">Source URL</span>
            <div className={`input-field ${error ? 'error' : ''}`}>
              <input
                type="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError('') }}
                placeholder={placeholderText}
                autoComplete="off"
                spellCheck="false"
                onKeyDown={(e) => e.key === 'Enter' && handleInspect()}
                disabled={loading}
              />
              <button
                type="button"
                className="input-icon"
                title="Paste from clipboard"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText()
                    if (text) {
                      setUrl(text)
                      setError('')
                    }
                  } catch (err) {
                    console.error('Failed to read clipboard', err)
                  }
                }}
              >
                <LinkIcon />
              </button>
            </div>
            {error && (
              <div className="error-message">
                <AlertCircleIcon />
                {error}
              </div>
            )}
            <button className="btn-primary" onClick={handleInspect} disabled={loading}>
              {loading ? (
                <>
                  <div className="btn-spinner" style={{ marginRight: '6px' }} />
                  Inspecting…
                </>
              ) : 'Inspect'}
              {!loading && <ArrowRightIcon />}
            </button>
            <span className="format-hint">We'll verify available formats and bandwidth.</span>
          </div>
        </div>
      </section>
    </div>
  )
}
