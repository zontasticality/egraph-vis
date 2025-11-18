# E-Graph Spec Suite

This folder isolates every requirement that only concerns the equality-saturation engine, independent from UI/architecture choices. Treat it as a language/runtime contract the rest of the app consumes.

## 1. Scope & Goals
- Define the canonical e-graph data model, rewrite semantics, and equality-saturation loop.
- Keep all engine surfaces immutable at the boundary: callers only see persistent snapshots.
- Support two engine implementations (naive + deferred rebuild) behind the same API.
- Document a reproducible testing methodology that can be run without the Svelte app.

Anything unrelated to those goals (pane layout, timeline stores, etc.) lives outside `specs/egraph`.

## 2. Design Constraints
1. **Immutability at the API boundary** – Every call returning an `EGraphState` must provide an object safe to reuse and compare by reference. Internals may mutate while building a step, but nothing mutable escapes.
2. **Determinism** – Same preset, rewrite ordering, and implementation flag must yield identical state timelines. Hashing, id allocation, and iteration limits must therefore be deterministic.
3. **Stable identifiers** – `ENodeId`s increment monotonically; canonical ids may change after merges but are always discoverable through `find()`.
4. **Implementation parity** – Naive and deferred modes must be feature-complete and produce the same observable results (states, diffs, invariant reports).
5. **Preset-driven** – Inputs (initial expression, rewrites) arrive via a schema defined in `PRESETS.md`; no implicit global rewrites.
6. **Mutative snapshots** – Snapshot emission must use [mutative](https://github.com/unadlib/mutative) (Immer-compatible) `produce` calls so exported objects remain plain JS arrays/maps with structural sharing.

## 3. Public API Surface
```ts
interface EGraphEngine {
  loadPreset(preset: PresetConfig, options: EngineOptions): void;
  runUntilHalt(): EGraphTimeline;    // precompute full history
  step(): EGraphState | null;        // live/authoring mode
  getTimeline(): EGraphTimeline;     // last computed timeline
}

interface EngineOptions {
  implementation: 'naive' | 'deferred';
  iterationCap?: number;
  recordDiffs?: boolean;
  debugInvariants?: boolean;
}
```
- `PresetConfig` (see `PRESETS.md`) encodes the initial expression, rewrite list, and preset-specific hints/limits. `loadPreset` must validate it eagerly and reset internal runtime state.
- `EGraphState` (see `DATA_MODEL.md`) is the immutable snapshot emitted after each phase. It contains flattened union-find/e-class/hashcons data plus metadata diffs and invariant flags.
- `EGraphTimeline` (see `DATA_MODEL.md`) is a deterministic sequence of `EGraphState`s along with preset/implementation identifiers. `runUntilHalt` builds a new one; `getTimeline` returns the last computed timeline without mutation.
- `step()` advances the engine by exactly one phase (read, write, or rebuild depending on implementation). It returns the new `EGraphState`, or `null` once saturation halts.
- `getTimeline()` must never mutate or clone partial data; consumers rely on structural sharing between states for fast scrubbing.
- Engines must throw descriptive errors (`PresetValidationError`, `IterationCapExceededError`, etc.) rather than returning partial data.

## 4. Document Map
| File | Purpose |
| --- | --- |
| [DATA_MODEL.md](./DATA_MODEL.md) | Core types, runtime vs snapshot layout, identifier rules.
| [OPERATIONS.md](./OPERATIONS.md) | `find/add/merge/rebuild`, naive vs deferred behavior, instrumentation hooks.
| [LANGUAGE.md](./LANGUAGE.md) | Supported expression language, literal/variable policy, serialization format.
| [REWRITES.md](./REWRITES.md) | Pattern syntax, rewrite rule spec, equality-saturation loop, halt conditions.
| [PRESETS.md](./PRESETS.md) | JSON schema for presets, versioning, validation requirements.
| [TESTING.md](./TESTING.md) | Engine-level unit/contract tests independent of the UI.

Use `MAIN.md` purely as an orientation layer; edits to core behavior belong in the specialized documents.
