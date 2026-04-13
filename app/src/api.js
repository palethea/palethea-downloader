const BASE_URL = import.meta.env.VITE_MEDIA_API_BASE_URL || 'https://api.palethea.com/media-api'

const ERROR_MESSAGES = {
  INVALID_URL: 'That URL doesn\u2019t look right. Please paste a valid YouTube, SoundCloud, Instagram, or TikTok link.',
  UNSUPPORTED_SOURCE: 'This source isn\u2019t supported yet. Only YouTube, SoundCloud, Instagram, and TikTok URLs are accepted.',
  UNSUPPORTED_VIDEO: 'This video can\u2019t be processed. It may be private or region-locked.',
  AGE_RESTRICTED: 'This video is age-restricted and cannot be downloaded.',
  VIDEO_TOO_LONG: 'This video exceeds the maximum allowed duration.',
  QUALITY_NOT_SUPPORTED: 'The selected quality isn\u2019t available for this video.',
  RATE_LIMITED: 'You\u2019ve made too many requests. Please wait a moment and try again.',
  JOB_NOT_FOUND: 'This conversion job could not be found.',
  DOWNLOAD_NOT_READY: 'Your download isn\u2019t ready yet. Please wait for processing to finish.',
  DOWNLOAD_EXPIRED: 'This download has expired. Please start a new conversion.',
  CONVERSION_FAILED: 'The conversion failed. Please try again or choose a different quality.',
  INTERNAL_ERROR: 'Something went wrong on our end. Please try again later.',
}

class ApiError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.code = code
    this.details = details
  }
}

function getFriendlyErrorMessage(error) {
  const code = error?.code || 'INTERNAL_ERROR'
  const backendMessage = error?.message
  const reason = typeof error?.details?.reason === 'string' ? error.details.reason : ''
  const normalizedReason = reason.toLowerCase()

  if (normalizedReason.includes("confirm you're not a bot") || normalizedReason.includes('confirm you\u2019re not a bot')) {
    return 'The source platform blocked this media with an anti-bot check. Try a different URL, or update the backend yt-dlp cookie setup.'
  }

  if (code === 'CONVERSION_FAILED' && backendMessage && backendMessage !== 'The requested media could not be processed.') {
    return backendMessage
  }

  if (code === 'INTERNAL_ERROR' && backendMessage) {
    return backendMessage
  }

  return ERROR_MESSAGES[code] || backendMessage || ERROR_MESSAGES.INTERNAL_ERROR
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  if (!res.ok) {
    let body
    try {
      body = await res.json()
    } catch {
      throw new ApiError('INTERNAL_ERROR', ERROR_MESSAGES.INTERNAL_ERROR)
    }

    if (body?.error) {
      const code = body.error.code || 'INTERNAL_ERROR'
      const message = getFriendlyErrorMessage(body.error)
      throw new ApiError(code, message, body.error.details)
    }

    throw new ApiError('INTERNAL_ERROR', ERROR_MESSAGES.INTERNAL_ERROR)
  }

  return res.json()
}

export async function inspect(videoUrl) {
  return request('/inspect', {
    method: 'POST',
    body: JSON.stringify({ url: videoUrl }),
  })
}

export async function createJob(videoUrl, format, quality) {
  return request('/jobs', {
    method: 'POST',
    body: JSON.stringify({ url: videoUrl, format, quality }),
  })
}

export async function getJob(jobId) {
  return request(`/jobs/${encodeURIComponent(jobId)}`)
}

export function getDownloadUrl(jobId) {
  return `${BASE_URL}/jobs/${encodeURIComponent(jobId)}/download`
}

function shouldProxyThumbnailUrl(thumbnailUrl) {
  try {
    const parsed = new URL(thumbnailUrl)
    const host = parsed.hostname.toLowerCase()

    return [
      'instagram.com',
      'cdninstagram.com',
      'fbcdn.net',
      'fbcdn.com',
      'fbsbx.com',
    ].some((root) => host === root || host.endsWith(`.${root}`))
  } catch {
    return false
  }
}

