const STORAGE_KEY = 'palethea-downloads'
import { mergeUtilityTransformations, normalizeDownloadEntry } from './utilityTransforms'

export function getDownloads() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').map(normalizeDownloadEntry)
  } catch {
    return []
  }
}

export function addDownload(entry) {
  const downloads = getDownloads()
  const idx = downloads.findIndex(d => d.jobId === entry.jobId)
  if (idx !== -1) {
    const existingEntry = downloads[idx]
    downloads[idx] = normalizeDownloadEntry({
      ...existingEntry,
      ...entry,
      transformations: mergeUtilityTransformations(
        existingEntry?.transformations,
        entry?.transformations,
        entry?.fileName || existingEntry?.fileName,
      ),
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(downloads))
    return
  }
  downloads.unshift(normalizeDownloadEntry({ ...entry, downloadedAt: new Date().toISOString() }))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(downloads))
}

export function replaceDownloads(entries) {
  const normalized = Array.isArray(entries) ? entries.map(normalizeDownloadEntry) : []
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
}

export function removeDownload(jobId) {
  const downloads = getDownloads().filter(d => d.jobId !== jobId)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(downloads))
}

export function removeDownloads(jobIds) {
  const jobIdSet = new Set(Array.isArray(jobIds) ? jobIds : [])
  const downloads = getDownloads().filter(d => !jobIdSet.has(d.jobId))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(downloads))
}

export function clearDownloads() {
  localStorage.removeItem(STORAGE_KEY)
}
