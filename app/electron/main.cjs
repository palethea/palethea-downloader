const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
const API_BASE = 'http://127.0.0.1:43125'
const SHOULD_OPEN_DEVTOOLS = process.env.PALETHEA_OPEN_DEVTOOLS === '1'

let backendProcess = null
let mainWindow = null

function emitWindowState(window) {
  if (!window || window.isDestroyed()) {
    return
  }

  try {
    window.webContents.send('palethea:window-state', {
      isMaximized: window.isMaximized(),
    })
  } catch {
    // Ignore renderer delivery failures.
  }
}

function findNestedFile(rootDir, fileName) {
  const targetName = path.basename(fileName)
  const stack = [rootDir]

  while (stack.length > 0) {
    const currentDir = stack.pop()
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        stack.push(entryPath)
        continue
      }

      if (entry.isFile() && entry.name === targetName) {
        return entryPath
      }
    }
  }

  return null
}

function getAppRoot() {
  return app.getAppPath()
}

function getBundledBinDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(getAppRoot(), 'resources', 'bin')
}

function getPlatformExecutableName(baseName) {
  return process.platform === 'win32' ? `${baseName}.exe` : baseName
}

function getBundledExecutablePath(baseName) {
  return path.join(getBundledBinDir(), getPlatformExecutableName(baseName))
}

function getVendorExecutablePath(baseName) {
  return path.join(getAppRoot(), 'vendor', getPlatformExecutableName(baseName))
}

function getLibraryDirectory() {
  return app.isPackaged
    ? path.join(path.dirname(process.execPath), 'library')
    : path.join(getAppRoot(), 'library')
}

function getFfmpegExecutablePath() {
  if (app.isPackaged) {
    return getBundledExecutablePath('ffmpeg')
  }

  const vendoredFfmpegPath = getVendorExecutablePath('ffmpeg')
  return fs.existsSync(vendoredFfmpegPath) ? vendoredFfmpegPath : 'ffmpeg'
}

function formatTargetSizeToken(targetSizeMb) {
  const rounded = Math.round(targetSizeMb * 10) / 10
  if (Number.isInteger(rounded)) {
    return String(rounded)
  }

  return rounded.toFixed(1).replace(/\.0$/, '')
}

function buildTikTokFixedOutputPath(filePath) {
  const parsed = path.parse(filePath)
  return path.join(parsed.dir, `${parsed.name}-fixed60fps${parsed.ext || '.mp4'}`)
}

function buildCompressedOutputPath(filePath, targetSizeMb) {
  const parsed = path.parse(filePath)
  return path.join(
    parsed.dir,
    `${parsed.name}-compressed-${formatTargetSizeToken(targetSizeMb)}mb${parsed.ext || '.mp4'}`,
  )
}

function buildExtractedAudioOutputPath(filePath) {
  const parsed = path.parse(filePath)
  return path.join(parsed.dir, `${parsed.name}-extracted-audio.mp3`)
}

function createCompressionPassLogBase() {
  const randomToken = Math.random().toString(36).slice(2, 10)
  return path.join(os.tmpdir(), `palethea-pass-${Date.now()}-${randomToken}`)
}

function safeRemoveFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // Ignore cleanup failures for temp ffmpeg files.
  }
}

function listLibraryFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return []
  }

  const stack = [rootDir]
  const files = []

  while (stack.length > 0) {
    const currentDir = stack.pop()
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        stack.push(entryPath)
        continue
      }

      if (entry.isFile()) {
        files.push(entry.name)
      }
    }
  }

  return files
}

function clearDirectoryContents(rootDir) {
  if (!fs.existsSync(rootDir)) {
    fs.mkdirSync(rootDir, { recursive: true })
    return
  }

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name)
    fs.rmSync(entryPath, { recursive: true, force: true })
  }
}

