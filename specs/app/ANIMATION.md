# SPEC-ANIMATION: Timeline Scrubbing & Smooth Transitions

Defines the animation system that enables smooth timeline scrubbing with interpolated positions, colors, and visual states. This spec extends `ARCHITECTURE.md` and `UI.md` to support fractional timeline positions and precomputed rendering data.

## 1. Objectives

- **Smooth Scrubbing**: Enable users to drag the timeline slider and see smooth interpolation between discrete snapshots (e.g., scrubbing to position 4.5 shows a blend of step 4 and step 5).
- **Memory Efficiency**: Support large graphs (1,000-10,000 nodes) across 100+ snapshots without excessive memory usage (target: <50 MB total).
- **Responsive Performance**: Maintain 60fps scrubbing by precomputing expensive operations (layout, visual states) and caching interpolated results.
- **Visual Continuity**: Nodes smoothly transition colors, positions, and opacity when appearing/disappearing between snapshots.

## 2. System Overview

### 2.1 Architecture Layers

The animation system consists of four coordinated layers:

```
┌─────────────────────────────────────────────────────┐
│  1. VISUAL STATES (see VISUAL_STATES.md)           │
│     Classify each node/e-class into semantic        │
│     categories (Matched, New, NonCanonical, etc.)   │
│     Store lightweight enum indices in snapshots     │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  2. LAYOUT COMPUTATION (see LAYOUT.md)              │
│     Precompute ELK graph layouts for all snapshots  │
│     First layout synchronous, rest progressive      │
│     Cache positions in snapshot objects             │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  3. INTERPOLATION (see INTERPOLATION.md)            │
│     Compute blended states between snapshots        │
│     Cache by (styleClass, styleClass, progress)     │
│     Handle node appearance/disappearance with fade  │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  4. COMPONENT RENDERING                             │
│     Components consume precomputed data             │
│     Apply CSS color-mix for browser acceleration    │
│     Disable interactions during scrubbing           │
└─────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

**Before Animation (Current System)**:
```
Timeline Store: { index: 4 }  →  Components render snapshot[4]
```

**With Animation (New System)**:
```
Timeline Store: { position: 4.5 }
    ↓
Derive: currentIndex = 4, nextIndex = 5, progress = 0.5
    ↓
Fetch: snapshot[4].visualStates, snapshot[4].layout
       snapshot[5].visualStates, snapshot[5].layout
    ↓
Interpolate: positions, colors, opacity
    ↓
