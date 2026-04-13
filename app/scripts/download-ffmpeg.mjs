import path from 'node:path'

import { downloadBinary, getAppRoot } from './download-binary-utils.mjs'

const appRoot = getAppRoot(import.meta.url)
const vendorDir = path.join(appRoot, 'vendor')
const executableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const targetPath = path.join(vendorDir, executableName)
const releaseTag = 'b6.1.1'
const archiveName = `ffmpeg-${process.platform}-${process.arch}.gz`
const downloadUrl = `https://github.com/eugeneware/ffmpeg-static/releases/download/${releaseTag}/${archiveName}`

await downloadBinary({
  url: downloadUrl,
  targetPath,
  gzip: true,
})

console.log(`Downloaded ffmpeg to ${targetPath}`)