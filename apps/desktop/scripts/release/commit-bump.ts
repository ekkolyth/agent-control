import { spawnSync } from 'node:child_process'
import { ROOT, run } from './lib'

function headSha(cwd: string): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function remoteTagExists(tag: string, cwd: string = ROOT): boolean {
  const result = spawnSync(
    'git',
    ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`],
    { cwd, encoding: 'utf8' }
  )
  if (result.error) throw result.error
  // ls-remote --exit-code returns 2 when nothing matched
  if (result.status === 2) return false
  if (result.status !== 0) {
    throw new Error(`git ls-remote failed: ${result.stderr}`)
  }
  return true
}

// commits the bump and tags it, then pushes both in one atomic push so main and
// the tag can't disagree; if main moved since this run's commit the push is
// rejected and nothing lands, leaving the changesets for the next run
function pushBumpAndTag(version: string, cwd: string = ROOT): string {
  run('git', ['config', 'user.name', 'github-actions[bot]'], cwd)
  run(
    'git',
    ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'],
    cwd
  )
  // both bumps, their changelogs, and the changeset files they consumed
  run(
    'git',
    [
      'add',
      '--all',
      '--',
      'package.json',
      'CHANGELOG.md',
      '../extension/package.json',
      '../extension/CHANGELOG.md',
      '../../.changeset',
    ],
    cwd
  )
  run('git', ['commit', '-m', `[release] ${version} [skip ci]`], cwd)

  const tag = `v${version}`
  run('git', ['tag', '--annotate', tag, '--message', tag], cwd)
  run(
    'git',
    ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`],
    cwd
  )
  return headSha(cwd)
}

export { pushBumpAndTag, remoteTagExists }
