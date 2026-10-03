# Git workflow

Operational git rules. Apply to every repo. Commit only through the `commit` skill, which owns the message format.

## Never push

Do not run `git push` under any circumstances. The user pushes manually. No exceptions for "the branch is clean," "the PR is ready," or "the test passed."

**Two carve-outs, both narrow.**

- **`/pr`** — pushes the branch you are already on, once, to open its pull request. That is the skill's whole purpose and the user typed it. It never creates or switches a branch, never pushes a second time, and never merges.
- **`/watch`** — pushes at the one step of its own subagent's fix-and-rebuild loop that commits a fix that subagent both applied and verified locally, on the current branch.

Both are plain `git push` only: never `--force`, never `--force-with-lease`, never `--no-verify`. Every other context — any other skill, any orchestrator, any subagent — remains bound by "never push", and the carve-out ends when the authorized action does. Do not extend either by analogy.

## No force-push

Never propose force-push to resolve a non-fast-forward error. Use a merge-based reconcile instead:

```sh
git fetch origin
git merge origin/<branch>         # standard merge
git merge -s ours origin/<branch> # when local should win and history must remain linear
```

`--force-with-lease` is also off-limits unless the user explicitly asks for it on a branch only they own.

## No worktrees

Don't create `git worktree add` setups unless explicitly asked. Work on the current branch. If isolation is needed, ask first.

## No destructive shortcuts

`git reset --hard`, `git checkout .`, `git restore .`, `git clean -fd`, `git branch -D` — never used to "get around" an obstacle. Investigate the obstacle first.

## Hooks

Never bypass pre-commit / commit-msg hooks with `--no-verify`, `--no-gpg-sign`, `-c commit.gpgsign=false`. This holds even when signing hangs, times out, or the signer errors — a stuck signer is a blocker to report, not an obstacle to route around. Don't retry into a bypass flag on the same command; a failure means stop.

When `git commit` fails or hangs on signing: stop, show the exact error, and ask the user how to proceed. Do not silently fall back to an unsigned commit, do not choose a "just this once" flag on the user's behalf — that's the same unilateral-decision violation as picking a name or a design without asking. If a signed commit already landed unsigned before this was caught, say so immediately and offer `git commit --amend -S` once signing works — don't leave it in history quietly.

## CI / workflows

When touching `.github/workflows/`, don't leave a file with mixed or deprecated action references. Match the repo's pinning convention rather than imposing one:

- **Pinned to a commit SHA** — leave it pinned. That is a supply-chain control (GitHub hardening guidance and OpenSSF Scorecard both require it), not staleness. Rewriting `@a1b2c3d…` to `@v5` is a security regression that will fail a policy gate.
- **Moving major tags** — keep the majors consistent across the file, and bump a deprecated one.

A version bump your change doesn't require belongs in its own PR — a major bump is a breaking change unrelated to the work, which `general-behavior`'s scope section forbids.
