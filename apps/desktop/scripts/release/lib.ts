import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..')
const REPO_ROOT = resolve(ROOT, '..', '..')

type ReleasedApp = {
  key: 'desktop' | 'extension'
  name: string
  dir: string
}

// changesets' own tag format for a multi-package repo
function releaseTag(app: ReleasedApp, version: string): string {
  return `${app.name}@${version}`
}

// each is versioned by its own changesets and gets its own GitHub release
const RELEASED_APPS: ReleasedApp[] = [
  {
    key: 'desktop',
    name: '@agent-control/desktop',
    dir: ROOT,
  },
  {
    key: 'extension',
    name: '@agent-control/extension',
    dir: resolve(REPO_ROOT, 'apps', 'extension'),
  },
]

function readPackageJsonVersion(dir: string = ROOT): string {
  const path = resolve(dir, 'package.json')
  const match = /"version"\s*:\s*"([^"]+)"/.exec(readFileSync(path, 'utf8'))
  if (!match?.[1]) throw new Error(`could not find version in ${path}`)
  return match[1]
}

function run(cmd: string, args: string[], cwd: string = ROOT): void {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} exited with status ${result.status}`
    )
  }
}

export type { ReleasedApp }
export {
  RELEASED_APPS,
  REPO_ROOT,
  ROOT,
  readPackageJsonVersion,
  releaseTag,
  run,
}
