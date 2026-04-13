import path from 'node:path'
import { downloadBinary, getAppRoot } from './download-binary-utils.mjs'

const appRoot = getAppRoot(import.meta.url)
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

await downloadBinary({
  url: target.url,
  targetPath,
})

console.log(`Downloaded yt-dlp to ${targetPath}`)