function isPathInsideDirectory(targetPath, rootDir) {
  const resolvedTargetPath = path.resolve(targetPath)
  const resolvedRootDir = path.resolve(rootDir)

  return resolvedTargetPath === resolvedRootDir || resolvedTargetPath.startsWith(`${resolvedRootDir}${path.sep}`)
}

function listFilesWithinDirectory(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return []
  }

  const stack = [rootDir]
  const files = []

  while (stack.length > 0) {
    const currentDir = stack.pop()
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        stack.push(entryPath)
        continue
      }

      if (entry.isFile()) {
        files.push(entry.name)
      }
    }
  }

  return files
}

function deleteLibraryItemContainer(fileName) {
  const filePath = resolveLibraryItemPath(fileName)
  if (!filePath) {
    return { ok: false, error: 'Could not find that file in the library.' }
  }

  const libraryDir = getLibraryDirectory()
  const containerPath = path.dirname(filePath)
  if (!isPathInsideDirectory(containerPath, libraryDir)) {
    return { ok: false, error: 'Resolved item folder is outside the library directory.' }
  }

  const deleteTargetPath = path.resolve(containerPath) === path.resolve(libraryDir) ? filePath : containerPath
  const deleteTargetStats = fs.statSync(deleteTargetPath)
  const deletedFiles = deleteTargetStats.isDirectory()
    ? listFilesWithinDirectory(deleteTargetPath)
    : [path.basename(deleteTargetPath)]

  fs.rmSync(deleteTargetPath, { recursive: true, force: true })

  return {
    ok: true,
    deletedFiles,
    deletedPath: deleteTargetPath,
  }
}

function clampProgress(value) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(value)))
}

function parseFfmpegTimeProgress(output) {
  if (typeof output !== 'string' || !output.trim()) {
    return null
  }

  const matches = [...output.matchAll(/time=([0-9:.]+)/gi)]
  if (matches.length === 0) {
    return null
  }

  return parseDurationValue(matches[matches.length - 1][1])
}

function emitUtilityProgress(sender, operation, progress, stage = 'running') {
  try {
    sender?.send('palethea:utility-progress', {
      operation,
      progress: clampProgress(progress),
      stage,
    })
  } catch {
    // Ignore renderer progress delivery failures.
  }
}

function runFfmpegProcess(args, fallbackError, progressOptions = null) {
  return new Promise((resolve) => {
    const ffmpegPath = getFfmpegExecutablePath()
    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    let stdout = ''
    let lastProgress = -1

    if (progressOptions?.sender && progressOptions?.operation) {
      emitUtilityProgress(progressOptions.sender, progressOptions.operation, progressOptions.startProgress ?? 3)
    }

    const updateProgressFromChunk = (chunkText) => {
      if (!progressOptions?.sender || !progressOptions?.operation || !Number.isFinite(progressOptions.durationSeconds) || progressOptions.durationSeconds <= 0) {
        return
      }

      const elapsedSeconds = parseFfmpegTimeProgress(chunkText)
      if (!Number.isFinite(elapsedSeconds)) {
        return
      }

        const scaledElapsedSeconds = elapsedSeconds * (Number.isFinite(progressOptions.timeScale) && progressOptions.timeScale > 0
          ? progressOptions.timeScale
          : 1)

        const boundedRatio = Math.max(0, Math.min(1, scaledElapsedSeconds / progressOptions.durationSeconds))
      const start = progressOptions.startProgress ?? 0
      const end = progressOptions.endProgress ?? 100
      const progress = start + (end - start) * boundedRatio
      const roundedProgress = clampProgress(progress)

      if (roundedProgress > lastProgress) {
        lastProgress = roundedProgress
        emitUtilityProgress(progressOptions.sender, progressOptions.operation, roundedProgress)
      }
    }

    proc.stdout.on('data', (chunk) => {
      const chunkText = chunk.toString()
      stdout += chunkText
      updateProgressFromChunk(chunkText)
    })

    proc.stderr.on('data', (chunk) => {
      const chunkText = chunk.toString()
      stderr += chunkText
      updateProgressFromChunk(chunkText)
    })

    proc.on('error', (error) => {
      if (progressOptions?.sender && progressOptions?.operation) {
        emitUtilityProgress(progressOptions.sender, progressOptions.operation, 0, 'failed')
      }
      resolve({ ok: false, error: error?.message || 'Could not start ffmpeg.' })
    })

    proc.on('exit', (code) => {
      if (code === 0) {
        if (progressOptions?.sender && progressOptions?.operation) {
          emitUtilityProgress(progressOptions.sender, progressOptions.operation, progressOptions.endProgress ?? 100)
        }
        resolve({ ok: true })
        return
      }

      if (progressOptions?.sender && progressOptions?.operation) {
        emitUtilityProgress(progressOptions.sender, progressOptions.operation, lastProgress > 0 ? lastProgress : 0, 'failed')
      }

      resolve({
        ok: false,
        error: stderr.trim() || stdout.trim() || fallbackError,
      })
    })
  })
}

