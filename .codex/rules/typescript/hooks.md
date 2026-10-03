# Hook Design

## The mental model: remote control, not toolbox

A toolbox is organized by tool type — all the hammers here, all the screwdrivers there. You have to know what's in it before you can use it. That's what most hooks look like: `createQuestMutation`, `updateQuestMutation`, `deleteQuestMutation` — a pile of labeled tools.

A remote control is organized by **what you're controlling**. You point it at the TV and every button does something to *that thing*. You don't think about the mechanics — you just press play.

Hooks work the same way. `useQuest()` hands you a remote for quests. Every method on it is just a button — `quest.create()`, `quest.complete()`, `quest.remove()`. You never have to say *what* you're acting on, because the remote already knows.

**The test:** can you read it out loud and have it sound like English?

- `quest.complete(id)` → "complete this quest" ✓
- `useCompleteQuestMutation().mutate(id)` → nobody says this ✗

**The other half:** don't make the caller clean up your mess. If something goes wrong inside the hook, the hook handles it — toast, log, done. The caller just calls `quest.create()` and moves on. That complexity lives inside the remote, not in every room that has a TV.


Hooks return a **noun-shaped object** — the hook IS the noun.

```typescript
const quest = useQuest()
quest.create(title, type)
quest.complete(id)
quest.remove(id)

const budget = useBudget()
budget.create(name, amount)
budget.spend(id, amount, note)
budget.budgets         // data
budget.isLoading       // state
```

## Naming

- **Verbs are short and generic** — `create`, `update`, `remove`, `complete`, `spend`, `request`
- **Never suffix with the noun or implementation** — `create` not `createQuest`, `remove` not `removeMutation`, `list` not `bookmarksList`
- **`remove` not `delete`** — consistent across all hooks
- **Data keys match the domain noun** — `budget.budgets`, `notes.notes`, not `budget.budgetData`. **Hooks backed by TanStack Query return `{ data }`** — see `typescript/react-query.md`.

```typescript
// ✅
quest.create()
quest.remove()
budget.budgets
notes.notes

// ❌
quest.createQuest()
quest.deleteMutation()
budget.budgetList
notes.notesData
```

## Structure

- **Data and actions live together** — one hook returns both
- **Loading state always exposed** — `isLoading` on any hook that fetches
- **Options bag for callbacks** — accept an optional `options` param for `onCreateSuccess`, `onUpdateSuccess`, etc.
- **Errors handled internally** — toast inside the hook, public methods never throw to callers

```typescript
interface UseQuestOptions {
    onCreateSuccess?: () => void
}

export function useQuest(options?: UseQuestOptions) {
    // ...mutations wired to toasts internally...

    const create = async (title: string, type: QuestType): Promise<void> => {
        try {
            await createMutation.mutateAsync({ title, type })
        } catch {
            // Error handled by mutation
        }
    }

    return { create, update, remove, complete }
}
```

## Return shape

Return a **plain object** — no classes, no arrays. Keep internal mutation objects (`createMutation`, etc.) out of the return value; expose only the clean action functions.

```typescript
// ✅ clean surface
return {
    budgets,
    isLoading,
    create,
    update,
    remove,
    spend,
    getStats,
}

// ❌ leaking internals
return {
    budgets,
    createBudgetMutation,
    updateBudgetMutation,
    handleCreate,
}
```

## Composition

Hooks can call other hooks. A domain hook can embed a sub-hook in its return when the relationship is tight:

```typescript
// author.useBook(authorId, authorName) — scoped book actions for that author
const author = useAuthor()
const book = author.useBook(authorId, authorName)
book.request(bookId, bookTitle)
```

Prefer composing at the hook level over composing in components.

## Hook owns data + dispatch, page owns UI state

A hook is the **data surface** for its domain. The page owns ephemeral UI state (dialog open/closed, currently-editing item, search input).

### Hook owns

- Queries + mutations
- Toast/error handling around mutations
- Dispatch logic that routes between mutations (e.g. "if editing, update; else create" → ONE `save()` method)
- `onSaveSuccess` / `onCreateSuccess` callbacks for parent to react

### Page owns

- Dialog open/closed state
- Which item is being edited
- Search/filter inputs
- Local `useState` for UI-only concerns

### The smell

If a page has `handleSave` that branches into `edit(...)` vs `create(...)`, the hook is missing a `save(editingNote, data)` method. Pull the dispatch up.

If a page has `handleEdit` that's just `setEditingNote + setDialogOpen`, that's UI plumbing — keep it in the page (rename to `openEdit` if you like).

### Example

```tsx
import { surfaceError } from '<the project's error reporter>'

// hook
export function useNotes(options?: { onSaveSuccess?: () => void }) {
    const save = async (editingNote: Note | null, data: NoteSaveData) => {
        try {
            if (editingNote) {
                await updateMutation.mutateAsync({ id: editingNote._id, ...editFields(data) })
            } else {
                await createMutation.mutateAsync(data)
            }
            options?.onSaveSuccess?.()
        } catch (error) {
            surfaceError(error, { source: 'use-notes/save' })
        }
    }
    return { notes, save, remove, update, ... }
}

// page
const [editingNote, setEditingNote] = useState<Note | null>(null)
const { notes, save, remove } = useNotes({ onSaveSuccess: closeDialog })

<Dialog onSave={(data) => save(editingNote, data)} />
```
