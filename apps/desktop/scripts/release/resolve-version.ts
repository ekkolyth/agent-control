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
import { ROOT, readPackageJsonVersion } from './lib'

const DELIMITER_BYTES = 8

function writeOutput(version: string, notes: string): void {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) throw new Error('GITHUB_OUTPUT unset')
  // random delimiter so changelog text can't close the block early
  const delimiter = `EOF_NOTES_${randomBytes(DELIMITER_BYTES).toString('hex')}`
  appendFileSync(
    outputPath,
    `version=${version}\nnotes<<${delimiter}\n${notes}\n${delimiter}\n`
  )
}

const pending = pendingChangesets()
if (pending.length === 0) {
  console.log('no changesets on this commit — skipping release')
  writeOutput('', '')
  process.exit(0)
}

assertOnlyReleasedChangesets()

// only to read the resulting version and notes; the release job re-applies
// them on its own checkout and commits the result
applyChangesets()
const version = readPackageJsonVersion()
const notes = changelogSection(
  readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8'),
  version
)

writeOutput(version, notes)
console.log(`resolved ${version} from ${pending.join(', ')}`)