function parseDurationValue(input) {
  if (typeof input !== 'string') {
    return null
  }

  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  const asSeconds = Number(trimmed)
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return asSeconds
  }

  const parts = trimmed.split(':')
  if (parts.length === 0) {
    return null
  }

  let totalSeconds = 0
  for (const part of parts) {
    const value = Number(part.trim())
    if (!Number.isFinite(value) || value < 0) {
      return null
    }
    totalSeconds = totalSeconds * 60 + value
  }

  return totalSeconds > 0 ? totalSeconds : null
}

function parseFfmpegDuration(output) {
  if (typeof output !== 'string' || !output.trim()) {
    return null
  }

  const match = output.match(/Duration:\s*([0-9:.]+)/i)
  return match ? parseDurationValue(match[1]) : null
}

function parseFfmpegFps(output) {
  if (typeof output !== 'string' || !output.trim()) {
    return null
  }

  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('Video:')) {
      continue
    }

    const match = line.match(/(?:^|[^0-9.])(\d+(?:\.\d+)?)\s*fps(?:[^a-z]|$)/i)
    if (!match) {
      continue
    }

    const fps = Number(match[1])
    if (Number.isFinite(fps) && fps > 0) {
      return fps
    }
  }

  return null
}

function probeMediaMetadata(filePath) {
  return new Promise((resolve) => {
    const ffmpegPath = getFfmpegExecutablePath()
    const proc = spawn(ffmpegPath, ['-i', filePath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''

    proc.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })

    proc.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })

    proc.on('error', () => {
      resolve({ duration: null, fps: null })
    })

    proc.on('exit', () => {
      resolve({
        duration: parseFfmpegDuration(output),
        fps: parseFfmpegFps(output),
      })
    })
  })
}

async function buildUtilityMediaResult(outputPath) {
  const stats = fs.statSync(outputPath)
  const metadata = await probeMediaMetadata(outputPath)

  return {
    ok: true,
    path: outputPath,
    fileName: path.basename(outputPath),
    fileSize: stats.size,
    duration: metadata.duration,
    fps: metadata.fps,
  }
}

function runTikTokFpsFix(inputPath, outputPath, progressOptions = null) {
  return new Promise((resolve) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-filter_complex', '[0:v]setpts=0.5*PTS,fps=60[v];[0:a]asetpts=N/SR/TB,aresample=48000[a]',
      '-map', '[v]',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'slow',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '256k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      outputPath,
    ]

    runFfmpegProcess(args, 'ffmpeg could not repair this TikTok video.', progressOptions).then((result) => {
      if (result.ok) {
        buildUtilityMediaResult(outputPath)
          .then(resolve)
          .catch((error) => {
            resolve({ ok: false, error: error?.message || 'Fixed file was created but could not be read.' })
          })
        return
      }

      resolve(result)
    })
  })
}