export function getThumbnailSources(thumbnailUrl, refererUrl) {
  if (typeof thumbnailUrl !== 'string') return []

  const trimmed = thumbnailUrl.trim()
  if (!trimmed) return []

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (shouldProxyThumbnailUrl(trimmed)) {
        const params = new URLSearchParams({ url: trimmed })
        if (typeof refererUrl === 'string' && refererUrl.trim()) {
          params.set('referer', refererUrl.trim())
        }

        return [`${BASE_URL}/thumbnail?${params.toString()}`, trimmed]
      }

      return [trimmed]
    }
  } catch {
    return [trimmed]
  }

  return [trimmed]
}

export function getThumbnailUrl(thumbnailUrl, refererUrl) {
  return getThumbnailSources(thumbnailUrl, refererUrl)[0] || ''
}

export function getLibraryFileUrl(fileName) {
  return `${BASE_URL}/library/${encodeURIComponent(fileName)}`
}

export function isDesktopApp() {
  return typeof window !== 'undefined' && Boolean(window.paletheaDesktop?.isDesktop)
}

async function callDesktopBridge(methodName, ...args) {
  if (typeof window === 'undefined' || typeof window.paletheaDesktop?.[methodName] !== 'function') {
    return { ok: false, error: 'Desktop integration unavailable.' }
  }

  try {
    return await window.paletheaDesktop[methodName](...args)
  } catch (error) {
    return { ok: false, error: error?.message || 'Desktop integration unavailable.' }
  }
}

export function onUtilityProgress(listener) {
  if (typeof window === 'undefined' || typeof window.paletheaDesktop?.onUtilityProgress !== 'function') {
    return () => {}
  }

  return window.paletheaDesktop.onUtilityProgress((payload) => {
    try {
      listener?.(payload)
    } catch {
      // Ignore listener failures so Electron events do not break the bridge.
    }
  })
}

export function onWindowStateChange(listener) {
  if (typeof window === 'undefined' || typeof window.paletheaDesktop?.onWindowStateChange !== 'function') {
    return () => {}
  }

  return window.paletheaDesktop.onWindowStateChange((payload) => {
    try {
      listener?.(payload)
    } catch {
      // Ignore listener failures so Electron events do not break the bridge.
    }
  })
}

export async function getWindowState() {
  return callDesktopBridge('getWindowState')
}

export async function minimizeWindow() {
  return callDesktopBridge('minimizeWindow')
}

export async function toggleMaximizeWindow() {
  return callDesktopBridge('toggleMaximizeWindow')
}

export async function closeWindow() {
  return callDesktopBridge('closeWindow')
}

export async function openLibraryFolder() {
  return callDesktopBridge('openLibraryFolder')
}

export async function listLibraryFiles() {
  return callDesktopBridge('listLibraryFiles')
}

export async function clearLibraryFiles() {
  return callDesktopBridge('clearLibraryFiles')
}

export async function deleteLibraryItemFolder(fileName) {
  return callDesktopBridge('deleteLibraryItemFolder', fileName)
}

export async function showItemInFolder(fileName) {
  return callDesktopBridge('showItemInFolder', fileName)
}

export async function openItemDefault(fileName) {
  return callDesktopBridge('openItemDefault', fileName)
}

export async function copyItemToClipboard(fileName) {
  return callDesktopBridge('copyFileToClipboard', fileName)
}

export async function fixTikTok120Fps(fileName) {
  return callDesktopBridge('fixTikTok120Fps', fileName)
}

export async function compressMediaToSize(fileName, targetSizeMb, durationSeconds, format) {
  return callDesktopBridge('compressMediaToSize', fileName, targetSizeMb, durationSeconds, format)
}

export async function extractAudioFromMedia(fileName) {
  return callDesktopBridge('extractAudioFromMedia', fileName)
}

export async function getHealth() {
  return request('/health')
}

export { ApiError, ERROR_MESSAGES }
