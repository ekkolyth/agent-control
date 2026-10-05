import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pushBumpAndTag, remoteTagExists } from './commit-bump'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

// scratch repos sign nothing: they only exist for the length of a test
function configure(repo: string): void {
  git(repo, 'config', 'user.name', 'test')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'commit.gpgsign', 'false')
  git(repo, 'config', 'tag.gpgsign', 'false')
}

function clone(remote: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-clone-'))
  dirs.push(dir)
  git(dir, 'clone', '--quiet', remote, '.')
  configure(dir)
  return dir
}

// a bare remote with one commit on main, plus a clone whose desktop app has a
// pending version bump in the working tree
function setUp(): { remote: string; repo: string; desktop: string } {
  const remote = mkdtempSync(join(tmpdir(), 'release-remote-'))
  dirs.push(remote)
  git(remote, 'init', '--quiet', '--bare', '--initial-branch=main')

  const seed = clone(remote)
  mkdirSync(join(seed, 'apps', 'desktop'), { recursive: true })
  mkdirSync(join(seed, 'apps', 'extension'), { recursive: true })
  mkdirSync(join(seed, '.changeset'))
  writeFileSync(join(seed, 'apps', 'desktop', 'package.json'), '0.0.0\n')
  writeFileSync(join(seed, 'apps', 'extension', 'package.json'), '0.0.0\n')
  writeFileSync(join(seed, '.changeset', 'first.md'), 'a change\n')
  git(seed, 'add', '--all')
  git(seed, 'commit', '--quiet', '-m', 'seed')
  git(seed, 'push', '--quiet', 'origin', 'HEAD:main')

  const repo = clone(remote)
  const desktop = join(repo, 'apps', 'desktop')
  writeFileSync(join(desktop, 'package.json'), '0.1.0\n')
  writeFileSync(join(desktop, 'CHANGELOG.md'), '## 0.1.0\n')
  const extension = join(repo, 'apps', 'extension')
  writeFileSync(join(extension, 'package.json'), '0.1.0\n')
  writeFileSync(join(extension, 'CHANGELOG.md'), '## 0.1.0\n')
  rmSync(join(repo, '.changeset', 'first.md'))
  return { remote, repo, desktop }
}

describe('pushBumpAndTag', () => {
  it('pushes the app and extension bump and its tag to main together', () => {
    const { remote, repo, desktop } = setUp()

    const sha = pushBumpAndTag('0.1.0', desktop)

    expect(git(remote, 'rev-parse', 'main')).toBe(sha)
    expect(git(remote, 'rev-parse', 'v0.1.0^{commit}')).toBe(sha)
    expect(
      git(repo, 'show', '--name-only', '--format=', sha).split('\n')
    ).toEqual(
      expect.arrayContaining([
        '.changeset/first.md',
        'apps/desktop/CHANGELOG.md',
        'apps/desktop/package.json',
        'apps/extension/CHANGELOG.md',
        'apps/extension/package.json',
      ])
    )
  })

  it('pushes neither the bump nor the tag when main has moved on', () => {
    const { remote, desktop } = setUp()
    const other = clone(remote)
    writeFileSync(join(other, 'later.txt'), 'merged meanwhile\n')
    git(other, 'add', '--all')
    git(other, 'commit', '--quiet', '-m', 'later merge')
    git(other, 'push', '--quiet', 'origin', 'HEAD:main')
    const movedMain = git(remote, 'rev-parse', 'main')

    expect(() => pushBumpAndTag('0.1.0', desktop)).toThrow()

    expect(git(remote, 'rev-parse', 'main')).toBe(movedMain)
    expect(git(remote, 'tag', '--list', 'v0.1.0')).toBe('')
  })
})

describe('remoteTagExists', () => {
  it('sees a tag only once it is on the remote', () => {
    const { desktop } = setUp()
    expect(remoteTagExists('v0.1.0', desktop)).toBe(false)

    pushBumpAndTag('0.1.0', desktop)

    expect(remoteTagExists('v0.1.0', desktop)).toBe(true)
  })
})
