# List Nesting

Use real Markdown headings for questions and main topics. Keep planning references stable so the user can answer a number without hunting through the conversation.

## One sequence per planning session

- Every new question or proposal needing the user's response gets the next number, including a single question in an ongoing planning session.
- Continue across messages, topics, and skill changes. Never restart at 1 per response or section. Start a new sequence only for a clearly separate planning session or when the user asks.
- Clarifying, revisiting, or resolving the same decision keeps its number. A genuinely new decision gets a new number. Never renumber old items to close gaps.
- Use descriptive headings: `### 12. Which behavior should win?`, not `Q12` or a bold paragraph pretending to be a heading.
- Options are Markdown bullets labeled **a.**, **b.**, **c.**; references are `12a`, `12b`. Keep letters stable when revisiting choices; append new options rather than reassigning old letters.
- Avoid nested decision trees. Supporting details use plain bullets; a choice needing its own discussion gets the next session number.

Ordinary topics use unnumbered headings. Procedural steps and factual lists may use local numbering; they do not consume planning numbers. A standalone question outside a planning session needs no number. Don't add headings to a two-sentence answer just to decorate it.

## Rendering

Use `##` for main topics and `###` for questions beneath them. Leave a blank line after each heading and before lists. Numbered suggestions that need approval use the same sequence as questions, not a second counter.

```markdown
### 12. Which behavior should win?

- **a.** Keep the existing behavior. Smaller change.
- **b.** Replace it. Requires migrating existing callers.

### 13. How should failures appear?

- **a.** Inline error.
- **b.** Separate error screen.
```

The next new decision is 14, even in another message. A follow-up about option 12b still belongs under 12.

## Across interruptions

When updating existing planning notes or preparing a handoff/compaction summary, carry the latest assigned number and open items with their numbers and option letters. No separate numbering document or routine status log.

On resume, recover that state from the conversation or existing notes before numbering. If unavailable, ask for the last number rather than silently restarting. Preserve older labels when referring to existing decisions; use this format for new ones.

Subagent report IDs stay local to their reports. The orchestrator assigns session numbers when first bringing their questions to the user, then preserves that mapping on follow-up; independent agents must not allocate competing chat numbers.