async function runAudioCompressionToSize(inputPath, outputPath, targetSizeMb, durationSeconds, progressOptions = null) {
  const targetBitrateKbps = Math.floor((targetSizeMb * 8000 * 0.97) / durationSeconds)
  if (targetBitrateKbps < 32) {
    return { ok: false, error: 'That target size is too small for this audio length.' }
  }

  const bitrateOptions = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  const audioBitrateKbps = bitrateOptions.reduce((best, current) => {
    if (current > targetBitrateKbps) {
      return best
    }
    return current
  }, 32)

  const result = await runFfmpegProcess([
    '-y',
    '-i', inputPath,
    '-c:a', 'libmp3lame',
    '-b:a', `${audioBitrateKbps}k`,
    '-ar', '44100',
    '-ac', '2',
    outputPath,
  ], 'ffmpeg could not compress this audio file to the requested size.', progressOptions)

  if (!result.ok) {
    return result
  }

  try {
    return await buildUtilityMediaResult(outputPath)
  } catch (error) {
    return { ok: false, error: error?.message || 'Compressed file was created but could not be read.' }
  }
}

async function runAudioExtraction(inputPath, outputPath, progressOptions = null) {
  const result = await runFfmpegProcess([
    '-y',
    '-i', inputPath,
    '-map', '0:a:0',
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', '320k',
    outputPath,
  ], 'ffmpeg could not extract audio from this video.', progressOptions)

  if (!result.ok) {
    return result
  }

  try {
    return await buildUtilityMediaResult(outputPath)
  } catch (error) {
    return { ok: false, error: error?.message || 'Extracted audio was created but could not be read.' }
  }
}

async function runVideoCompressionToSize(inputPath, outputPath, targetSizeMb, durationSeconds, progressOptions = null) {
  const totalBitrateKbps = Math.floor((targetSizeMb * 8000 * 0.97) / durationSeconds)
  if (totalBitrateKbps < 180) {
    return { ok: false, error: 'That target size is too small for this video length.' }
  }

  const audioBitrateKbps = totalBitrateKbps >= 320 ? 128 : totalBitrateKbps >= 224 ? 96 : 64
  const videoBitrateKbps = totalBitrateKbps - audioBitrateKbps

  if (videoBitrateKbps < 120) {
    return { ok: false, error: 'That target size is too small for this video length.' }
  }

  const passLogFile = createCompressionPassLogBase()
  const nullSink = process.platform === 'win32' ? 'NUL' : '/dev/null'

  try {
    const firstPass = await runFfmpegProcess([
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-c:v', 'libx264',
      '-b:v', `${videoBitrateKbps}k`,
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-pass', '1',
      '-passlogfile', passLogFile,
      '-an',
      '-f', 'mp4',
      nullSink,
    ], 'ffmpeg could not prepare the compression pass for this video.', progressOptions ? {
      ...progressOptions,
      startProgress: 3,
      endProgress: 48,
    } : null)

    if (!firstPass.ok) {
      return firstPass
    }

    const secondPass = await runFfmpegProcess([
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-b:v', `${videoBitrateKbps}k`,
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-pass', '2',
      '-passlogfile', passLogFile,
      '-c:a', 'aac',
      '-b:a', `${audioBitrateKbps}k`,
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      outputPath,
    ], 'ffmpeg could not compress this video to the requested size.', progressOptions ? {
      ...progressOptions,
      startProgress: 48,
      endProgress: 100,
    } : null)

    if (!secondPass.ok) {
      safeRemoveFile(outputPath)
      return secondPass
    }

    return await buildUtilityMediaResult(outputPath)
  } catch (error) {
    safeRemoveFile(outputPath)
    return { ok: false, error: error?.message || 'Compressed file was created but could not be read.' }
  } finally {
    safeRemoveFile(passLogFile)
    safeRemoveFile(`${passLogFile}-0.log`)
    safeRemoveFile(`${passLogFile}-0.log.mbtree`)
    safeRemoveFile(`${passLogFile}.log`)
    safeRemoveFile(`${passLogFile}.log.mbtree`)
  }
}

