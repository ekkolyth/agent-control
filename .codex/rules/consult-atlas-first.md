# Consult atlas first

Before proposing any non-trivial change — architecture, tool choice, form pattern, error-handling shape, external integration — check `.agents/atlas/` (or invoke `/atlas-recall`).

## What atlas contains

The anchor, then three surfaces sharded one-file-per-entry:

- `vision.md` — why the project exists, what it optimizes for, where authority sits, what success means. **Read it before any real work** — it's what every entry below serves, and it's the shared understanding a session otherwise re-derives or guesses. `/atlas-vision` creates and revises it.
- `context/` — decisions with rationale, past incidents (`pitfall`), hard constraints, pointers to external systems and their owners. An entry diverging from the vision carries a `tension:` line naming the divergence — recorded on purpose, never suppressed.
- `vocabulary/` — canonical names for project concepts, plus the names to avoid.
- `tools/` — the approved tool per domain (forms, orm, validation, http-client, environment, package manager, task runner, migrations, CI, …) and why the alternatives lost. A domain is anything the project made one choice for — a CLI or a workflow tool owns a domain exactly as much as an importable library does.

This is **non-obvious project info a fresh reader can't derive from code, git history, or these rules**. Skipping it means re-litigating decisions the user already made.

## When to consult

- **Reaching for a tool for some domain?** Check `tools/<domain>.md` for the approved one. Missing → invoke `/atlas-tools <domain>`. This covers anything the project standardised on, not only what you `import` — the env-var source of truth, the package manager, and the migration runner each own a domain.
- **Designing a form, mutation, migration, endpoint, workflow?** Search `context/` by `trigger` and `appliesTo` for constraints and decisions.
- **Debating a name or concept?** Check `vocabulary/`. Match found → use the canonical term.
- **Debugging weird behavior?** Browse `context/pitfall/` — someone may have already recorded it.
- **Starting a real piece of work** (`/implement`, `/diagnose`, `/review`)? Fire `/atlas-recall` at step 0 with the task description + touched files, pass the digest to every downstream dispatch. The digest leads with the vision summary — that preamble travels with it.
- **Direction itself shifting?** A pivot, a new success gate, a scope cut that changes what the project is for — that's a `vision.md` revision via `/atlas-vision`, not a context entry.

## Read path

`.agents/atlas/vision.md`, then `.agents/atlas/context/**/*.md`, `.agents/atlas/{vocabulary,tools}/*.md` (or the path in `.agents/atlas/LOCATION`). No merged file — each surface is its own directory of entries. `context/` nests one level deeper, a folder per `kind`, so a glob over it has to descend.

For a quick scan: `ls .agents/atlas/tools/` or `ls .agents/atlas/context/pitfall/`.
For a targeted digest: invoke `/atlas-recall <query>`.

## Forbidden

- Proposing tool X for a domain when `tools/<domain>.md` sanctions Y, without noting the divergence and asking the user.
- Proposing architecture that conflicts with a `context/` `decision` entry without flagging the conflict first.
- Ignoring a `pitfall` entry whose `trigger` matches the current work.
- Reintroducing a name a `vocabulary/` entry lists under `avoid`.
- Silently overriding a `constraint` because it seems inconvenient.
- Proposing work that cuts against `vision.md` without naming the conflict — and, symmetrically, refusing to record something real because it diverges from the vision. Divergence gets a `tension:` line, never suppression.

## When there is no atlas

If `.agents/atlas/` doesn't exist, the project hasn't scaffolded one. Don't try to compensate by memorising every past conversation. What to do next depends on whether you were about to read it or write to it.

**Reading** — consulting the atlas before a change, or running `/atlas-recall` as a preflight. Proceed with rules + code as your only sources. Mention once that `/atlas-init` would seed one, and carry on. Never interrupt a read to scaffold; the user asked for the work, not for setup.

**Writing** — you've got something worth recording and nowhere to put it: a decision just landed, an incident just got understood, a term just got disambiguated, a tool choice just got settled. Offer to scaffold, in one question, and on yes create the structure and write the entry in the same pass. The procedure is `atlas-init`'s **Dirty init — scaffolding mid-conversation** section: three directories and a README, nothing else — no seeding pass, no tracking question, no relocation.

Do not answer a write with "run `/atlas-init` first, then come back". The entry is the thing the user wanted; a setup errand between them and it is how entries stop getting written at all. If they decline the offer, finish the task without it and don't ask again this session.

## Why

Rules cover conventions that apply everywhere. Code shows what's built. Atlas covers the middle: the *decisions* and *incidents* and *constraints* that shape how the next change should be made. Skip it and the same footgun gets rediscovered, the same tradeoff gets re-argued, and a different tool gets picked than the one already standardised on. All of that is expensive.
