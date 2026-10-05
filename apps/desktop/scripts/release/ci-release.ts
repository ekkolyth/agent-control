#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyChangesets } from './changesets'
import { pushBumpAndTag, remoteTagExists } from './commit-bump'
import { ROOT, readPackageJsonVersion, run } from './lib'

// a stray local run would push to main and publish a GitHub release
if (!process.env.CI) {
  throw new Error('ci-release is CI-only — it publishes a GitHub release')
}

const version = process.env.VERSION
if (!version) throw new Error('VERSION unset — the version job computes it')
const notes = process.env.RELEASE_NOTES ?? ''
const tag = `v${version}`

function releaseExists(): boolean {
  const result = spawnSync('gh', ['release', 'view', tag], { cwd: ROOT })
  if (result.error) throw result.error
  return result.status === 0
}

function buildZip(): string {
  run('bash', ['scripts/build.sh'])
  const zip = resolve(ROOT, 'build', `Agent-Control-${version}-arm64.zip`)
  if (!existsSync(zip)) throw new Error(`release zip not found: ${zip}`)
  return zip
}

if (remoteTagExists(tag)) {
  if (releaseExists()) {
    console.log(`${tag} is already released — nothing to do`)
    process.exit(0)
  }
  // an earlier attempt pushed the bump and tag but never published; ship the
  // tagged commit rather than applying the changesets a second time
  run('git', [
    'fetch',
    '--force',
    'origin',
    `refs/tags/${tag}:refs/tags/${tag}`,
  ])
  run('git', ['checkout', '--detach', tag])
} else {
  applyChangesets()
  const applied = readPackageJsonVersion()
  if (applied !== version) {
    throw new Error(
      `changesets produced ${applied} here but ${version} in the version job`
    )
  }
}

const zip = buildZip()

// pushed after the build, so main only advances for a version that built,
// signed, and notarized
if (!remoteTagExists(tag)) pushBumpAndTag(version)

run('gh', [
  'release',
  'create',
  tag,
  zip,
  '--verify-tag',
  '--title',
  tag,
  '--notes',
  notes,
])

console.log(`\n✓ ${tag} released`)
