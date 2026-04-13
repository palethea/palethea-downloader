import { useState } from 'react'

const SITES = [
  {
    name: 'YouTube',
    url: 'youtube.com',
    category: 'video',
    formats: ['MP4', 'MP3', 'WebM'],
    color: '#ff0000',
    letter: 'YT',
  },
  {
    name: 'Vimeo',
    url: 'vimeo.com',
    category: 'video',
    formats: ['MP4', 'MP3'],
    color: '#1ab7ea',
    letter: 'Vi',
  },
  {
    name: 'SoundCloud',
    url: 'soundcloud.com',
    category: 'audio',
    formats: ['MP3', 'WAV'],
    color: '#ff5500',
    letter: 'SC',
  },
  {
    name: 'Dailymotion',
    url: 'dailymotion.com',
    category: 'video',
    formats: ['MP4', 'MP3'],
    color: '#0066dc',
    letter: 'DM',
  },
  {
    name: 'Twitch',
    url: 'twitch.tv',
    category: 'video',
    formats: ['MP4'],
    color: '#9146ff',
    letter: 'Tw',
  },
  {
    name: 'Facebook',
    url: 'facebook.com',
    category: 'social',
    formats: ['MP4', 'MP3'],
    color: '#1877f2',
    letter: 'Fb',
  },
  {
    name: 'Instagram',
    url: 'instagram.com',
    category: 'social',
    formats: ['MP4', 'MP3'],
    color: '#e4405f',
    letter: 'Ig',
  },
  {
    name: 'TikTok',
    url: 'tiktok.com',
    category: 'social',
    formats: ['MP4', 'MP3'],
    color: '#000000',
    letter: 'Tk',
  },
  {
    name: 'X (Twitter)',
    url: 'x.com',
    category: 'social',
    formats: ['MP4', 'MP3'],
    color: '#1da1f2',
    letter: 'X',
  },
  {
    name: 'Reddit',
    url: 'reddit.com',
    category: 'social',
    formats: ['MP4'],
    color: '#ff4500',
    letter: 'Rd',
  },
  {
    name: 'Bandcamp',
    url: 'bandcamp.com',
    category: 'audio',
    formats: ['MP3', 'FLAC'],
    color: '#629aa9',
    letter: 'BC',
  },
  {
    name: 'Mixcloud',
    url: 'mixcloud.com',
    category: 'audio',
    formats: ['MP3'],
    color: '#5000ff',
    letter: 'MC',
  },
]

const CATEGORIES = ['all', 'video', 'audio', 'social']

export default function SupportedSites() {
  const [filter, setFilter] = useState('all')

  const filtered = filter === 'all' ? SITES : SITES.filter((s) => s.category === filter)

  return (
    <div className="page-wrapper">
      <section className="supported-hero">
        <h1 className="display-lg animate-in">Supported Sites</h1>
        <p className="body-lg animate-in">
          Extract media from all major platforms. We continuously expand our compatibility to cover the modern web.
        </p>
      </section>

      <div className="sites-filter">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`toggle-btn ${filter === cat ? 'active' : ''}`}
            onClick={() => setFilter(cat)}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      <div className="sites-grid">
        {filtered.map((site) => (
          <div className="site-card animate-in" key={site.name}>
            <div className="site-card-header">
              <div
                className="site-icon"
                style={{ background: site.color + '18', color: site.color }}
              >
                {site.letter}
              </div>
              <div>
                <h3>{site.name}</h3>
                <div className="site-url">{site.url}</div>
              </div>
            </div>
            <div className="site-formats">
              {site.formats.map((fmt) => (
                <span className="chip chip-neutral" key={fmt}>{fmt}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
