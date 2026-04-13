export default function Settings({ settings, onChange }) {
  const update = (key, value) => onChange({ ...settings, [key]: value })

  return (
    <div className="page-wrapper">
      <div className="settings-page">
        <h1 className="display-sm">Settings</h1>

        <div className="settings-card">
          <h2>Download Preferences</h2>
          <div className="setting-row">
            <span className="setting-label">Default Format</span>
            <select
              value={settings.defaultFormat}
              onChange={(e) => update('defaultFormat', e.target.value)}
            >
              <option value="mp4">MP4 Video</option>
              <option value="mp3">MP3 Audio</option>
            </select>
          </div>
          <div className="setting-row">
            <span className="setting-label">Default Quality</span>
            <select
              value={settings.defaultQuality}
              onChange={(e) => update('defaultQuality', e.target.value)}
            >
              <option value="2160p">4K (2160p)</option>
              <option value="1080p">Full HD (1080p)</option>
              <option value="720p">HD (720p)</option>
              <option value="480p">SD (480p)</option>
              <option value="320kbps">320 kbps (Audio)</option>
              <option value="128kbps">128 kbps (Audio)</option>
            </select>
          </div>
        </div>

        <div className="settings-card">
          <h2>Behavior</h2>
          <div className="setting-row">
            <span className="setting-label">Auto-download on completion</span>
            <button
              className={`toggle-switch ${settings.autoDownload ? 'on' : ''}`}
              onClick={() => update('autoDownload', !settings.autoDownload)}
              aria-label="Toggle auto-download"
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="setting-row">
            <span className="setting-label">Show notifications</span>
            <button
              className={`toggle-switch ${settings.notifications ? 'on' : ''}`}
              onClick={() => update('notifications', !settings.notifications)}
              aria-label="Toggle notifications"
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </div>

        <div className="settings-card">
          <h2>About</h2>
          <div className="setting-row">
            <span className="setting-label">Version</span>
            <span className="setting-value">0.1.0</span>
          </div>
          <div className="setting-row">
            <span className="setting-label">Engine</span>
            <span className="setting-value">Palethea Native</span>
          </div>
        </div>
      </div>
    </div>
  )
}
