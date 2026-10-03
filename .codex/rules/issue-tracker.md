# Issue tracker

Handed a ticket — a Linear issue, a GitHub issue, a Jira key, a URL, a bare
identifier — you have taken on its **status** as well as its work. A ticket left
in Todo while the branch is three commits deep is worse than an untracked one:
it reads as available, so the human running the board plans around work that is
already happening.

Nobody is coming behind you to fix it. Every skill that acts on a ticket owns
this — building it, fixing it, reviewing it, handing it on.

## Resolve the tracker before touching it

The approved tracker and the team live in the atlas `tools/issue-tracker.md`
entry (bootstrap probe in the `atlas-init` skill's `references/atlas-location.md`). Read it; don't guess a tracker,
and don't fall back to a different one silently.

No entry, or no atlas → say so once and carry on with the work. A missing
tracker is not a reason to stop building; it is a reason not to invent one.
Offer to record it, and drop it if declined.

## Statuses: match on kind, never on name

Every tracker names its columns differently — "In Progress" here, "Doing" or
"Started" elsewhere — but they sort into the same handful of **kinds**:
`backlog`, `unstarted`, `started`, `completed`, `canceled`. Linear exposes this
directly as a `type` on each status; other trackers imply it by column position
or by a resolved/unresolved flag.

**Read the available statuses and pick by kind.** Hardcoding "In Progress"
breaks on the first workspace that renamed it, and the failure is silent — the
call errors, or worse, matches nothing and moves nothing.

Where several statuses share a kind — a board with both "In Progress" and "In
Review" under `started` — pick the one whose name matches the phase you're in.
Only one status of that kind → use it for every phase; the board simply doesn't
draw that distinction, and inventing a column is a decision that isn't yours.

## The two transitions you own

- **Work starts → a `started` status.** Set it when you begin, not when you
  finish. The status exists to tell someone else the work is taken.
- **A PR opens → the review-flavoured `started` status,** where the board has
  one. Otherwise leave it where it is.

That's the whole ladder.

## Never mark it complete

Completion follows a merge, and merging is the user's. Never set a `completed`
or `canceled` status — not when the tests pass, not when the branch is pushed,
not when you believe the work is done. Where the tracker's own integration
closes tickets on merge, a status you set races it; where it doesn't, the user
closes it and that is the point at which someone actually looked.

Same for a ticket you were not handed. Fixing something in passing does not
make you the owner of somebody else's board.

## Link the PR to the ticket

Know both a ticket and a PR? Attach the PR to the ticket, once, when the PR is
opened. Prefer the tracker's **native link** — Linear's attachments, Jira's
remote links — over a comment: native links render as real PR state, drive the
tracker's own automation, and don't duplicate on re-run. Comment only where the
tracker has no such mechanism.

**Check before creating.** Many trackers auto-link when the branch name carries
the issue identifier, so the link may already exist — a second one is noise the
user has to clean up.

Do it in the same action that opens the PR. A link added "later" is a link added
never, and the person who needed it was reading the ticket at the time.

## Don't rewrite what you didn't write

Status and the PR link are yours. The title, description, labels, estimate,
assignee, and priority are the user's — leave them exactly as found unless asked.

New information belongs in a **comment**: what you found, what you decided, what
you're handing on. Never edit a ticket's body to reflect what the work turned
into; the body is what was asked for, and losing that costs the one record of
where the change came from.

## Forbidden

- Working a ticket and leaving it in `backlog` or `unstarted`.
- Hardcoding a status name instead of resolving one by kind.
- Setting a `completed` or `canceled` status, ever.
- Inventing a status the board doesn't have.
- Opening a PR for a known ticket without linking it.
- Adding a second link the tracker's branch integration already made.
- Editing a ticket's title, body, or labels to match what you built.