Components render blended state
```

## 3. Timeline Position Model

### 3.1 Float-Based Position

The core primitive changes from an integer `index` to a float `position`:

- **Position 4.0**: Exactly at snapshot 4
- **Position 4.5**: Halfway between snapshot 4 and 5
- **Position 4.75**: 75% of the way from snapshot 4 to snapshot 5

**Range**: `[0.0, states.length - 1]`

### 3.2 Derived Values

From the float position, we derive:
- **Current Index**: `floor(position)` — the snapshot to interpolate FROM
- **Next Index**: `floor(position) + 1` — the snapshot to interpolate TO
- **Progress**: `position % 1.0` — interpolation weight (0.0 to 1.0)
- **Is Scrubbing**: `progress > 0.01 && progress < 0.99` — whether we're between snapshots

### 3.3 Store Structure

The timeline store exposes a derived scrubbing interface:

**Primitive Store**:
```
timelinePosition: writable(0.0)
```

**Derived Store**:
```
scrubData: {
    currentIndex: number,
    nextIndex: number,
    progress: number,
    currentState: EGraphState,
    nextState: EGraphState | undefined,
    isScrubbing: boolean
}
```

**Backward Compatibility**:
The existing `currentIndex` store becomes a derived store:
```
currentIndex = floor(timelinePosition)
```

This ensures components not yet updated continue to work.

## 4. Controller Integration

### 4.1 Slider Configuration

The scrubbing slider operates on fractional values:

- **Input**: `<input type="range" min="0" max={states.length - 1} step="0.01" />`
- **Live Scrubbing**: Updates `timelinePosition` on every `input` event
- **Snapping**: On `change` event (slider release), snap to nearest integer if within 5% threshold

### 4.2 Interaction Modes

| User Action | Position Update | Transition Mode |
|-------------|-----------------|-----------------|
| Click Play | Increment by 1.0 per tick | Smooth CSS transitions |
| Click Step Forward/Back | Increment/decrement by 1.0 | Smooth CSS transitions |
| Drag Slider | Set to exact float value | Instant, interpolated rendering |
| Release Slider (near integer) | Snap to integer | Instant |
| Release Slider (mid-transition) | Keep float value | None (hold interpolated state) |
| Jump to Phase | Set to integer marker | Instant |

### 4.3 Disabled Interactions During Scrubbing

While `isScrubbing === true`:
- **Disabled**: Node selection, hover effects, edge highlighting
- **Enabled**: Pan, zoom, slider dragging
- **Reason**: Selection during interpolation is ambiguous and degrades performance

## 5. Precomputation Strategy

### 5.1 When Timeline is Generated

After the `TimelineEngine` generates all snapshots:

**Step 1: Compute Visual States** (cheap, ~1ms per snapshot)
- Iterate through each snapshot
- Classify every node and e-class into visual state enums
- Store lightweight `{ nodes: Map, eclasses: Map }` in `state.visualStates`

**Step 2: Compute First Layout** (expensive, ~1-3s for large graphs)
- Synchronously compute ELK layout for snapshot[0]
- Block until complete (required for initial render)
- Store result in `snapshot[0].layout`

**Step 3: Queue Remaining Layouts** (progressive)
- Dispatch async tasks for snapshots[1..N]
- Use previous layout as hint to ELK for stability
- Progressively populate `snapshot[i].layout` as they complete

### 5.2 Fallback Handling

**Q: What if the user scrubs to a snapshot whose layout isn't ready?**

**A: Three-tier fallback:**

1. **Best Case**: Both current and next layouts are ready → interpolate normally
2. **Partial Case**: Current ready, next not ready → show current layout (no interpolation)
3. **Worst Case**: Current not ready → show last known layout or loading indicator

**Implementation**: Components check `state.layout !== undefined` before rendering.

### 5.3 Memory Budget

Target constraints for 10,000 nodes × 100 snapshots:

| Component | Per Snapshot | Total |
|-----------|--------------|-------|
| Visual States | 170 KB | 17 MB |
| Layout Positions | 80 KB | 8 MB |
| Existing Snapshot Data | 100 KB | 10 MB |
| **Total** | **~350 KB** | **~35 MB** |

**Headroom**: Target stays under 50 MB to support browsers with 100+ MB available per tab.

## 6. Progressive Enhancement

The animation system is designed to work at multiple fidelity levels:

### 6.1 Minimum Viable

- No layout precomputation
- Scrubbing jumps between integer snapshots
- Existing functionality preserved

### 6.2 Layout Only

- Layouts precomputed
- Position interpolation enabled
- Colors still snap between states

### 6.3 Full Animation

- Layouts + visual states precomputed
- Position + color interpolation
- Opacity fade in/out for appearing/disappearing nodes

## 7. Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Scrubbing Frame Rate | 60 fps | Smooth slider drag experience |
| Initial Layout Time | <2s for 1000 nodes | Acceptable wait for initial render |
| Memory Overhead | <50 MB for 10k nodes | Fits comfortably in browser memory |
| Interpolation Cache Hit Rate | >95% | Most style transitions reuse cached results |
| UI Responsiveness During Precompute | No freezes | Use async tasks and setTimeout |

## 8. Relationship to Other Specs

- **ARCHITECTURE.md**: Defines the timeline and snapshot structure that this spec extends
- **UI.md**: Describes the visual components that consume the animation data
- **VISUAL_STATES.md**: Specifies how nodes/e-classes are classified semantically
- **LAYOUT.md**: Details the graph layout computation and caching strategy
- **INTERPOLATION.md**: Defines how blended states are computed efficiently

## 9. Migration Path

The animation system is designed for incremental adoption:

**Phase 1**: Add visual state enums and classification logic (no UI changes)
**Phase 2**: Add layout precomputation (improves initial render)
**Phase 3**: Add float-based timeline position (enables scrubbing)
**Phase 4**: Add interpolation logic (enables smooth animations)

Each phase delivers value independently and can be tested in isolation.
