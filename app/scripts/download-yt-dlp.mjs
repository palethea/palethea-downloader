import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
const vendorDir = path.join(appRoot, 'vendor')
const ytDlpTargets = {
  win32: {
    fileName: 'yt-dlp.exe',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  },
  linux: {
    fileName: 'yt-dlp',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
  },
  darwin: {
    fileName: 'yt-dlp',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  },
}

const target = ytDlpTargets[process.platform]

if (!target) {
  throw new Error(`Unsupported platform for yt-dlp download: ${process.platform}`)
}

const targetPath = path.join(vendorDir, target.fileName)

await fs.mkdir(vendorDir, { recursive: true })

const response = await fetch(target.url)
if (!response.ok) {
  throw new Error(`Failed to download yt-dlp: ${response.status} ${response.statusText}`)
}

const arrayBuffer = await response.arrayBuffer()
await fs.writeFile(targetPath, Buffer.from(arrayBuffer))

if (process.platform !== 'win32') {
  await fs.chmod(targetPath, 0o755)
}

console.log(`Downloaded yt-dlp to ${targetPath}`)
