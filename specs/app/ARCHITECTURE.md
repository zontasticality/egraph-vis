# SPEC-ARCHITECTURE: Application State & Timeline

Defines how the e-graph engine, controller, panes, and presets communicate. Emphasis is on precomputing immutable states for smooth playback.

## 1. Objectives
- Keep visualization responsive by decoupling heavy e-graph work from UI scrubbing.
- Guarantee deterministic, reproducible timelines per preset.
- Expose a single observable store (`timelineStore`) that panes subscribe to; no direct coupling to engine internals.

## 2. High-Level Flow
```
load preset
  ↓
validate preset + rewrites
  ↓
TimelineEngine.run(preset, implementation)
  ↓
array of EGraphState snapshots (structural-sharing via mutative)
  ↓
controller controls an index into the array
  ↓
panes render snapshot[index]
```

## 3. TimelineEngine
`TimelineEngine` orchestrates preset execution and state capture.

### API
```ts
interface TimelineEngine {
  runPreset(preset: PresetConfig, impl: 'naive' | 'deferred'): Timeline;
}

interface Timeline {
  presetId: string;
  impl: 'naive' | 'deferred';
  states: EGraphState[];           // immutable snapshots
  phaseMarkers: PhaseMarker[];     // indices for Read/Write/Rebuild boundaries
  violations: ViolationSummary[];  // aggregated invariant info per state
}
```
`phaseMarkers` and `violations` are derived by the TimelineEngine by scanning the `states` array (e.g., record indices where `state.phase` changes, summarize `state.metadata.invariants`). The e-graph engine does not need to supply them directly.

### Responsibilities
1. Initialize `EGraphRuntime` from preset expression(s).
2. Execute equality saturation loop (see `specs/egraph/OPERATIONS.md`).
3. After every top-level action (initializing root nodes, read phase, write phase, rebuild), call `emitSnapshot()` which:
   - Uses mutative `produce(previousState, draft => …)` to capture the runtime into an immutable structure.
   - Annotates `draft.metadata.phase`, `draft.metadata.timestamp`, etc.
4. Append snapshot to `states` and keep a reference for structural sharing.

### Performance Controls
- `preset.iterationCap`: stops the loop after N steps to avoid runaway rewrites.
- `timeline.maxStates`: if the generated timeline exceeds this cap, the engine still stores all states but the controller only exposes downsampled indices (e.g., show every `stride = ceil(states.length / maxStates)` step). Provide helper to request full-resolution playback for exports.

## 4. Controller & Playback Bar

### Controller State Machine
```
Idle ──▶ Playing ──▶ Paused
  ▲        │           │
  └────────┴───────────┘
```
- **Idle**: before presets load or when timeline is empty.
- **Playing**: auto-advances index at `playback.fps` (default 24 fps) until the final state.
- **Paused**: user stops playback or reaches the end.

### Actions
| Action | Availability | Effect |
| --- | --- | --- |
| `stepForward()` | index < last | `index++`, highlight diffs between states. |
| `stepBackward()` | index > 0 | `index--`. |
| `jumpToPhase(phaseMarker)` | always | Set index to marker, update metadata selection. |
| `scrub(position)` | timeline non-empty | Convert `position ∈ [0,1]` to nearest index (`round(position * (states.length-1))`). |
| `togglePlay()` | timeline non-empty | Switch between Playing and Paused. |
| `reset()` | timeline non-empty | index = 0, state = Paused. |
| `switchPreset(presetId)` | always | Re-run `TimelineEngine` with selected preset (async). |
| `switchImpl(naive|deferred)` | always | Re-run engine; maintain matching preset. |

Controller buttons enable/disable based on these rules. The playback bar shows two overlays: (1) scrub handle for current index, (2) phase markers as ticks.

## 5. Shared Stores

### `timelineStore`
Svelte readable store with shape:
```ts
interface TimelineStoreState {
  status: 'loading' | 'ready' | 'error';
  timeline?: Timeline;
  index: number;                 // current frame
  current?: EGraphState;
  transitionMode: 'smooth' | 'instant'; // controls animation behavior
  error?: string;
}
```
Updates happen by replacing the entire object (immutability). Components subscribe via `const { current } = $timelineStore;` and propagate down.

### `controllerStore`
Holds playback UI state (playing, fps, highlight preferences). Derived store merges with `timelineStore` to expose button disabled flags.

## 6. Snapshot Diffing
Because snapshots are persistent, panes can animate transitions by diffing `states[index]` and `states[index-1]`. The engine already writes compact `metadata.diffs`, but components may also compare node ids when necessary. Guidelines:
- Always guard `index === 0` (no previous state) → treat as fresh render.
- Prefer engine-provided diffs for expensive comparisons (hashcons, union-find) to avoid O(n²) work in the UI.

### 6.1 Data Structures
- **Chunked Node Registry**: `EGraphState` uses `nodeChunks: ENode[][]` (array of arrays) instead of a flat array for the node registry. This allows `mutative` to perform efficient structural sharing when appending new nodes, as only the last chunk needs to be cloned/updated.
- **Metadata**: `StepMetadata` includes `matches` (for Read phase highlighting) and `diffs` (for Write phase highlighting).

## 7. Lazy vs Precomputed Modes
- **Precomputed (default)**: `TimelineEngine` runs immediately after preset selection, populates `states`, then emits `status=ready`. Controller interaction never re-runs the engine; extremely fast scrubbing.
- **Live/authoring**: Optional development mode where each controller action triggers the engine to compute the next step on demand. Even in this mode the newly produced state must be appended to `states` so future scrubbing remains consistent.

Mode is configured via `appConfig.mode` and affects UI affordances (e.g., show spinner during live computation). Document this for contributors so they know which pathway is active.

## 8. Selection & Highlight Propagation
Selections originate from:
- Controller requests (e.g., highlight e-class touched by the last merge).
- Direct user interaction inside panes (clicking a node/hyperedge).

Selections are stored in a separate `interactionStore` (see below) to decouple ephemeral UI state from the immutable timeline. This allows:
- **Synchronous Hovering**: Hovering a node in the graph instantly highlights the corresponding entry in the State Pane without triggering a timeline update.
- **Persistent Selection**: Selection survives timeline scrubbing (if the ID exists in the new state).

### `interactionStore`
Svelte writable store for ephemeral UI state:
```ts
interface InteractionState {
  selection: { type: 'enode' | 'eclass' | 'hashcons'; id: number | string } | null;
  hover: { type: 'enode' | 'eclass' | 'hashcons'; id: number | string } | null;
}
```
- **Selection**: Persists until user clicks away or selects something else.
- **Hover**: Cleared on `mouseleave`.
- **Components**: Subscribe to this store to apply "active" or "highlighted" styles.

## 9. Error & Loading UX
- When `TimelineEngine` throws (preset invalid, rewrite divergence), set `status='error'` with user-facing copy plus debug info for developers (stack trace behind disclosure).
- Controller buttons should disable and display tooltips while loading.
- If presets are large, show progress after each emitted state (percentage = `states.length / expectedStates`).

## 10. File Placement
- Engine lives in `src/lib/engine/`.
- Timeline + controller stores in `src/lib/stores/`.
- Preset definitions reside in `static/presets/*.json` (see `specs/egraph/PRESETS.md`).
- Shared TypeScript interfaces go in `src/lib/types.ts` and are imported across specs to prevent drift.
