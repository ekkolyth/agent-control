# Go Testing

Standard library `testing` + `go test` across every Go module. Keep tests
alongside their subjects; keep the surface small enough that a stranger to
the repo can run everything with `go test ./...`.

## Test colocation

`<name>_test.go` lives alongside `<name>.go` in the same package. Integration
tests that span multiple files or need cross-package fixtures go in a
`tests/` subdirectory next to the package. Table-driven tests are the
default for anything with a handful of cases.

## Running tests

- Module-wide: `go test ./...` from the module root.
- Single package: `cd <path> && go test .`
- Verbose + one function: `go test -run TestNameSubstring -v ./...`

Any module-specific runner (e.g. a project-local `make test` or workspace
script) belongs in that project's own local rules, not here.

## Mocking `*testing.T` for helper tests

Helpers that call `t.Fatalf` will trigger `runtime.Goexit` and kill the
caller goroutine. To unit-test such a helper without killing the test, run
the call inside a separate goroutine and check `mock.Failed()` after it
exits:

```go
func TestFatalHelper(t *testing.T) {
    mock := &testing.T{}
    done := make(chan struct{})
    go func() {
        defer close(done)
        HelperThatMayFatal(mock, badInput)
    }()
    <-done
    if !mock.Failed() {
        t.Fatal("expected fatal")
    }
}
```

Use the simpler defer pattern only for helpers that use `t.Errorf` (no
Goexit).

## Where project-specific test infrastructure lives

Anything project-specific — a shared internal helper module consumed via a
local `replace` directive, containerized backing services, JWT signer
helpers, contract loaders, per-service Makefiles, `TEST_DATABASE_URL` and
similar env — belongs in that project's own local rules (e.g.
`.agents/rules/local/`), not in this cross-project rule.
