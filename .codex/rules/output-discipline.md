# Leave no residue

Committed work should read as if a careful engineer wrote it, because that is the
standard — not because anything is being concealed. Generated output has a
recognisable residue: attribution nobody asked for, ceremony where a sentence
would do, comments restating the line beneath them. All of it is noise, and it
survives in the repository long after the session that produced it.

- **No tool or assistant attribution in anything committed** — commit messages,
  code, comments, PR descriptions. No `Co-Authored-By` trailer. Who or what
  helped write a change is not information the next reader needs; what changed
  and why is. A trailer naming a tool is a line of every future `git log` spent
  on nothing.
- **No changelog voice.** Verbose, ceremony-heavy, marketing phrasing — "adopts
  X + Y parity", "comprehensive refactor", a bulleted feature tour on a two-line
  fix — is padding, and it buries the one sentence that mattered. Terse and
  ordinary (see the `commit` skill).
- **No comments that restate the code.** See `comment-style`: a comment earns its
  line by carrying what the code cannot — a why, a constraint, a bound. Narrating
  what the next line plainly does is the most common residue of all.
- **Working artifacts are not project documentation.** Specs, plans, and scratch
  notes belong under the agent config directory, not in `docs/` or anywhere else
  the repository publishes. They are the by-product of doing the work, not a
  deliverable, and shipping them makes a reader hunt for which documents are real.
- **The agent config directory is gitignored.** Never `git add` anything under it.
  Rules, specs, and plans stay local unless the repo has deliberately opted a
  path into tracking.
- **Credentials never enter the repository or a transcript.** Local test and build
  credentials live in the atlas `credentials/` directory — scaffolded empty, never
  overwritten, never committed, and never echoed into a log, a transcript, or a
  tool result. Read a value in-shell and write it straight to its destination. A
  repo that tracks its atlas must still re-exclude `credentials/` from the
  carve-out (see the `atlas-init` skill's `references/entry-format.md`), or committing the atlas commits the tokens.
