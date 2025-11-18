# OPERATIONS

Details the behavior of the core e-graph algorithms and how the two implementations differ.

## 1. Canonicalization Helpers
- `find(id: ENodeId): ENodeId` – always run through union-find; throw `UnknownENodeIdError` if `id` ≥ `nextId` or not initialized.
- `canonicalize(enode)` – replace each child with `find(child)` and return a fresh object.
- `canonicalKey(enode)` – `${enode.op}(${enode.args.join(',')})` using canonical args; used for hashcons & parent maps.

## 2. Core Operations

### 2.1 `addEnode(enode: ENode): ENodeId`
1. Canonicalize `enode`.
2. Lookup key in `hashcons`; if present, return existing id.
3. Otherwise allocate `id = nextId++`, `makeSet(id)`, and create singleton `EClassRuntime`.
4. Insert canonical node into new class, update `hashcons[key] = id`.
5. For each child canonical id, insert parent pointer into child e-class.
6. Record diff: `{ type: 'add', nodeId: id, enode }`.

### 2.2 `merge(a: ENodeId, b: ENodeId): ENodeId`
1. Canonicalize both inputs via `find`.
2. If they match, return id (no diff).
3. Otherwise union via union-find → `winner` (deterministically choose, e.g., smaller id wins).
4. Merge `nodes` arrays, deduplicate parents (by key), merge optional `data`.
5. Update `hashcons` entries for nodes moved into the winner.
6. Record diff: `{ type: 'merge', winner, losers: [loser] }`.

### 2.3 `rebuild()`
Restores congruence and hashcons invariants in deferred mode; no-op (but still emits snapshot) in naive mode.

- Drain `worklist` into queue.
- While queue not empty:
  - For each parent bucket (grouped by canonical key) with >1 entry → merge their parent classes (which enqueues new ids for next pass).
  - Update `hashcons` entry to point at the canonical parent id.
- Stop when no merges are generated.

### 2.4 `repair(eclassId)`
Convenience used by rebuild: gather parent info referencing `eclassId`, canonicalize each parent, group, merge duplicates.

## 3. Implementation Variants

### Naive
- After every `add` or `merge`, immediately perform `repair` on affected ids. Worklist stays empty.
- `rebuild()` simply emits a snapshot with phase `rebuild` so parity with deferred exists.

### Deferred
- `merge` pushes canonical id into `worklist` Set.
- `rebuild()` processes worklist as described above until empty.
- Export `invariantsValid = worklist.size === 0`.

Both implementations must produce the same observable `EGraphTimeline` when given identical presets.

## 4. Snapshot Emission
`emitSnapshot(phase)` occurs:
1. Right after preset initialization (phase `init`).
2. After each read phase (pattern collection).
3. After each write phase (added nodes + merges).
4. After each rebuild phase (deferred only; naive emits a placeholder).
5. When saturation halts (`phase = 'done'`).

Pseudo:
```ts
function emitSnapshot(phase) {
  currentState = produce(currentState, draft => {
    draft.stepIndex++;
    draft.phase = phase;
    draft.unionFind = toUnionFindArray(runtime.unionFind);
    draft.eclasses = toEClassVMs(runtime.eclasses, runtime.worklist);
    draft.hashcons = toHashconsArray(runtime.hashcons);
    draft.worklist = [...runtime.worklist].sort();
    draft.metadata = buildMetadata();
  });
  timeline.states.push(currentState);
}
```

## 5. Instrumentation Hooks
- `recordDiff(type, payload)` – append to `metadata.diffs`. Consumers rely on these to animate.
- `onMerge?(event)` / `onAdd?(event)` – optional callbacks for devtools or logging; MUST NOT mutate runtime.
- Debug invariant checks may run after rebuild; results stored in `metadata.invariants`.

## 6. Halt Conditions
The equality-saturation loop stops when:
1. No rewrites apply during the read phase.
2. `iterationCap` reached.
3. Controller or caller cancels execution (engine should throw `ExecutionCanceledError`).

On halt, emit a final snapshot with `phase='done'`, `metadata.diffs=[]`, and `worklist=[]` (naive) or actual queue (deferred).
