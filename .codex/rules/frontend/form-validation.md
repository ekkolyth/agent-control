# Field Validation

One canonical pattern, independent of the form library, the schema library, and
the component kit. It is about **when** validation runs and **when** errors
appear; the mechanics are the library's business.

- **First run: on blur.** A field the user hasn't finished with never shows an
  error mid-typing.
- **Every run after that: on change,** live, against the same schema — so the
  keystroke that fixes a mistake is the one that clears it.
- **Cross-field rules** (password match, end-after-start) run on submit.
- **Async rules** (uniqueness) take the same shape, debounced only where the
  call is expensive.
- **Errors render only once that first blur has happened** and the field
  currently has one. Gate the display explicitly rather than trusting validator
  timing to imply it — the gate survives a later reshape of the validators.

Read that gate off the flag meaning *has been blurred at least once*, never one
merely named for having been "touched". Libraries disagree on whether typing
counts as a touch, and where it does, the gate is already true on the first
keystroke and does nothing.

Once a project has two forms, all of this collapses behind one field block
owning label, control, error, and gate in a single prop set, so call sites pass
a schema and nothing else.

A form library owns this. Past a single-field micro-form, a `useState` per field
plus a hand-rolled `safeParse` into some error-message state reimplements the
timing above badly and drifts from every other form in the project.
