import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..')
const REPO_ROOT = resolve(ROOT, '..', '..')

function readPackageJsonVersion(): string {
  const path = resolve(ROOT, 'package.json')
  const match = /"version"\s*:\s*"([^"]+)"/.exec(readFileSync(path, 'utf8'))
  if (!match?.[1]) throw new Error(`could not find version in ${path}`)
  return match[1]
}

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} exited with status ${result.status}`
    )
  }
}

export { REPO_ROOT, ROOT, readPackageJsonVersion, run }
