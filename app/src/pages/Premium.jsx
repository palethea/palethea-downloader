import { CheckIcon, StarIcon } from '../components/Icons'

const FREE_FEATURES = [
  'Unlimited MP3 & MP4 downloads',
  'Up to 1080p video quality',
  'Up to 320kbps audio quality',
  'All major platforms supported',
  'No account required',
  'Zero tracking & full privacy',
]

const PREMIUM_FEATURES = [
  'Everything in Free, plus:',
  '4K & 8K video extraction',
  'FLAC, WAV, and WebM formats',
  'Priority server queue access',
  'Batch download (up to 10 URLs)',
  'Browser extension for one-click downloads',
  'Early access to new features',
]

const COMPARISON = [
  { feature: 'MP4 Video Downloads', free: true, premium: true },
  { feature: 'MP3 Audio Downloads', free: true, premium: true },
  { feature: 'Max Video Quality', free: '1080p', premium: '8K' },
  { feature: 'Max Audio Quality', free: '320kbps', premium: 'Lossless' },
  { feature: 'Batch Downloads', free: false, premium: true },
  { feature: 'Priority Processing', free: false, premium: true },
  { feature: 'FLAC / WAV Formats', free: false, premium: true },
  { feature: 'Browser Extension', free: false, premium: true },
  { feature: 'Custom Output Naming', free: false, premium: true },
]

export default function Premium() {
  return (
    <div className="page-wrapper">
      <section className="premium-hero">
        <span className="chip chip-secondary animate-in">
          <StarIcon />
          Premium
        </span>
        <h1 className="display-lg animate-in" style={{ marginTop: 'var(--space-lg)' }}>
          Unlock Full Power
        </h1>
        <p className="body-lg animate-in">
          Get the most out of Palethea with higher quality, more formats, and priority access to our processing infrastructure.
        </p>
      </section>

      <div className="pricing-grid">
        <div className="pricing-card animate-in">
          <h3>Free</h3>
          <div className="pricing-price">
            $0 <span className="period">/ forever</span>
          </div>
          <div className="pricing-features">
            {FREE_FEATURES.map((feat) => (
              <div className="pricing-feature" key={feat}>
                <CheckIcon size={16} />
                {feat}
              </div>
            ))}
          </div>
          <button className="btn-secondary" style={{ marginTop: 'auto' }}>
            Current Plan
          </button>
        </div>

        <div className="pricing-card featured animate-in">
          <span className="chip chip-primary pricing-badge">Recommended</span>
          <h3>Premium</h3>
          <div className="pricing-price">
            $4.99 <span className="period">/ month</span>
          </div>
          <div className="pricing-features">
            {PREMIUM_FEATURES.map((feat) => (
              <div className="pricing-feature" key={feat}>
                <CheckIcon size={16} />
                {feat}
              </div>
            ))}
          </div>
          <button className="btn-primary" style={{ marginTop: 'auto' }}>
            Upgrade to Premium
          </button>
        </div>
      </div>

      <section className="premium-comparison">
        <h2>Feature Comparison</h2>
        <div className="comparison-table">
          <div className="comparison-row header">
            <span className="feature-name" style={{ fontWeight: 700 }}>Feature</span>
            <span className="check-cell" style={{ fontWeight: 700 }}>Free</span>
            <span className="check-cell" style={{ fontWeight: 700 }}>Premium</span>
          </div>
          {COMPARISON.map((row) => (
            <div className="comparison-row" key={row.feature}>
              <span className="feature-name">{row.feature}</span>
              <span className="check-cell">
                {row.free === true ? <CheckIcon size={16} /> : row.free === false ? '—' : row.free}
              </span>
              <span className="check-cell" style={{ color: 'var(--secondary)' }}>
                {row.premium === true ? <CheckIcon size={16} /> : row.premium === false ? '—' : row.premium}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
