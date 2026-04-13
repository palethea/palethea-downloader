import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, X } from 'lucide-react';
import { getLibraryFileUrl, getDownloadUrl } from '../api';
import { getMediaBadgeLabel, getMediaFormatChipClass } from '../mediaLabels';
import AudioVisualizer from './AudioVisualizer';
import ThumbnailImage from './ThumbnailImage';
import './MediaPlayer.css';

function formatMediaTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MediaPlayer({ item, onClose, inline = false }) {
  const isVideo = item.format === 'mp4';
  const mediaRef = useRef(null);
  const containerRef = useRef(null);
  const shouldAutoplay = !inline;
  
  const [isPlaying, setIsPlaying] = useState(shouldAutoplay);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const mediaUrl = item.fileName ? getLibraryFileUrl(item.fileName) : (item.downloadUrl || getDownloadUrl(item.jobId));
  const streamUrl = mediaUrl + (mediaUrl.includes('?') ? '&stream' : '?stream');

  const togglePlay = useCallback(() => {
    if (mediaRef.current) {
      if (mediaRef.current.paused) {
        mediaRef.current.play().catch(e => console.error("Playback failed:", e));
        setIsPlaying(true);
      } else {
        mediaRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, []);

  useEffect(() => {
    if (inline || typeof onClose !== 'function') {
      return undefined;
    }

    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [inline, onClose, togglePlay]);

  const handleTimeUpdate = () => {
    if (mediaRef.current) {
      setCurrentTime(mediaRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (mediaRef.current) {
      setDuration(mediaRef.current.duration);
    }
  };

  const handleSeek = (e) => {
    const newTime = Number(e.target.value);
    if (mediaRef.current) {
      mediaRef.current.currentTime = newTime;
    }
    setCurrentTime(newTime);
  };

  const handleVolume = (e) => {
    const newVolume = Number(e.target.value);
    if (mediaRef.current) {
      mediaRef.current.volume = newVolume;
    }
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const toggleMute = () => {
    if (mediaRef.current) {
      const newMutedState = !isMuted;
      mediaRef.current.muted = newMutedState;
      setIsMuted(newMutedState);
      if (newMutedState) {
        setVolume(0);
      } else {
        setVolume(mediaRef.current.volume || 1);
      }
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (containerRef.current?.requestFullscreen) {
        containerRef.current.requestFullscreen().catch(err => console.error("Fullscreen error:", err));
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  // Sync fullscreen state if user escapes fullscreen mode using Esc key
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const Tag = isVideo ? 'video' : 'audio';

  const playerContent = (
    <div
      className={`player-modal ${inline ? 'inline' : ''} ${isFullscreen ? 'fullscreen' : ''}`}
      onClick={(e) => e.stopPropagation()}
      ref={containerRef}
    >

      {(!isFullscreen && !inline) && (
        <div className="player-header">
          <div className="player-title-row">
            {(item.thumbnailUrl || item.webpageUrl) && (
              <div className="player-thumb">
                <ThumbnailImage thumbnailUrl={item.thumbnailUrl} refererUrl={item.webpageUrl} alt={item.title} />
              </div>
            )}
            <div className="player-info">
              <h3>{item.title}</h3>
              <span className={`chip ${getMediaFormatChipClass(item.format)}`} style={{ fontSize: '0.625rem' }}>
                {getMediaBadgeLabel(item)}
              </span>
            </div>
            <button className="control-btn" onClick={onClose} aria-label="Close player">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className={`player-media-container ${isVideo ? 'is-video' : 'is-audio'}`} onClick={togglePlay}>
        <Tag
          ref={mediaRef}
          src={streamUrl}
          autoPlay={shouldAutoplay}
          crossOrigin="anonymous"
          preload="metadata"
          className={`player-media-element ${isVideo ? 'is-video' : 'is-audio'}`}
          controls={false}
          controlsList="nodownload"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={(event) => {
            console.error('Media playback failed:', event.currentTarget.error);
            setIsPlaying(false);
          }}
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
        />
        {!isVideo && (
          <div className="player-visualizer-shell">
            <AudioVisualizer audioRef={mediaRef} isPlaying={isPlaying} />
          </div>
        )}
        {isVideo && !isPlaying && (
          <div className="player-play-overlay">
            <Play size={64} color="white" fill="white" />
          </div>
        )}
      </div>

      <div className="player-controls">
        <button className="control-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>

        <div className="time-display">{formatMediaTime(currentTime)}</div>

        <input
          type="range"
          min="0"
          max={duration || 100}
          step="any"
          value={currentTime}
          onChange={handleSeek}
          className="custom-slider seek-slider"
          style={{
            '--val': duration ? currentTime / duration : 0
          }}
        />

        <div className="time-display">{formatMediaTime(duration)}</div>

        <div className="volume-control">
          <button className="control-btn" onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={handleVolume}
            className="custom-slider volume-slider"
            style={{
              '--val': volume
            }}
          />
        </div>

        {isVideo && (
          <button className="control-btn" onClick={toggleFullscreen} aria-label="Toggle Fullscreen">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        )}
      </div>
    </div>
  );

  if (inline) {
    return <div className="player-inline-shell">{playerContent}</div>;
  }

  return createPortal(
    <div className="player-backdrop" onClick={onClose} aria-label="Close player">
      {playerContent}
    </div>,
    document.body
  );
}