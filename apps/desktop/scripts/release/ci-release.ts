#!/usr/bin/env bun
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyChangesets } from './changesets'
import { commitBump } from './commit-bump'
import { ROOT, readPackageJsonVersion, run } from './lib'

// a stray local run would push to main and publish a GitHub release
if (!process.env.CI) {
  throw new Error('ci-release is CI-only — it publishes a GitHub release')
}

const version = process.env.VERSION
if (!version) throw new Error('VERSION unset — the version job computes it')
const notes = process.env.RELEASE_NOTES ?? ''

applyChangesets()
const applied = readPackageJsonVersion()
if (applied !== version) {
  throw new Error(
    `changesets produced ${applied} here but ${version} in the version job`
  )
}

run('bash', ['scripts/build.sh'])

const zip = resolve(ROOT, 'build', `Agent-Control-${version}-arm64.zip`)
if (!existsSync(zip)) throw new Error(`release zip not found: ${zip}`)

// bump last: main only advances once the build has actually shipped, and the
// tag lands on a commit whose package.json already reads this version
const tag = `v${version}`
const target = commitBump(version)

run('gh', [
  'release',
  'create',
  tag,
  zip,
  '--title',
  tag,
  '--notes',
  notes,
  '--target',
  target,
])

console.log(`\n✓ ${tag} released`)
