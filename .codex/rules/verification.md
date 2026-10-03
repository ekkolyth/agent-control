# Verification

A change is not verified until you've exercised the actual surface it affects.

## Testing philosophy

Prove observable behavior and contracts, not implementation mirroring. Type
checks, boundary validation, and integration checks answer different questions;
use the one that reaches the behavior at risk. Exercise an actual boundary,
including serialization/parsing, and check a producer and consumer against the
same definition. Prefer real dependencies where practical; mocks must not remove
the behavior being tested.

Behavioral changes need meaningful acceptance cases and use red/green when it
helps establish the change. A bug fix reproduces the real defect at a seam that
preserves the triggering interaction, then verifies the original scenario after
the fix. If an environment or adequate seam is unavailable, record the exact
limit and obtain approval for an alternative; absence is not a waiver.

Mechanical, formatting, and content-only work uses the relevant existing
reference, lint, type, build, or focused checks. Do not manufacture a behavioral
test for it. Conversely, do not relabel a behavioral edit as mechanical to drop
already-agreed verification. Reuse valid evidence, and rerun it only when
relevant code, dependency, configuration, environment, or concrete review doubt
invalidates it.

## Workspace / dependency changes

When the change touches `package.json`, lockfiles, workspace layout, tsconfig paths, build config, env loading, or anything else that affects how the dev environment boots — the environment has to actually boot, and you have to watch it do so.

- Booting it follows `general-behavior` → FORBIDDEN Commands: ask first, naming the command and why the change needs a boot, then run it under a hard timeout in seconds.
- Watch the boot output. Look for module-resolution errors, alias failures, env warnings.
- Typecheck + build + tests passing is NOT verification for environment changes. They run in different contexts than the dev server.

## Lockfile changes

After any `package.json` change, run an install and commit the updated lockfile. Whether a frozen-lockfile gate is appropriate depends on the project's package manager + version — some have known false-positive bugs. Defer to project-local rules.

## Don't claim verified without evidence

Don't write "verified" or "tested" if you didn't run the relevant command. Quote the command + relevant output line if pressed.
