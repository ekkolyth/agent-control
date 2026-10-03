# Reuse before building

## Search before you write

Before writing new code, go look for what already exists. Grep for the helper,
the type, the pattern, the constant — in this package and in its siblings.
Re-implementing something that lives a few files over is the most common form of
slop, and it survives review because the new code reads fine on its own.

## Resolution order

Stop at the first rung that holds:

1. **The project's recorded tool choices.** Where a project records an approved
   dependency per domain — validation, forms, http client, orm, testing — read
   that record before searching anywhere else. It is a decision already made.
2. **What is already installed, or already written in this codebase.**
3. **The standard library.**
4. **A native platform feature** — a built-in element or API over a library, a
   database constraint over application code.
5. **An already-installed dependency.**
6. **A new dependency**, and never without explicit approval (see
   `general-behavior`).

When the choice is genuinely live, ask rather than deciding — and default toward
what the recorded tool choice says.

## Place new work where it can be reused

When you do write something new, decide where it belongs before you write it. A
helper buried in the app that happened to need it first is invisible to the next
caller, who then writes it again. If a second consumer is plausible, put it in
the shared package — or, in a single-project repo, the shared module. The goal is
to grow the shared surface over time, not to avoid writing code.

## Never simplified away

Validation at trust boundaries, error handling that prevents data loss, security
measures, accessibility basics, and anything the user explicitly asked for.
Reuse and minimalism never override these.
