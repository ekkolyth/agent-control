import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { REPO_ROOT } from './lib'

// a merge releases only when it carries at least one of these
function pendingChangesets(repoRoot: string = REPO_ROOT): string[] {
  const dir = resolve(repoRoot, '.changeset')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
}

// consumes the changesets: bumps package.json and writes CHANGELOG.md
// the CLI finds .changeset relative to its working directory, so run it at the root
function applyChangesets(): void {
  const result = spawnSync(
    resolve(REPO_ROOT, 'node_modules', '.bin', 'changeset'),
    ['version'],
    { cwd: REPO_ROOT, stdio: 'inherit' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`changeset version exited with status ${result.status}`)
  }
}

function changelogSection(changelog: string, version: string): string {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${version}`)
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no section for ${version}`)
  }
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

export { applyChangesets, changelogSection, pendingChangesets }