function resolveLibraryItemPath(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return null
  }

  const libraryDir = getLibraryDirectory()
  const resolvedLibraryDir = path.resolve(libraryDir)
  const directCandidate = path.resolve(libraryDir, fileName)

  if (
    directCandidate === resolvedLibraryDir ||
    directCandidate.startsWith(`${resolvedLibraryDir}${path.sep}`)
  ) {
    if (fs.existsSync(directCandidate) && fs.statSync(directCandidate).isFile()) {
      return directCandidate
    }
  }

  const basenameCandidate = path.join(libraryDir, path.basename(fileName))
  if (fs.existsSync(basenameCandidate) && fs.statSync(basenameCandidate).isFile()) {
    return basenameCandidate
  }

  if (!fs.existsSync(libraryDir)) {
    return null
  }

  return findNestedFile(libraryDir, fileName)
}

function copyFileToClipboardViaPowerShell(filePath) {
  return new Promise((resolve) => {
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$files = New-Object System.Collections.Specialized.StringCollection',
      '$target = $env:PALETHEA_CLIPBOARD_FILE',
      'if ([string]::IsNullOrWhiteSpace($target)) { throw "Missing clipboard file path." }',
      '[void]$files.Add($target)',
      '[System.Windows.Forms.Clipboard]::SetFileDropList($files)',
    ].join('; ')

    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', psScript],
      {
        env: {
          ...process.env,
          PALETHEA_CLIPBOARD_FILE: filePath,
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    let stderr = ''

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    proc.on('error', (error) => {
      resolve({ ok: false, error: error.message || 'Could not start clipboard helper.' })
    })

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true, path: filePath })
        return
      }

      resolve({
        ok: false,
        error: stderr.trim() || 'Could not copy file to clipboard.',
      })
    })
  })
}

function buildBackendEnv() {
  const binDir = getBundledBinDir()
  const ytDlpPath = app.isPackaged ? getBundledExecutablePath('yt-dlp') : getVendorExecutablePath('yt-dlp')
  const ffmpegDir = app.isPackaged ? binDir : path.dirname(getVendorExecutablePath('ffmpeg'))
  const toolDir = app.isPackaged ? binDir : path.dirname(ytDlpPath)
  const existingPath = process.env.PATH || ''

  return {
    ...process.env,
    PATH: `${ffmpegDir}${path.delimiter}${toolDir}${path.delimiter}${existingPath}`,
    PALETHEA_YTDLP_PATH: ytDlpPath,
    PALETHEA_DOWNLOAD_DIR: getLibraryDirectory(),
  }
}

ipcMain.handle('palethea:open-library-folder', async () => {
  const libraryDir = getLibraryDirectory()
  fs.mkdirSync(libraryDir, { recursive: true })
  const error = await shell.openPath(libraryDir)

  if (error) {
    return { ok: false, error, path: libraryDir }
  }

  return { ok: true, path: libraryDir }
})

ipcMain.handle('palethea:list-library-files', async () => {
  const libraryDir = getLibraryDirectory()
  fs.mkdirSync(libraryDir, { recursive: true })
  return { ok: true, files: listLibraryFilesRecursive(libraryDir) }
})

ipcMain.handle('palethea:clear-library-files', async () => {
  const libraryDir = getLibraryDirectory()

  try {
    clearDirectoryContents(libraryDir)
    fs.mkdirSync(libraryDir, { recursive: true })
    return { ok: true, path: libraryDir }
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not clear the library directory.' }
  }
})

ipcMain.handle('palethea:delete-library-item-folder', async (event, fileName) => {
  if (!fileName) {
    return { ok: false, error: 'No file specified' }
  }

  try {
    return deleteLibraryItemContainer(fileName)
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not delete this library folder.' }
  }
})

ipcMain.handle('palethea:show-item-in-folder', async (event, fileName) => {
  if (!fileName) return { ok: false, error: 'No file specified' }
  const filePath = resolveLibraryItemPath(fileName)
  if (!filePath) {
    return { ok: false, error: 'Could not find that file in the library.' }
  }

  shell.showItemInFolder(filePath)
  return { ok: true, path: filePath }
})

