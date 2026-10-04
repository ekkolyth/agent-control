import { spawnSync } from 'node:child_process'
import { ROOT, run } from './lib'

function headSha(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

// pushes to main
export function commitBump(version: string): string {
  run('git', ['config', 'user.name', 'github-actions[bot]'])
  run('git', [
    'config',
    'user.email',
    'github-actions[bot]@users.noreply.github.com',
  ])
  // the bump, its changelog, and the changeset files it consumed
  const released = ['package.json', 'CHANGELOG.md', '../../.changeset']
  run('git', ['add', '--all', '--', ...released])

  const staged = spawnSync(
    'git',
    ['diff', '--staged', '--quiet', '--', ...released],
    { cwd: ROOT }
  )
  if (staged.error) throw staged.error
  if (staged.status === 0) {
    console.log(`nothing to commit for ${version} — no bump commit`)
    return headSha()
  }

  run('git', ['commit', '-m', `[release] ${version} [skip ci]`])
  run('git', ['push', 'origin', 'HEAD:main'])
  return headSha()
}
