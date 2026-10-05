#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyChangesets } from './changesets'
import { pushBumpAndTags, remoteTagExists } from './commit-bump'
import {
  RELEASED_APPS,
  REPO_ROOT,
  type ReleasedApp,
  ROOT,
  readPackageJsonVersion,
  releaseTag,
  run,
} from './lib'

// a stray local run would push to main and publish a GitHub release
if (!process.env.CI) {
  throw new Error('ci-release is CI-only — it publishes a GitHub release')
}

type Release = {
  app: ReleasedApp
  version: string
  notes: string
  tag: string
}

// the version job sets <APP>_VERSION only for apps its changesets bumped
const releases: Release[] = RELEASED_APPS.flatMap((app) => {
  const prefix = app.key.toUpperCase()
  const version = process.env[`${prefix}_VERSION`]
  if (!version) return []
  const notes = process.env[`${prefix}_NOTES`] ?? ''
  return [{ app, version, notes, tag: releaseTag(app, version) }]
})

function releaseExists(tag: string): boolean {
  const result = spawnSync('gh', ['release', 'view', tag], { cwd: ROOT })
  if (result.error) throw result.error
  return result.status === 0
}

function requireFile(path: string): string {
  if (!existsSync(path)) throw new Error(`release asset not found: ${path}`)
  return path
}

function buildAsset({ app, version }: Release): string {
  if (app.key === 'desktop') {
    run('bash', ['scripts/build.sh'])
    return requireFile(
      resolve(ROOT, 'build', `Agent-Control-${version}-arm64.zip`)
    )
  }
  run('bun', ['run', '--filter', app.name, 'zip'], REPO_ROOT)
  return requireFile(
    resolve(app.dir, '.output', `Agent-Control-Extension-${version}.zip`)
  )
}

// the bump commit pushes every tag at once, so either all are on the remote or
// none are
const firstTag = releases[0]?.tag
if (!firstTag) {
  throw new Error('no app versions set — the version job computes them')
}
if (remoteTagExists(firstTag)) {
  // an earlier attempt pushed the bump and tags but didn't finish publishing;
  // ship the tagged commit rather than applying the changesets a second time
  run('git', [
    'fetch',
    '--force',
    'origin',
    ...releases.map(({ tag }) => `refs/tags/${tag}:refs/tags/${tag}`),
  ])
  run('git', ['checkout', '--detach', firstTag])
} else {
  applyChangesets()
  for (const { app, version } of releases) {
    const applied = readPackageJsonVersion(app.dir)
    if (applied !== version) {
      throw new Error(
        `changesets produced ${app.name} ${applied} here but ${version} in the version job`
      )
    }
  }
}

const unpublished = releases
  .filter(({ tag }) => !releaseExists(tag))
  .map((release) => ({ ...release, asset: buildAsset(release) }))

// pushed after the builds, so main only advances for versions that built (and,
// for the app, signed and notarized)
if (!remoteTagExists(firstTag)) {
  pushBumpAndTags(
    `[release] ${releases.map(({ app, version }) => `${app.key} ${version}`).join(', ')}`,
    releases.map(({ tag }) => tag)
  )
}

for (const { tag, notes, asset } of unpublished) {
  run('gh', [
    'release',
    'create',
    tag,
    asset,
    '--verify-tag',
    '--title',
    tag,
    '--notes',
    notes,
  ])
  console.log(`✓ ${tag} released`)
}
