# DATA_MODEL

Defines every type used by the e-graph engine, split between internal runtime structures and exported immutable snapshots.

## 1. Identifiers & Terminology
- `ENodeId (number)`: unique identifier for every node inserted. Canonical if `find(id) === id`.
- `EClassId`: synonymous with canonical `ENodeId`. We intentionally avoid separate numbering to mirror egg.
- `PresetId`: string referencing the preset that produced a timeline.

## 2. Runtime Structures (Mutable)
Used only inside the engine while computing a step. Implementations may choose any backing types but must expose equivalent semantics.

| Structure | Purpose | Notes |
| --- | --- | --- |
| `UnionFind<ENodeId>` | Track equivalence classes. | Must support path compression + union by rank. |
| `Map<ENodeId, EClassRuntime>` | Canonical id → mutable class contents. | Only canonical ids appear as keys. |
| `Map<string, ENodeId>` (hashcons) | Deduplicate canonicalized e-nodes. | Keys derived from `canonicalKey(enode)`. |
| `Set<ENodeId>` (worklist) | Deferred repair queue. | Empty in naive implementation. |
| `nextId: number` | Allocates new e-node ids. | Monotonic counter; start at 0. |

### 2.1 `EClassRuntime`
```ts
interface EClassRuntime {
  id: ENodeId;                     // canonical id
  nodes: ENode[];                  // raw nodes in the class
  parents: Map<string, ParentInfo>;// key = `${parentId}:${canonicalKey(parent)}`
  data?: Record<string, unknown>;  // optional analysis payload
}

interface ENode {
  op: string;          // e.g., '+', '*', 'c1'
  args: ENodeId[];     // references to child ids (not canonicalized yet)
}

interface ParentInfo {
  parentId: ENodeId;   // canonical id of parent class
  enode: ENode;        // parent node structure before canonicalization
}
```

## 3. Snapshot Structures (Immutable)
All exported data must be serializable without Maps/Sets.

```ts
interface EGraphState {
  id: string;                      // `${presetId}:${stepIndex}`
  presetId: string;
  stepIndex: number;
  phase: 'init' | 'read' | 'write' | 'rebuild' | 'done';
  implementation: 'naive' | 'deferred';
  unionFind: Array<{ id: number; canonical: number; isCanonical: boolean }>;
  eclasses: EClassViewModel[];
  hashcons: Array<{ key: string; canonical: number }>;
  worklist: number[];
  metadata: StepMetadata;
}
```

Derived view models:
```ts
interface EClassViewModel {
  id: number;
  nodes: Array<{ op: string; args: number[] }>;
  parents: Array<{ parentId: number; op: string }>;
  inWorklist: boolean;
}

interface StepMetadata {
  diffs: DiffEvent[];              // merges/additions
  invariants: {
    congruenceValid: boolean;
    hashconsValid: boolean;
  };
  selectionHints: Array<{ type: 'eclass' | 'enode' | 'hashcons'; id: number | string }>;
}
```

Snapshots are produced via structural sharing using mutative’s `produce`. Engine authors must ensure that arrays/objects that do not change reuse references from prior states so scrubbing can compare by reference.

## 4. Timeline Container
The engine exposes precomputed histories via `EGraphTimeline`:
```ts
interface EGraphTimeline {
  presetId: string;
  implementation: 'naive' | 'deferred';
  states: EGraphState[];
  haltedReason: 'saturated' | 'iteration-cap' | 'canceled';
}
```
`states` must be in chronological order. `haltedReason` communicates why the loop stopped so controllers can surface the status.

## 5. Graph Topology Payload
UI consumers expect derived graph data. Engine must include in `metadata` or a dedicated field:
```ts
interface GraphPayload {
  nodes: Array<{ id: number; label: string; degree: number; }>; // e-classes
  edges: Array<{ id: string; source: number; target: number; argIndex: number }>;
}
```
Graph payload is recomputed from runtime parents/children during snapshot emission; never leak internal Maps.

## 6. Deterministic Ordering Rules
- Sort `unionFind`, `eclasses`, and `hashcons` arrays by canonical id / lexical key before emitting.
- Within an `EClassViewModel`, sort nodes alphabetically by `op` then lexicographically by args.
- Worklist array sorted ascending.

These rules guarantee that snapshot equality reflects semantic equality, simplifying contract tests.
