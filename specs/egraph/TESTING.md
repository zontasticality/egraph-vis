# TESTING (Engine-Specific)

Outlines how to validate the e-graph implementation without referencing UI/timeline code.

## 1. Unit Tests
- **Union-Find Wrapper**: path compression, union-by-rank, error cases for unknown ids.
- **Canonicalization**: ensure `canonicalize` + `canonicalKey` produce stable strings regardless of insertion order.
- **Hashcons**: verify deduping works and collisions are resolvable via canonicalization.
- **Worklist**: deferred rebuild should leave invariants valid after `rebuild()`; naive implementation should never populate the worklist.

## 2. Contract Tests
- Run both naive and deferred engines against every preset fixture and compare:
  - Final e-class partition (sorted list of canonical classes).
  - Snapshot count.
  - Metadata diffs (ignoring reorderable fields like timestamps).
- Ensure deterministic snapshot ids by seeding presets with fixed ordering.

## 3. Rewrite Correctness
For each preset:
1. Enumerate rewrites and expected matches on the initial graph.
2. Assert applying the rewrite produces the expected new node ids and merges.
3. Validate RHS variable usage: tests should fail if RHS references a variable missing on LHS.

## 4. Invariant Checks
Enable `debugInvariants` flag to run `checkCongruence` + `checkHashcons` on each snapshot:
- Provide targeted fixtures where invariants intentionally fail to ensure reporting works.
- Ensure these checks can be disabled for performance-critical runs.

## 5. CLI Utilities
Implement developer commands:
- `pnpm engine:test` – runs unit + contract suites under `src/lib/engine/__tests__`.
- `pnpm engine:trace <preset>` – prints per-step metadata for quick inspection.

## 6. Golden Files
Store serialized timelines under `test/fixtures/timelines/`. Format: pretty-printed JSON with `presetId`, `implementation`, `states` (may be truncated). Regenerate via `pnpm test:update-fixtures` and require reviewer sign-off for diffs.
