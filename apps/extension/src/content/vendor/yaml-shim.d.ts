// The vendored isomorphic/ariaSnapshot.ts imports "yaml" only for types on
// its aria-snapshot *parser*, which this project never calls (snapshot.ts
// only generates trees, never parses YAML back) and which is tree-shaken
// out of the extension bundle. A shorthand `declare module "yaml";` types
// the whole module as `any`, which resolves a plain value import but not
// `import type * as yamlTypes from 'yaml'` followed by `yamlTypes.<Member>`
// used as a *type* (`yamlTypes.ParseOptions`, `yamlTypes.Scalar<string>`,
// …) — that needs a real per-member type, which `any` doesn't provide.
// These are loose stand-ins sized only to satisfy that lookup, not a model
// of the real "yaml" package API — don't collapse this back to the
// shorthand form or grow it into a fake implementation.
declare module 'yaml' {
  export type Range = [number, number, number?]

  export class YAMLError {
    message: string
    pos: [number, number]
  }

  export class Scalar<T = unknown> {
    value: T
    range: Range
  }

  export class YAMLSeq {
    items: unknown[]
    range: Range
  }

  export class YAMLMap {
    items: Array<{ key: unknown; value: unknown }>
    range: Range
  }

  export class LineCounter {
    linePos(offset: number): { line: number; col: number }
  }

  export type ParseOptions = {
    keepSourceTokens?: boolean
    lineCounter?: LineCounter
    prettyErrors?: boolean
  }

  export function parseDocument(
    text: string,
    options?: ParseOptions,
  ): {
    errors: YAMLError[]
    contents: YAMLSeq | YAMLMap | Scalar<unknown> | null
  }
}
