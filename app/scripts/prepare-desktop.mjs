import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
const resourcesBinDir = path.join(appRoot, 'resources', 'bin')
const executableExtension = process.platform === 'win32' ? '.exe' : ''

function getPlatformBinaryName(baseName) {
	return `${baseName}${executableExtension}`
}

const backendBinaryName = getPlatformBinaryName('palethea-native-backend')
const ytDlpBinaryName = getPlatformBinaryName('yt-dlp')
const ffmpegBinaryName = getPlatformBinaryName('ffmpeg')

const backendSource = path.join(appRoot, 'native-backend', 'target', 'release', backendBinaryName)
const backendTarget = path.join(resourcesBinDir, backendBinaryName)
const ytDlpSource = path.join(appRoot, 'vendor', ytDlpBinaryName)
const ytDlpTarget = path.join(resourcesBinDir, ytDlpBinaryName)
const ffmpegTarget = path.join(resourcesBinDir, ffmpegBinaryName)

await fs.mkdir(resourcesBinDir, { recursive: true })
await fs.copyFile(backendSource, backendTarget)
await fs.copyFile(ytDlpSource, ytDlpTarget)
await fs.copyFile(ffmpegPath, ffmpegTarget)

if (process.platform !== 'win32') {
	await Promise.all([
		fs.chmod(backendTarget, 0o755),
		fs.chmod(ytDlpTarget, 0o755),
		fs.chmod(ffmpegTarget, 0o755),
	])
}

console.log('Prepared desktop resources in resources/bin')
