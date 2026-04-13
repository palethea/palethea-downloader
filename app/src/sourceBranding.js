const SOURCE_BRANDING = {
  youtube: {
    label: 'YouTube',
    logoSrc: '/images/yt_logo.png',
  },
  soundcloud: {
    label: 'SoundCloud',
    logoSrc: '/images/sc_logo.png',
  },
  instagram: {
    label: 'Instagram',
    logoSrc: '/images/rl_logo.png',
  },
  tiktok: {
    label: 'TikTok',
    logoSrc: '/images/tt_logo.png',
  },
}

export function getSourceBranding(source) {
  return SOURCE_BRANDING[source] || null
}