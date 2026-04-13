import { getThumbnailSources } from '../api'

const MISSING_THUMBNAIL_SRC = '/images/missing_thumbnail.png'

export default function ThumbnailImage({ thumbnailUrl, refererUrl, alt, ...imgProps }) {
  const sources = [...getThumbnailSources(thumbnailUrl, refererUrl), MISSING_THUMBNAIL_SRC]
  const src = sources[0] || ''
  if (!src) return null

  return (
    <img
      {...imgProps}
      src={src}
      alt={alt}
      data-thumbnail-source-index="0"
      onError={(event) => {
        const currentIndex = Number(event.currentTarget.dataset.thumbnailSourceIndex || '0')
        const nextIndex = currentIndex + 1

        if (nextIndex < sources.length) {
          event.currentTarget.dataset.thumbnailSourceIndex = String(nextIndex)
          event.currentTarget.src = sources[nextIndex]
          return
        }

        event.currentTarget.style.display = 'none'
      }}
    />
  )
}