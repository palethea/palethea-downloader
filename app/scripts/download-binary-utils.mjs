import fs from 'node:fs/promises'
import path from 'node:path'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const gunzipAsync = promisify(gunzip)

export function getAppRoot(importMetaUrl) {
  const currentDir = path.dirname(fileURLToPath(importMetaUrl))
  return path.resolve(currentDir, '..')
}

export async function downloadBinary({ url, targetPath, gzip = false }) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download binary: ${response.status} ${response.statusText}`)
  }

  const rawBuffer = Buffer.from(await response.arrayBuffer())
  const outputBuffer = gzip ? await gunzipAsync(rawBuffer) : rawBuffer

  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, outputBuffer)

  if (process.platform !== 'win32') {
    await fs.chmod(targetPath, 0o755)
  }
}