ipcMain.handle('palethea:open-item-default', async (event, fileName) => {
  if (!fileName) return { ok: false, error: 'No file specified' }
  const filePath = resolveLibraryItemPath(fileName)
  if (!filePath) {
    return { ok: false, error: 'Could not find that file in the library.' }
  }

  const error = await shell.openPath(filePath)
  if (error) return { ok: false, error }
  return { ok: true, path: filePath }
})

ipcMain.handle('palethea:copy-file-to-clipboard', async (event, fileName) => {
  if (!fileName) return { ok: false, error: 'No file specified' }
  const filePath = resolveLibraryItemPath(fileName)
  if (!filePath) {
    return { ok: false, error: 'Could not find that file in the library.' }
  }

  return copyFileToClipboardViaPowerShell(filePath)
})

ipcMain.handle('palethea:fix-tiktok-120fps', async (event, fileName) => {
  if (!fileName) return { ok: false, error: 'No file specified' }

  const filePath = resolveLibraryItemPath(fileName)
  if (!filePath) {
    return { ok: false, error: 'Could not find that file in the library.' }
  }

  if (path.extname(filePath).toLowerCase() !== '.mp4') {
    return { ok: false, error: 'This fix only works on MP4 videos.' }
  }

  const outputPath = buildTikTokFixedOutputPath(filePath)
  const inputMetadata = await probeMediaMetadata(filePath)
  return runTikTokFpsFix(filePath, outputPath, {
    sender: event.sender,
    operation: 'tiktok-fix',
    durationSeconds: inputMetadata.duration,
    timeScale: 2,
    startProgress: 3,
    endProgress: 100,
  })
})

ipcMain.handle('palethea:extract-audio-from-media', async (event, fileName) => {
  if (!fileName) return { ok: false, error: 'No file specified' }

  const filePath = resolveLibraryItemPath(fileName)
  if (!filePath) {
    return { ok: false, error: 'Could not find that file in the library.' }
  }

  if (path.extname(filePath).toLowerCase() !== '.mp4') {
    return { ok: false, error: 'Audio extraction is currently available only for MP4 videos.' }
  }

  const outputPath = buildExtractedAudioOutputPath(filePath)
  const inputMetadata = await probeMediaMetadata(filePath)
  return runAudioExtraction(filePath, outputPath, {
    sender: event.sender,
    operation: 'extract-audio',
    durationSeconds: inputMetadata.duration,
    startProgress: 3,
    endProgress: 100,
  })
})

ipcMain.handle('palethea:compress-media-to-size', async (event, fileName, targetSizeMb, durationSeconds, format) => {
  if (!fileName) return { ok: false, error: 'No file specified' }

  const filePath = resolveLibraryItemPath(fileName)
  if (!filePath) {
    return { ok: false, error: 'Could not find that file in the library.' }
  }

  const normalizedTargetSizeMb = Number(targetSizeMb)
  if (!Number.isFinite(normalizedTargetSizeMb) || normalizedTargetSizeMb <= 0) {
    return { ok: false, error: 'Please provide a valid target size in MB.' }
  }

  const probedMetadata = await probeMediaMetadata(filePath)
  const fallbackDurationSeconds = Number(durationSeconds)
  const normalizedDurationSeconds = Number.isFinite(probedMetadata.duration) && probedMetadata.duration > 1
    ? probedMetadata.duration
    : fallbackDurationSeconds

  if (!Number.isFinite(normalizedDurationSeconds) || normalizedDurationSeconds <= 1) {
    return { ok: false, error: 'This file is missing usable duration metadata for compression.' }
  }

  const normalizedFormat = typeof format === 'string' ? format.toLowerCase() : path.extname(filePath).replace('.', '').toLowerCase()
  if (normalizedFormat !== 'mp4' && normalizedFormat !== 'mp3') {
    return { ok: false, error: 'Compression is currently available only for MP4 and MP3 files.' }
  }

  const stats = fs.statSync(filePath)
  const targetBytes = normalizedTargetSizeMb * 1000000
  if (targetBytes >= stats.size) {
    return { ok: false, error: 'Target size must be smaller than the current file size.' }
  }

  const outputPath = buildCompressedOutputPath(filePath, normalizedTargetSizeMb)

  if (normalizedFormat === 'mp3') {
    return runAudioCompressionToSize(filePath, outputPath, normalizedTargetSizeMb, normalizedDurationSeconds, {
      sender: event.sender,
      operation: 'compress',
      durationSeconds: normalizedDurationSeconds,
      startProgress: 3,
      endProgress: 100,
    })
  }

  return runVideoCompressionToSize(filePath, outputPath, normalizedTargetSizeMb, normalizedDurationSeconds, {
    sender: event.sender,
    operation: 'compress',
    durationSeconds: normalizedDurationSeconds,
  })
})

