function isExtractedAudioFile(fileName) {
  return typeof fileName === 'string' && /-extracted-audio\.mp3$/i.test(fileName.trim())
}

export function normalizeMediaQuality(quality, format, fileName) {
  const normalizedFormat = typeof format === 'string' ? format.trim().toLowerCase() : ''
  const normalizedQuality = typeof quality === 'string' && quality.trim() ? quality.trim() : null

  if (normalizedFormat === 'mp3' && isExtractedAudioFile(fileName)) {
    if (!normalizedQuality || normalizedQuality.toLowerCase() === 'audio') {
      return '320k'
    }
  }

  return normalizedQuality
}

export function getMediaBadgeLabel(item) {
  const quality = normalizeMediaQuality(item?.quality, item?.format, item?.fileName)
  const format = typeof item?.format === 'string' && item.format.trim() ? item.format.trim().toUpperCase() : null

  if (quality && format) {
    return `${quality} ${format}`
  }

  if (format) {
    return format
  }

  return quality || 'Media'
}

export function getMediaFormatChipClass(format) {
  const normalizedFormat = typeof format === 'string' ? format.trim().toLowerCase() : ''

  if (normalizedFormat === 'mp3') {
    return 'chip-format-audio'
  }

  if (normalizedFormat === 'mp4') {
    return 'chip-format-video'
  }

  return 'chip-secondary'
}