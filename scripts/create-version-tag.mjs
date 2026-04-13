import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const appPackagePath = path.join(repoRoot, 'app', 'package.json')

function parseArgs(argv) {
  const options = {
    push: false,
    dryRun: false,
    version: process.env.RELEASE_VERSION?.trim() || '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--push') {
      options.push = true
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--version') {
      options.version = argv[index + 1]?.trim() || ''
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0 && !allowFailure) {
    const stderr = result.stderr.trim()
    throw new Error(stderr || `git ${args.join(' ')} failed with exit code ${result.status}`)
  }

  return result
}

function normalizeTagName(version) {
  if (!version) {
    throw new Error('A version is required. Provide --version or set app/package.json version.')
  }

  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?((?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(version)

  if (!match) {
    throw new Error(`Version must look like 1.2.3, v0.2.0-alpha, or v5.9-beta.3, received: ${version}`)
  }

  const [, major, minor, patch, suffix = ''] = match
  const normalizedVersion = `${major}.${minor}.${patch || '0'}${suffix}`
  return `v${normalizedVersion}`
}

async function readPackageVersion() {
  const packageJson = JSON.parse(await fs.readFile(appPackagePath, 'utf8'))
  return String(packageJson.version || '').trim()
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const packageVersion = await readPackageVersion()
  const tagName = normalizeTagName(options.version || packageVersion)
  const tagMessage = `Release ${tagName}`

  const localTagCheck = runGit(['rev-parse', '--verify', '--quiet', `refs/tags/${tagName}`], {
    allowFailure: true,
  })

  if (localTagCheck.status === 0) {
    throw new Error(`Tag ${tagName} already exists locally.`)
  }

  if (options.push) {
    const remoteTagCheck = runGit(['ls-remote', '--tags', 'origin', `refs/tags/${tagName}`], {
      allowFailure: true,
    })

    if (remoteTagCheck.stdout.trim()) {
      throw new Error(`Tag ${tagName} already exists on origin.`)
    }
  }

  if (options.dryRun) {
    console.log(`Dry run: would create annotated tag ${tagName}`)
    if (options.push) {
      console.log(`Dry run: would push ${tagName} to origin`)
    }
    return
  }

  runGit(['tag', '-a', tagName, '-m', tagMessage])
  console.log(`Created annotated tag ${tagName}`)

  if (options.push) {
    runGit(['push', 'origin', tagName])
    console.log(`Pushed ${tagName} to origin`)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})