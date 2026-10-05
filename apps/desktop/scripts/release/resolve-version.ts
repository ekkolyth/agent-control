#!/usr/bin/env bun
import { randomBytes } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applyChangesets,
  assertOnlyReleasedChangesets,
  changelogSection,
  pendingChangesets,
} from './changesets'
import { RELEASED_APPS, readPackageJsonVersion } from './lib'

const DELIMITER_BYTES = 8

function writeOutput(key: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) throw new Error('GITHUB_OUTPUT unset')
  // random delimiter so changelog text can't close the block early
  const delimiter = `EOF_${randomBytes(DELIMITER_BYTES).toString('hex')}`
  appendFileSync(outputPath, `${key}<<${delimiter}\n${value}\n${delimiter}\n`)
}

const pending = pendingChangesets()
if (pending.length === 0) {
  console.log('no changesets on this commit — skipping release')
  process.exit(0)
}

assertOnlyReleasedChangesets()

const before = RELEASED_APPS.map((app) => readPackageJsonVersion(app.dir))

// only to read the resulting versions and notes; the release job re-applies
// them on its own checkout and commits the result
applyChangesets()

RELEASED_APPS.forEach((app, index) => {
  const version = readPackageJsonVersion(app.dir)
  if (version === before[index]) return
  const notes = changelogSection(
    readFileSync(resolve(app.dir, 'CHANGELOG.md'), 'utf8'),
    version
  )
  writeOutput(`${app.key}_version`, version)
  writeOutput(`${app.key}_notes`, notes)
  console.log(`resolved ${app.name} ${version} from ${pending.join(', ')}`)
})
