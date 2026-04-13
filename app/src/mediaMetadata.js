export function getFrameRateForQuality(frameRates, quality) {
  const fps = frameRates?.[quality]
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : null
}

export function formatFps(fps) {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
    return null
  }

  const rounded = Math.round(fps * 100) / 100
  return Number.isInteger(rounded) ? `${rounded} FPS` : `${rounded.toFixed(2)} FPS`
}