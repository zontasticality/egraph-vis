# SPEC-TESTING: Validation Strategy

Ensures the engine, timeline, and UI stay in sync as the project evolves.

## 1. Test Layers

| Layer | Purpose | Tooling |
| --- | --- | --- |
| Unit | Verify individual modules (union-find wrapper, canonicalization, worklist). | Vitest |
| Contract | Compare naive vs deferred outputs for identical presets, including emitted timelines. | Vitest + snapshot fixtures |
| Visualization | Render panes against recorded timelines to ensure highlights/animations align. | Vitest DOM + Playwright (optional) |
| Preset validation | Ensure preset JSON follows schema and produces bounded timelines. | Zod schema + Vitest |

## 2. Fixtures
- `test/fixtures/presets/*.json`: snapshot copies of shipping presets for regression tests.
- `test/fixtures/timelines/{presetId}-{impl}.json`: serialized arrays of `EGraphState` for golden tests. Generated via `pnpm test:update-fixtures` script.
- Graphical screenshot tests (Playwright) store expected PNGs under `test/screenshots/`.

## 3. Required Tests
1. **Engine Equivalence**: For every fixture preset, run both naive and deferred engines; assert final canonical classes, node counts, and timeline lengths match.
2. **Invariant Checks**: When debug mode enables `checkCongruence` / `checkHashcons`, unit tests inject known-violating graphs and expect descriptive violation outputs.
3. **Timeline Integrity**:
   - Snapshots must have strictly increasing `stepIndex`.
   - `metadata.diffs` must only reference ids present in the same snapshot.
   - Structural sharing sanity: verifying `states[i] !== states[i-1]` but `states[i].graph.nodes[j] === states[i-1].graph.nodes[j]` whenever unchanged.
4. **Controller Logic**: Simulate playback store operations to ensure actions respect boundaries and that scrubbing yields deterministic indices.
5. **Preset Schema**: Validate every preset JSON using the schema from `specs/egraph/PRESETS.md`; unit tests fail if schema changes without fixture updates.
6. **UI Rendering**: Using Vitest DOM, render each pane with fixture snapshots to ensure empty/populated states match the spec (e.g., Worklist view shows “invariants restored” when empty).

## 4. Tooling & Commands
- `pnpm test` – runs unit + contract tests.
- `pnpm test:fixtures` – regenerates timeline snapshots (writes to fixtures; requires developer approval).
- `pnpm test:ui` – launches Playwright visual regression (optional).

## 5. CI Expectations
- CI must run unit + contract suites on every push.
- Fixture updates need reviewer approval and must include textual summary in PR description.
- Large preset additions should include at least one new contract test to keep coverage broad.

## 6. Debug Utilities
Expose `pnpm debug:timeline --preset <id> --impl deferred` that prints step-by-step metadata to aid regressions. This command should reuse the same code paths as the app to prevent drift.

Keeping these requirements synchronized with `specs/egraph/` and `./ARCHITECTURE.md` ensures contributors know when they’re breaking guarantees.
