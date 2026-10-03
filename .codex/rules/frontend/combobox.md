# Comboboxes

Applies to any picker that lets the user select an existing entry *or* create a
new one inline — tags, people, projects, playlists, entity pickers.

## Create goes first

When the typed query is non-empty and doesn't exactly match an existing entry,
the `Create "{query}"` item MUST be reachable by a single Enter with no arrowing.
Where the list widget auto-highlights its first item — `cmdk` does, and the
example below assumes it — that means rendering Create **first**. Where it
doesn't, set the initial highlight explicitly; the requirement is the keystroke,
not the index.

```tsx
<CommandList>
    {trimmed && !exactMatch && (
        <CommandItem onSelect={() => create(trimmed)}>
            Create “{trimmed}”
        </CommandItem>
    )}
    {matches.map((match) => (
        <CommandItem key={match.id} onSelect={() => select(match)}>
            {match.name}
        </CommandItem>
    ))}
</CommandList>
```

The user typed the exact thing they want; existing matches are secondary. Making
them arrow down past unrelated fuzzy matches to reach Create inverts the common
case.

## Forbidden

- Create rendered last, or after a `CommandSeparator` below the matches.
- Create shown only when there are zero matches — it must appear whenever there
  is no *exact* match, even if fuzzy matches exist.
- Requiring a click on Create when Enter is already the natural gesture.
