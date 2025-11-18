# SPEC-ENGINE: Persistent E-Graph Implementation

This document defines the equality-saturation engine that powers the visualization. It separates the **runtime structures** (internally mutable while building a step) from the **persistent snapshots** emitted after every step. The engine is derived from the [egg paper](https://arxiv.org/abs/2004.03082) but is adapted for timeline playback and Svelte-friendly state sharing.

## 1. Goals

1. Provide two interchangeable implementations (Naive + Deferred rebuild) with identical semantics.
2. Emit an immutable `EGraphState` after every meaningful action (Read, Write, Rebuild, Controller command) using [mutative](https://github.com/unadlib/mutative) or a similar structural-sharing library.
3. Capture instrumentation metadata (diffs, violations, phase markers) so the UI can animate without recomputing.
4. Remain deterministic: same preset input must always produce identical state timelines.

## 2. Runtime vs Snapshot Structures

| Concept | Mutability | Purpose |
| --- | --- | --- |
| `EGraphRuntime` | Mutable during a step only | Holds Maps/Sets/Union-Find objects for fast operations. Not exposed outside the engine.
| `EGraphState` | Immutable, JSON-serializable | Produced via `produce(prevState, draft => …)` at the end of each step. Stored in the timeline and consumed by the UI.

### 2.1 Runtime Composition
- `unionFind: UnionFind<ENodeId>` – can leverage the `union-find` npm package internally.
- `eclasses: Map<ENodeId, EClassRuntime>` – includes mutable arrays/Maps for parents.
- `hashcons: Map<string, ENodeId>` – canonical key → canonical id.
- `worklist: Set<ENodeId>` – deferred implementation only.
- `nextId: number` – monotonic counter for e-node ids.

Runtime structures may use Maps/Sets for efficiency; they must never leak to the snapshot untouched. Derived data (hashcons list, union-find table, etc.) is flattened when generating `EGraphState`.

### 2.2 Snapshot Schema (TypeScript)
```ts
interface EGraphState {
  id: string;              // `"presetId:stepIndex"`
  stepIndex: number;
  phase: 'idle' | 'read' | 'write' | 'rebuild';
  impl: 'naive' | 'deferred';
  unionFind: Array<{ id: number; canonical: number; isCanonical: boolean }>;
  eclasses: Array<EClassViewModel>;
  hashcons: Array<{ key: string; canonical: number; isWorklist?: boolean }>;
  worklist: number[];      // canonical ids flagged for repair
  graph: {
    nodes: GraphNodeVM[];
    edges: GraphEdgeVM[];
  };
  metadata: StepMetadata;
}
```
`EClassViewModel`, `GraphNodeVM`, `GraphEdgeVM`, and `StepMetadata` are fully described in `SPEC-UI.md`; the engine simply populates them.

Snapshots are required to avoid native `Map`/`Set` because Svelte runes cannot track mutations to their internals. Instead, convert to arrays sorted by deterministic keys (canonical id, lexical order, etc.).

## 3. Core Types & Helper Functions

- `type ENodeId = number` – canonical if `find(id) === id`.
- `interface ENode { op: string; args: ENodeId[]; }`
- `interface ParentInfo { parentId: ENodeId; enode: ENode; }`
- `interface EClassRuntime { id: ENodeId; nodes: ENode[]; parents: Map<string, ParentInfo>; data?: unknown; }`

Helper utilities (shared by both implementations):
- `canonicalize(node, runtime): ENode` – clones node with canonical child ids.
- `canonicalKey(node): string` – stringifies op + canonical args, used for hashcons + parent maps.
- `recordDiff(metadata, event)` – accumulates merge/add events for UI animations.

## 4. Operations

### 4.1 `find(id)`
Delegates to union-find. Throws descriptive error if the id is unknown (before `makeSet`).

### 4.2 `addEnode(enode)`
1. Canonicalize `enode`.
2. Lookup canonical key in hashcons.
3. If found → return canonical id.
4. Else → allocate `nextId`, `makeSet(newId)`, create singleton e-class, insert into maps, update parent pointers.
5. Record `metadata.addedNodes` for visualization.

### 4.3 `merge(id1, id2)`
- Shortcut if `find(id1) === find(id2)`.
- Merge via union-find; return canonical id.
- Combine node lists, parents, and optional data into the canonical e-class.
- Record `metadata.merges` including losers → winner mapping.

### 4.4 `rebuild()`
- **Naive**: invoked implicitly after every `add`/`merge`. Implementation enforces invariants immediately via parent grouping.
- **Deferred**: uses `worklist` to delay congruence repairs until `rebuild()` is called. Processing loop:
  1. Drain worklist into queue.
  2. For each id, call `repair(id)`.
  3. Any merges triggered by `repair` must enqueue their canonical ids for the next pass until the queue is empty.

### 4.5 `repair(eclassId)`
- Gather parent entries referencing the e-class.
- Canonicalize each parent, bucket by canonical key.
- For buckets with size > 1, merge their parent ids.
- Update hashcons entries for parents, replacing outdated mappings.

## 5. Implementation Variants

### Naive
- `merge` performs immediate upward merging.
- `rebuild` is a no-op that still pushes a snapshot (phase `rebuild`) so the timeline remains consistent with the deferred implementation.

### Deferred
- `merge` appends canonical id to `worklist` (Set for dedup).
- `rebuild` is an explicit phase invoked after each write pass. Controller actions described in `SPEC-ARCHITECTURE.md` decide when to call it.
- Expose `get invariantsValid(): boolean` for UI diagnostics, derived from `worklist.size === 0`.

## 6. Pattern Matching & Rewrites

### Pattern Definitions
- Patterns are trees of `{ op: string | PatternVar; args: Pattern[] }` where `PatternVar` is `?identifier`.
- Rewrites: `{ name: string; lhs: Pattern; rhs: Pattern; enabled: boolean }`.

### Matching
- `matchPattern(pattern, eclassId, runtime)` searches every node in the e-class.
- Substitutions map variables → canonical ids. Duplicate variable references must match the same canonical id.

### Equality Saturation Loop
```
repeat until halted {
  matches = collectMatches(rewrites, runtime)
  if matches.empty() break
  applyMatches(matches, runtime)  // merges + adds
  if impl === 'deferred' rebuild()
  emitSnapshot()
  abort if stepIndex >= preset.iterationCap
}
```
- `collectMatches` is read phase; `applyMatches` is write phase.
- Phases must be annotated in `metadata.phaseMarkers` for the controller.
- The loop runs synchronously when a preset loads to generate the full timeline.

## 7. Instrumentation & Metadata

Each snapshot includes:
- `metadata.phaseMarker: number` – index of read/write/rebuild boundary.
- `metadata.diffs`: lists of `{ type: 'add' | 'merge'; ids: number[]; canonical: number }` for driving animations.
- `metadata.invariantViolations`: optional details when debug mode performs explicit checks.
- `metadata.selection`: highlight hints (e.g., e-class touched during controller command).

`recordDiff` must avoid copying large structures: store compact references (ids, op strings) only.

## 8. Invariants & Validation

### Congruence
As defined in egg. Provide `checkCongruence()` returning an array of violation descriptors (operator, arg ids, conflicting classes). Only executed when debugging is enabled or when the controller requests invariant inspection.

### Hashcons
Every canonical node must exist in the table. Provide `checkHashcons()` returning boolean + optional mismatched entries for the State pane.

### Uniqueness
Enforced by `addEnode` via hashcons lookups.

Validation routines must operate on runtime structures but emit serializable summaries for display.

## 9. Error Handling
- Throw `UnknownENodeIdError` when accessing ids not present in union-find.
- Guard against using stale canonical ids after merges by always calling `find()` before returning identifiers to callers.
- When presets or rewrites are invalid, raise descriptive `PresetValidationError` before running the saturation loop.

## 10. Performance Considerations
- Limit maximum number of states via `preset.iterationCap` (default 250) to control memory usage.
- If the number of states exceeds `timeline.maxStates`, downsample by storing every Nth state plus metadata needed to interpolate (see `SPEC-ARCHITECTURE.md`).
- Structural sharing from mutative keeps memory reasonable, but large hashcons tables can still dominate; release references to discarded runtime Maps once the timeline is built.

This spec purposely focuses on the algorithmic core. The contracts between the engine, timeline, and panes are detailed in `SPEC-ARCHITECTURE.md` and `SPEC-UI.md`.
