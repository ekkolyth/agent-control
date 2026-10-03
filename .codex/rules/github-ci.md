# GitHub CI

Load the `github-ci` skill before editing a workflow file, a Dockerfile, or a
shared deploy action — it carries the cache requirements, the build-context
narrowing procedure, the path-filter rule, and how to verify with run timings.

A CI job that takes ten minutes to do thirty seconds of real work is a defect,
not a fact of life. Both causes regress silently, so a change here is verified
by reading the run, never by intent.
