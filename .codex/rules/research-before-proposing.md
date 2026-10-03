# Research before proposing

Never suggest a strategy, alternative, refactor, migration, or fix without first reading the actual code the suggestion touches. No guessing, no assuming, no blind grep-as-a-substitute-for-reading.

## Apply

- Before naming a file, function, symbol, or class in a suggestion: open it (`Read`) and confirm it exists in the shape you're about to describe.
- Before proposing a refactor that touches N files: read a representative sample (at least the entry points) and the primitives/utilities the change depends on. If N is small, read all of them.
- Before proposing a "swap X for Y" migration: read X's current implementation. Do not infer its behavior from the name.
- Before proposing "the pattern here is …": read at least three real occurrences of the pattern in this repo. Not memory, not template knowledge.
- Before proposing "the token / primitive / helper for this is …": load the source of that token / primitive / helper. Verify it does what you claim.
- Grep is a lookup, not a comprehension. A `grep` result tells you where — you still have to read the file to know what.
- Skill / rule / agent authoring: read the sibling skill's `SKILL.md`, the primitive's source, the rule file — do not generate structure from your training-data prior.

## Forbidden

- "It probably works like …" without reading.
- "Based on the name, X does …" without opening X.
- "Following the existing pattern of …" without citing at least one real callsite you read this turn.
- "This should be safe because …" when the safety claim rests on unread code.
- Grep-scanning a filename list and inventing per-file behavior without opening each file.

## Framing

The cost of reading is small. The cost of proposing a strategy grounded in a hallucinated file, a misremembered API, or a wrongly-inferred pattern is very large — every downstream decision inherits the mistake, and the human partner has to re-litigate the whole plan when they discover the ground truth.

When you don't know: say so, then read. Not the other way around.
