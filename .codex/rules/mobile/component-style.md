# Mobile component style

## List cards

Mobile list cards (Settings rows, Account rows, dashboard widgets, list items inside a section) drop the outer border. Use `bg-card rounded-xl` only — no `border`, no `border-border`.

```tsx
// ✅
<View className='bg-card rounded-xl p-4'>...</View>

// ❌
<View className='bg-card rounded-xl border border-border p-4'>...</View>
```

Reason: the canonical look (Settings/Account screens) uses card surface + radius alone. Outer borders create double-line noise against grouped layouts.

## Bottom-sheet / modal action labels

Trailing action buttons (the confirm button at the bottom of a sheet/modal) use bare verbs only:

- `Add`, `Create`, `Save`, `Delete`, `Update`, `Remove`

Never verb + noun:

- ❌ `Add Bill`, `Create Quest`, `Save Recipe`, `Delete Note`

The sheet's title and surrounding context already say what's being acted on. The button repeats that for no gain.

```tsx
// ✅
<BottomSheet title='New bill'>
  <Form />
  <Button>Add</Button>
</BottomSheet>

// ❌
<BottomSheet title='New bill'>
  <Form />
  <Button>Add Bill</Button>
</BottomSheet>
```
