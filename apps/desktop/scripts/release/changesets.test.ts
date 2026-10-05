import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertOnlyReleasedChangesets,
  changelogSection,
  pendingChangesets,
} from './changesets'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'changesets-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeChangeset(dir: string, name: string, frontmatter: string): void {
  mkdirSync(join(dir, '.changeset'), { recursive: true })
  writeFileSync(
    join(dir, '.changeset', name),
    `---\n${frontmatter}\n---\n\nA change\n`
  )
}

describe('pendingChangesets', () => {
  it('lists changeset files and ignores the readme and config', () => {
    const dir = tempDir()
    mkdirSync(join(dir, '.changeset'))
    for (const name of ['README.md', 'config.json', 'witty-plants-work.md']) {
      writeFileSync(join(dir, '.changeset', name), '')
    }
    expect(pendingChangesets(dir)).toEqual(['witty-plants-work.md'])
  })

  it('finds nothing when no changeset was added', () => {
    const dir = tempDir()
    mkdirSync(join(dir, '.changeset'))
    writeFileSync(join(dir, '.changeset', 'README.md'), '')
    expect(pendingChangesets(dir)).toEqual([])
  })
})

describe('assertOnlyReleasedChangesets', () => {
  it('accepts changesets that bump the desktop app or the extension', () => {
    const dir = tempDir()
    writeChangeset(dir, 'a.md', "'@agent-control/desktop': minor")
    writeChangeset(dir, 'b.md', '"@agent-control/extension": patch')
    expect(() => assertOnlyReleasedChangesets(dir)).not.toThrow()
  })

  it('rejects a changeset that bumps another package, naming it', () => {
    const dir = tempDir()
    writeChangeset(dir, 'a.md', "'@agent-control/desktop': minor")
    writeChangeset(
      dir,
      'b.md',
      "'@agent-control/desktop': patch\n'@agent-control/server': patch"
    )
    expect(() => assertOnlyReleasedChangesets(dir)).toThrow(
      'b.md bumps @agent-control/server'
    )
  })
})

describe('changelogSection', () => {
  const changelog = `# desktop

## 0.4.0

### Minor Changes

- Add changesets

### Patch Changes

- Fix the tray panel

## 0.3.4

### Patch Changes

- Older fix
`

  it('returns only the notes for the released version', () => {
    expect(changelogSection(changelog, '0.4.0')).toBe(
      '### Minor Changes\n\n- Add changesets\n\n### Patch Changes\n\n- Fix the tray panel'
    )
  })

  it('reads the last section when it is the only one', () => {
    expect(changelogSection(changelog, '0.3.4')).toBe(
      '### Patch Changes\n\n- Older fix'
    )
  })

  it('fails loudly when the version has no section', () => {
    expect(() => changelogSection(changelog, '9.9.9')).toThrow('9.9.9')
  })
})
