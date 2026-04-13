import { useEffect, useRef } from 'react';

const BAR_COUNT = 40;
const HALF_BAR_COUNT = BAR_COUNT / 2;
const GRAPH_CLEANUP_DELAY_MS = 250;
const graphRegistry = new WeakMap();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getBandRange(index, totalBands, totalBins) {
  const minEdge = Math.pow(index / totalBands, 1.65);
  const maxEdge = Math.pow((index + 1) / totalBands, 1.65);
  const start = clamp(Math.floor(minEdge * totalBins), 0, totalBins - 1);
  const end = clamp(Math.ceil(maxEdge * totalBins), start + 1, totalBins);
  return [start, end];
}

function getCaptureStream(audio) {
  if (typeof audio.captureStream === 'function') {
    return audio.captureStream();
  }

  if (typeof audio.mozCaptureStream === 'function') {
    return audio.mozCaptureStream();
  }

  return null;
}

function createAnalyserGraph(audio) {
  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) {
    return null;
  }

  const context = new AudioContextImpl();
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.82;

  const stream = getCaptureStream(audio);
  let source = null;

  if (stream && stream.getAudioTracks().length > 0) {
    source = context.createMediaStreamSource(stream);
    source.connect(analyser);
  } else {
    source = context.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(context.destination);
  }

  return {
    analyser,
    cleanupTimer: null,
    context,
    refCount: 0,
    source,
  };
}

function acquireAnalyserGraph(audio) {
  let entry = graphRegistry.get(audio);

  if (!entry) {
    entry = createAnalyserGraph(audio);
    if (!entry) {
      return null;
    }
    graphRegistry.set(audio, entry);
  }

  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = null;
  }

  entry.refCount += 1;
  return entry;
}

function releaseAnalyserGraph(audio) {
  const entry = graphRegistry.get(audio);
  if (!entry) {
    return;
  }

  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount > 0 || entry.cleanupTimer) {
    return;
  }

  entry.cleanupTimer = window.setTimeout(() => {
    if (entry.refCount > 0) {
      entry.cleanupTimer = null;
      return;
    }

    entry.source.disconnect();
    entry.analyser.disconnect();
    if (entry.context.state !== 'closed') {
      entry.context.close().catch(console.error);
    }
    graphRegistry.delete(audio);
  }, GRAPH_CLEANUP_DELAY_MS);
}

export default function AudioVisualizer({ audioRef, isPlaying }) {
  const canvasRef = useRef(null);
  const contextRef = useRef(null);
  const sourceRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const barCacheRef = useRef(new Float32Array(HALF_BAR_COUNT));

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    let disposed = false;

    const ensureAnalyser = async () => {
      if (disposed || analyserRef.current) return;

      try {
        const graph = acquireAnalyserGraph(audio);
        if (!graph) {
          return;
        }

        contextRef.current = graph.context;
        analyserRef.current = graph.analyser;
        sourceRef.current = graph.source;

        if (contextRef.current.state === 'suspended') {
          await contextRef.current.resume();
        }
      } catch (error) {
        console.error('Audio visualizer initialization failed:', error);
      }
    };

    const handlePlay = () => {
      void ensureAnalyser();
    };

    const handleLoadedData = () => {
      if (!audio.paused) {
        void ensureAnalyser();
      }
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('loadeddata', handleLoadedData);

    if (!audio.paused) {
      void ensureAnalyser();
    }

    return () => {
      disposed = true;
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('loadeddata', handleLoadedData);

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      releaseAnalyserGraph(audio);
      sourceRef.current = null;
      analyserRef.current = null;
      contextRef.current = null;
    };
  }, [audioRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const rawFrequencyData = new Uint8Array(128);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const barData = barCacheRef.current;
      const analyser = analyserRef.current;

      if (analyser && isPlaying) {
        analyser.getByteFrequencyData(rawFrequencyData);

        for (let index = 0; index < HALF_BAR_COUNT; index += 1) {
          const [start, end] = getBandRange(index, HALF_BAR_COUNT, rawFrequencyData.length);
          let total = 0;
          let peak = 0;

          for (let cursor = start; cursor < end; cursor += 1) {
            const value = rawFrequencyData[cursor];
            total += value;
            peak = Math.max(peak, value);
          }

          const average = end > start ? total / (end - start) / 255 : 0;
          const peakNormalized = peak / 255;
          const bandProgress = index / Math.max(1, HALF_BAR_COUNT - 1);

          // Blend average energy with peaks and apply a gentle treble lift so the
          // right side doesn't collapse when the source is bass-heavy.
          const weightedEnergy = average * 0.55 + peakNormalized * 0.45;
          const frequencyTilt = 0.82 + bandProgress * 0.72;
          const perceptualAmplitude = Math.pow(weightedEnergy * frequencyTilt, 0.78);

          barData[index] = Math.max(barData[index] * 0.7, perceptualAmplitude);
        }
      } else {
        for (let index = 0; index < HALF_BAR_COUNT; index += 1) {
          barData[index] *= 0.82;
        }
      }

      const gap = 4;
      const barWidth = Math.max(3, (width - gap * (BAR_COUNT - 1)) / BAR_COUNT);
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#ab3600');
      gradient.addColorStop(1, '#832700');
      ctx.fillStyle = gradient;

      const mirroredBars = new Array(BAR_COUNT);
      for (let index = 0; index < HALF_BAR_COUNT; index += 1) {
        const amplitude = Math.max(0.04, barData[index]);
        const leftIndex = HALF_BAR_COUNT - 1 - index;
        const rightIndex = HALF_BAR_COUNT + index;
        mirroredBars[leftIndex] = amplitude;
        mirroredBars[rightIndex] = amplitude;
      }

      for (let index = 0; index < BAR_COUNT; index += 1) {
        const amplitude = mirroredBars[index] ?? 0.04;
        const barHeight = Math.max(6, amplitude * height * 0.82);
        const x = index * (barWidth + gap);
        const y = (height - barHeight) / 2;

        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, barWidth, barHeight, Math.min(6, barWidth / 2));
        } else {
          ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();
      }
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying]);

  return (
    <canvas 
      ref={canvasRef} 
      style={{
        width: '100%',
        height: '100%',
        minHeight: '120px',
        maxHeight: '200px',
        padding: '0 var(--space-xl)',
        display: 'block'
      }}
    />
  );
}