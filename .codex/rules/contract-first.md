# Contract-First

When work introduces or changes a durable data model or published boundary,
agree its concrete shape before dependent design, planning, or implementation.
The agreement names fields, types, nullability, relationships, invariants, and
ownership, and is checked against existing definitions and integrations. Human
approval of that shape is required; it is not approval of the whole design.

## When this applies

- Go ↔ TypeScript HTTP endpoints
- External API integrations (third-party REST, GraphQL, RPC)
- WebSocket / SSE message payloads
- JSON files on disk that multiple processes read or write
- Queue / pubsub messages between services
- CLI input/output that other tools parse
- Anywhere two language runtimes or two processes exchange typed data
- A shared same-runtime model with multiple producers or consumers
- A persisted object, domain record, or public module shape whose change affects
  dependent work

## When it doesn't apply

- Temporary local object literals whose shape does not escape their expression
- Existing approved models used without a shape change
- An unchanged internal implementation detail with one local owner

## What "the contract" is

The agreed model is recorded in the existing design, spec, plan, or execution
brief with the evidence and approval that settled it. For a wire boundary, it
also needs a machine-checkable definition that both sides verify against. Two
forms, in order of preference:

**1. An IDL both sides generate from** — OpenAPI, protobuf/gRPC, GraphQL SDL,
Avro against a registry. The IDL *is* the contract and the generated code is the
guarantee: there is no sample to freeze and no schema to hand-write. Prefer this
wherever the boundary has one, and never add a hand-maintained artefact beside a
codegen pipeline that already promises more.

**2. A frozen sample plus a schema per side** — when there is no IDL: a
third-party API you don't control, a file format, an ad-hoc queue payload.

- A frozen sample committed to the repo (under `testdata/contracts/` or the
  producer's equivalent convention).
- A schema that parses it, in whatever validation library the project uses.
- Tests on BOTH sides reference the same sample file.

## Gates

1. **Settle the model early.** Read only the definitions and integrations needed
   to propose the shape. A new object, changed boundary, or unclear shape blocks
   dependent approaches and design until agreement. When no shape is new or
   changed, record why this gate is not applicable with evidence and continue.
2. **Preserve the agreement.** Downstream work references the existing artifact;
   it does not replay approval or require another document.
3. **Run the model checks before dependent behavior.** Existing read-only
   evidence may establish compatibility during design, but agreement does not
   authorize file or code creation. After whole-design approval, run and observe
   passing checks on the authoritative model or types, including same-runtime
   data objects. For a wire contract, also run the authoritative IDL or
   frozen-sample/schema check before building producer or consumer behavior.
   Reuse unchanged valid evidence. A failed or unresolved check blocks dependent
   execution. Do not add a parallel schema beside an IDL, and do not claim
   runtime proof before the behavior exists.

## Wire workflow

Either way, the contract lands first and drift fails CI.

1. **Sketch the contract** — the IDL, or a representative sample plus the schema
   that parses it.
2. **Commit it first**, before either side's implementation code.
3. **Implement the producer.** Its tests assert the emitted payload matches.
4. **Implement the consumer.** Its tests parse against the same definition.
5. **Drift fails CI.** A change on one side that doesn't update the contract
   breaks the other side's test.

## Half a contract is worse than none

Steps 3 and 4 are one unit. A boundary tested on the consumer side only is
the common shape, because the consumer test is the easy one to write — stub
the transport, hand it a body, assert the parse. It is also the shape that
fails silently: the body is the consumer's own assumption, so the test can
only tell you the consumer agrees with itself. The producer is free to send
something else forever, and CI stays green the entire time.

None of the usual signals fire. Coverage counts the boundary as tested. The
suite is green. Review sees a test file next to the code. The defect is
visible only by reading the producer and the consumer side by side and
noticing that no artefact sits between them — which is exactly the reading
nobody does when a test already exists.

So: **a boundary is contract-tested when the producer's emitted payload is
asserted against the same artefact the consumer parses.** One side plus a
hand-written stub is not a contract, and is worth naming as a defect in
review rather than counting as coverage. A boundary with no test on either
side at least looks untested, and gets fixed sooner.

## Schema location (TypeScript side)

Location depends on the project's schema-module convention. Universal
principle: integration-boundary schemas (external APIs, Go endpoints,
wire formats) live alongside other cross-boundary schemas; DB-mirroring
schemas live alongside the DB layer. Project-specific import paths and
directory layout are documented in that project's local rules.

See `typescript/file-organization.md` for the full layout, and
`typescript/boundary-parsing.md` for what must be parsed at a boundary.

## Forbidden patterns

- Hand-mirrored type definitions between two services with no shared contract
- Hand-writing a schema beside a boundary that already has an IDL and codegen
- "I'll add the contract later" — contract first means contract first
- Mutating the shape on one side without updating the contract alongside
- `as`-cast on a parsed boundary response (also covered by `boundary-parsing.md`)
- Inline `interface` declarations inside a hook that consumes a cross-runtime
  endpoint — pull the shape into a schema file
- A transport stub (`fetch`, socket, queue client) fed a hand-written body
  standing in for a response this repo produces — load the contract sample
- Shipping the consumer's test without the producer's, or the reverse
- Treating model approval as permission to implement an unapproved design
- Calling every temporary object literal a contract gate

## Vocabulary

Use **contract** for the shared definition, IDL or frozen sample alike. Earlier
code may have called them "goldens" or "fixtures"; rename during migration.