async function waitForBackend(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isBackendHealthy()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Timed out waiting for local backend to start.')
}

async function isBackendHealthy() {
  try {
    const response = await fetch(`${API_BASE}/media-api/health`)
    return response.ok
  } catch {
    return false
  }
}

function startBackend() {
  if (backendProcess) {
    return
  }

  const env = buildBackendEnv()

  if (app.isPackaged) {
    const backendExe = getBundledExecutablePath('palethea-native-backend')
    backendProcess = spawn(backendExe, [], {
      env,
      stdio: 'inherit',
      windowsHide: true,
    })
  } else {
    const manifestPath = path.join(getAppRoot(), 'native-backend', 'Cargo.toml')
    backendProcess = spawn('cargo', ['run', '--manifest-path', manifestPath], {
      cwd: getAppRoot(),
      env,
      stdio: 'inherit',
      windowsHide: true,
    })
  }

  backendProcess.on('exit', () => {
    backendProcess = null
  })
}

function stopBackend() {
  if (!backendProcess) {
    return
  }
  backendProcess.kill()
  backendProcess = null
}

async function createWindow() {
  if (!(await isBackendHealthy())) {
    startBackend()
  }
  await waitForBackend()

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1400,
    minHeight: 900,
    frame: false,
    titleBarStyle: 'hidden',
    useContentSize: true,
    backgroundColor: '#f8f9fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.on('maximize', () => emitWindowState(mainWindow))
  mainWindow.on('unmaximize', () => emitWindowState(mainWindow))
  mainWindow.on('enter-full-screen', () => emitWindowState(mainWindow))
  mainWindow.on('leave-full-screen', () => emitWindowState(mainWindow))
  mainWindow.webContents.on('did-finish-load', () => emitWindowState(mainWindow))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (app.isPackaged) {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  } else {
    await mainWindow.loadURL(DEV_SERVER_URL)
    if (SHOULD_OPEN_DEVTOOLS) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  }

  // Handle download links (target="_blank") — download the file instead of opening a new window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(API_BASE)) {
      mainWindow.webContents.downloadURL(url)
      return { action: 'deny' }
    }

    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
    }

    return { action: 'deny' }
  })
}

ipcMain.handle('palethea:window-minimize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Window unavailable.' }
  }

  mainWindow.minimize()
  return { ok: true }
})

ipcMain.handle('palethea:window-toggle-maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Window unavailable.' }
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }

  return {
    ok: true,
    isMaximized: mainWindow.isMaximized(),
  }
})

ipcMain.handle('palethea:window-close', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Window unavailable.' }
  }

  mainWindow.close()
  return { ok: true }
})

ipcMain.handle('palethea:get-window-state', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Window unavailable.' }
  }

  return {
    ok: true,
    isMaximized: mainWindow.isMaximized(),
  }
})

app.whenReady().then(async () => {
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopBackend()
})
