import { BoltIcon, LockIcon, CheckIcon, DownloadIcon } from '../components/Icons'

export default function HomePage() {
  return (
    <div className="page-wrapper">
      <div className="info-page">
        <div className="info-hero animate-in">
          <div className="info-hero-content">
            <span className="chip chip-secondary" style={{ alignSelf: 'flex-start' }}>Desktop App</span>
            <h1>Palethea</h1>
            <p>
              High-fidelity media extraction that runs entirely on your machine.
              No servers, no tracking, no limits.
            </p>
          </div>
          <div className="info-hero-visual">
            <img 
              src="/images/home_1.png" 
              alt="Installation Visual" 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
            />
          </div>
        </div>

        <div className="info-grid">
          <div className="info-card animate-in" style={{ animationDelay: '0.1s' }}>
            <div className="info-card-icon red">HQ</div>
            <h3>Original Fidelity</h3>
            <p>Preserve every pixel and frequency. Download in source quality without compression artifacts.</p>
          </div>
          <div className="info-card animate-in" style={{ animationDelay: '0.2s' }}>
            <div className="info-card-icon accent"><BoltIcon /></div>
            <h3>Local Processing</h3>
            <p>Everything runs on your hardware. No queues, no rate limits, no waiting for remote servers.</p>
          </div>
          <div className="info-card animate-in" style={{ animationDelay: '0.3s' }}>
            <div className="info-card-icon accent" style={{ background: 'var(--surface-container-high)' }}><LockIcon /></div>
            <h3>Completely Private</h3>
            <p>Your downloads never leave your machine. No accounts, no telemetry, no analytics.</p>
          </div>
          <div className="info-card animate-in" style={{ animationDelay: '0.4s' }}>
            <div className="info-card-icon accent" style={{ background: 'var(--surface-container-highest)', color: 'var(--on-surface)' }}><DownloadIcon /></div>
            <h3>Standalone App</h3>
            <p>A pure desktop environment. No bloatware, no mandatory cloud sync, just an offline powerhouse.</p>
          </div>
        </div>

        <div className="info-section animate-in" style={{ animationDelay: '0.5s' }}>
          <h2>How It Works</h2>
          <div className="info-steps">
            <div className="info-step">
              <span className="info-step-num">1</span>
              <div className="info-step-content">
                <h3>Paste a URL</h3>
                <p>Copy a YouTube, SoundCloud, Instagram reel, or TikTok link and paste it into the Download tab.</p>
              </div>
            </div>
            <div className="info-step">
              <span className="info-step-num">2</span>
              <div className="info-step-content">
                <h3>Choose Format &amp; Quality</h3>
                <p>Pick MP4 or MP3, then select your preferred quality from what's available.</p>
              </div>
            </div>
            <div className="info-step">
              <span className="info-step-num">3</span>
              <div className="info-step-content">
                <h3>Download</h3>
                <p>Palethea processes the media locally and delivers it straight to your downloads folder.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="info-footer animate-in" style={{ animationDelay: '0.6s' }}>
          <div className="footer-feature">
            <h4><CheckIcon size={14} style={{ color: 'var(--success)' }}/> Local Engine</h4>
            <p>Powered by a Rust zero-dependency backend, bypassing external bandwidth bottlenecks directly onto your drive.</p>
          </div>
          <div className="footer-feature">
            <h4><CheckIcon size={14} style={{ color: 'var(--success)' }}/> No Tracking</h4>
            <p>Monetization-free interface. We deliberately don't track, save, or intercept any of your link requests or playback events.</p>
          </div>
          <div className="footer-feature">
            <h4><CheckIcon size={14} style={{ color: 'var(--success)' }}/> Open Source</h4>
            <p>Fully auditable and open codebase available on GitHub. Modify and fork it however your workflow prefers.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
