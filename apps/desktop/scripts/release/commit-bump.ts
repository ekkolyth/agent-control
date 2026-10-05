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

// commits the bumps and tags them, then pushes the commit and every tag in one
// atomic push so main and the tags can't disagree; if main moved since this
// run's commit the push is rejected and nothing lands, leaving the changesets
// for the next run
function pushBumpAndTags(
  message: string,
  tags: string[],
  cwd: string = ROOT
): string {
  run('git', ['config', 'user.name', 'github-actions[bot]'], cwd)
  run(
    'git',
    ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'],
    cwd
  )
  // each app's bump, its changelog, and the changeset files consumed
  run('git', ['add', '--all', '--', '..', '../../.changeset'], cwd)
  run('git', ['commit', '-m', `${message} [skip ci]`], cwd)

  for (const tag of tags) {
    run('git', ['tag', '--annotate', tag, '--message', tag], cwd)
  }
  run(
    'git',
    [
      'push',
      '--atomic',
      'origin',
      'HEAD:refs/heads/main',
      ...tags.map((tag) => `refs/tags/${tag}`),
    ],
    cwd
  )
  return headSha(cwd)
}

export { pushBumpAndTags, remoteTagExists }
