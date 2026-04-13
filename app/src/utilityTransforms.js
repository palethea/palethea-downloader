import { normalizeMediaQuality } from './mediaLabels'

export const UTILITY_TRANSFORMATIONS = {
  TIKTOK_60FPS_COMPAT: 'tiktok-60fps-compat',
  TARGET_SIZE_COMPRESSION: 'target-size-compression',
  AUDIO_EXTRACTION: 'audio-extraction',
}

function isExtractedAudioFileName(fileName) {
  return typeof fileName === 'string' && /-extracted-audio\.mp3$/i.test(fileName.trim())
}

const KNOWN_TRANSFORMATION_TYPES = new Set(Object.values(UTILITY_TRANSFORMATIONS))

function normalizePositiveNumber(value) {
  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeUtilityTransformation(entry) {
  const type = normalizeString(entry?.type)
  if (!type || !KNOWN_TRANSFORMATION_TYPES.has(type)) {
    return null
  }

  const normalized = {
    type,
  }

  const createdAt = normalizeString(entry?.createdAt)
  if (createdAt) {
    normalized.createdAt = createdAt
  }

  const sourceFileName = normalizeString(entry?.sourceFileName)
  if (sourceFileName) {
    normalized.sourceFileName = sourceFileName
  }

  if (type === UTILITY_TRANSFORMATIONS.TARGET_SIZE_COMPRESSION) {
    const targetSizeMb = normalizePositiveNumber(entry?.targetSizeMb)
    if (targetSizeMb) {
      normalized.targetSizeMb = targetSizeMb
    }
  }

  return normalized
}

function inferTransformationsFromFileName(fileName) {
  if (typeof fileName !== 'string' || !fileName.trim()) {
    return []
  }

  const normalizedFileName = fileName.trim()
  const inferred = []

  if (/-fixed60fps\.[^.]+$/i.test(normalizedFileName)) {
    inferred.push({ type: UTILITY_TRANSFORMATIONS.TIKTOK_60FPS_COMPAT })
  }

  const compressionMatch = normalizedFileName.match(/-compressed-(\d+(?:\.\d+)?)mb\.[^.]+$/i)
  if (compressionMatch) {
    inferred.push({
      type: UTILITY_TRANSFORMATIONS.TARGET_SIZE_COMPRESSION,
      targetSizeMb: Number(compressionMatch[1]),
    })
  }

  if (/-extracted-audio\.mp3$/i.test(normalizedFileName)) {
    inferred.push({ type: UTILITY_TRANSFORMATIONS.AUDIO_EXTRACTION })
  }

  return inferred
}

export function normalizeTransformations(transformations, fileName) {
  const merged = [...inferTransformationsFromFileName(fileName), ...(Array.isArray(transformations) ? transformations : [])]
  const byType = new Map()

  for (const entry of merged) {
    const normalized = normalizeUtilityTransformation(entry)
    if (!normalized) continue
    byType.set(normalized.type, normalized)
  }

  return [...byType.values()]
}

export function mergeUtilityTransformations(existingTransformations, nextTransformations, fileName) {
  return normalizeTransformations(
    [
      ...(Array.isArray(existingTransformations) ? existingTransformations : []),
      ...(Array.isArray(nextTransformations) ? nextTransformations : []),
    ],
    fileName,
  )
}

export function normalizeDownloadEntry(entry) {
  const duration = typeof entry?.duration === 'number' && entry.duration > 0 ? entry.duration : null
  const fps = typeof entry?.fps === 'number' && Number.isFinite(entry.fps) && entry.fps > 0 ? entry.fps : null
  const quality = normalizeMediaQuality(entry?.quality, entry?.format, entry?.fileName) || entry?.quality || null

  return {
    ...entry,
    duration,
    fps,
    quality,
    transformations: normalizeTransformations(entry?.transformations, entry?.fileName),
  }
}

export function hasUtilityTransformation(item, transformationType) {
  return normalizeTransformations(item?.transformations, item?.fileName).some(
    (entry) => entry.type === transformationType,
  )
}

export function isUtilityModified(item) {
  return normalizeTransformations(item?.transformations, item?.fileName).some((entry) => {
    if (entry.type === UTILITY_TRANSFORMATIONS.AUDIO_EXTRACTION) {
      return isExtractedAudioFileName(item?.fileName)
    }

    return true
  })
}

export function formatTargetSizeMb(targetSizeMb) {
  const normalized = normalizePositiveNumber(targetSizeMb)
  if (!normalized) return null

  const rounded = Math.round(normalized * 10) / 10
  return Number.isInteger(rounded) ? `${rounded} MB` : `${rounded.toFixed(1)} MB`
}

export function formatUtilityTransformationLabel(transformation) {
  const normalized = normalizeUtilityTransformation(transformation)
  if (!normalized) return null

  if (normalized.type === UTILITY_TRANSFORMATIONS.TIKTOK_60FPS_COMPAT) {
    return '60 FPS Fix'
  }

  if (normalized.type === UTILITY_TRANSFORMATIONS.TARGET_SIZE_COMPRESSION) {
    const targetLabel = formatTargetSizeMb(normalized.targetSizeMb)
    return targetLabel ? `Compressed to ${targetLabel}` : 'Compressed to Target Size'
  }

  if (normalized.type === UTILITY_TRANSFORMATIONS.AUDIO_EXTRACTION) {
    return 'Extracted Audio'
  }

  return null
}

export function appendUtilityTransformation(item, transformation) {
  return mergeUtilityTransformations(item?.transformations, [transformation], item?.fileName)
}