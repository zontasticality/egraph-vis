# SPEC-LAYOUT: Graph Layout Precomputation & Caching

Defines the strategy for computing and caching ELK graph layouts to enable position interpolation without blocking the UI thread. This spec addresses the performance challenges of laying out large graphs (1,000-10,000 nodes) across many snapshots.

## 1. Objectives

- **Non-Blocking UI**: Avoid freezing the interface during layout computation
- **Smooth Interpolation**: Precompute positions for all snapshots to enable position tweening
- **Progressive Enhancement**: Show initial view quickly, compute remaining layouts in background
- **Memory Efficiency**: Store only positions, not full ELK graph structures

## 2. Problem Statement

### 2.1 Current System (Synchronous)

**Current Behavior**:
- When `currentState` changes, GraphPane recomputes ELK layout
- For 1,000 nodes, ELK takes ~500ms-1s
- For 10,000 nodes, ELK takes ~2s-5s
- UI freezes during computation
- No interpolation possible (positions not known in advance)

**Issues**:
- Poor UX during timeline navigation
- Cannot support smooth scrubbing
- Redundant computation (same snapshot laid out multiple times)

### 2.2 Proposed System (Progressive Precomputation)

**New Behavior**:
- After timeline is generated, compute layouts for all snapshots
- First layout synchronous (required for initial render)
- Remaining layouts computed progressively in background
- Results stored in snapshot objects: `state.layout`
- Components consume precomputed data

**Benefits**:
- UI remains responsive
- Positions known in advance for interpolation
- Layout computed once per snapshot

## 3. Layout Data Structure

### 3.1 Stored in Each Snapshot

Each `EGraphState` gets an optional `layout` field:

```
EGraphState: {
    // ... existing fields ...
    layout?: LayoutData
}

LayoutData: {
    nodes: Map<NodeId, NodePosition>,
    groups: Map<GroupId, GroupBounds>,
    edges: Set<EdgeId>
}

NodePosition: {
    x: number,
    y: number
}

GroupBounds: {
    x: number,
    y: number,
    width: number,
    height: number
}
```

### 3.2 Memory Calculation

For 10,000 nodes × 100 snapshots:

| Component | Per Node | Per Snapshot | Total |
|-----------|----------|--------------|-------|
| Node positions | 8 bytes (2 floats) | 80 KB | 8 MB |
| Group bounds | 16 bytes (4 floats) | ~1.6 KB (100 groups) | 160 KB |
| Edge set | Negligible | Negligible | <100 KB |
| **Total** | | **~82 KB** | **~8.3 MB** |

**Acceptable**: 8.3 MB is a small fraction of available memory.

## 4. Computation Strategy

### 4.1 Three-Phase Approach

**Phase 1: Synchronous First Layout**
- Block until first snapshot layout completes
- Required for initial render
- User sees loading indicator during this phase
- Typical time: 500ms-2s for large graphs

**Phase 2: Progressive Background Computation**
- Queue layout tasks for remaining snapshots
- Use `setTimeout(..., 0)` to avoid blocking UI thread
- Process snapshots in order (to leverage previous layout as hint)
- Update `state.layout` as each completes

**Phase 3: On-Demand Fallback**
- If user jumps to a snapshot whose layout isn't ready, prioritize it
- Show loading indicator or last-known layout while computing

### 4.2 Layout Manager Architecture

**Responsibilities**:
- Coordinate ELK instance (reuse single instance)
- Track computation state (pending, completed, failed)
- Cache results in snapshot objects
- Provide sync/async getters for components

**State Tracking**:
```
layouts: Map<SnapshotIndex, LayoutData>      // Completed layouts
pending: Map<SnapshotIndex, Promise>         // In-progress computations
computing: Set<SnapshotIndex>                // Currently computing
```

**Key Methods**:

| Method | Behavior | Use Case |
|--------|----------|----------|
| `precomputeAll(timeline)` | Start computing all layouts | Called after timeline generation |
| `getLayoutSync(index)` | Return cached layout or undefined | Optimistic rendering |
| `getLayout(index)` | Return cached or await promise | Jump to step (blocking) |
| `clear()` | Reset all caches | Preset change |

### 4.3 ELK Optimization: Layout Hints

ELK supports "hints" to stabilize node positions across similar graphs:

**Strategy**: Pass previous snapshot's layout as a hint to reduce jumping

**Benefits**:
- Nodes that don't change structure maintain similar positions
- Reduces jarring movements between snapshots
- Improves interpolation quality

**Implementation Note**: ELK's "interactive layout" feature can accept previous positions as constraints, but this requires careful configuration to avoid over-constraining.

## 5. Fallback Handling

### 5.1 Layout Readiness Scenarios

When rendering snapshot at position `p` with progress `t`:

| Current Layout | Next Layout | Behavior |
|----------------|-------------|----------|
| ✅ Ready | ✅ Ready | Interpolate positions normally |
| ✅ Ready | ❌ Not ready | Show current layout (no interpolation) |
| ❌ Not ready | ❌ Not ready | Show last known layout or loading indicator |

### 5.2 Graceful Degradation

**Strategy 1: Freeze at Last Known Layout**
- If user scrubs faster than layout computes, hold current view
- Better than flickering or empty screen

**Strategy 2: Loading Indicator**
- Show subtle spinner overlay on graph pane
- Indicate "Layout computing... N/M complete"
- Allow user to continue interacting (pan/zoom)

**Strategy 3: Prioritize Visible Snapshot**
- If user jumps to snapshot 50 before it's ready, compute it immediately
- Pause background computation temporarily
- Resume progressive computation after

**Recommendation**: Use Strategy 1 for scrubbing (no indicator, just freeze), Strategy 2 for explicit jumps (show progress).

## 6. Performance Characteristics

### 6.1 Computation Time

Typical ELK layout times by graph size:

| Nodes | E-Classes | Layout Time | Memory |
|-------|-----------|-------------|--------|
| 100 | 20 | 50ms | ~1 MB |
| 500 | 100 | 200ms | ~3 MB |
| 1,000 | 200 | 500ms-1s | ~5 MB |
| 5,000 | 1,000 | 2s-5s | ~15 MB |
| 10,000 | 2,000 | 5s-10s | ~30 MB |

**Scaling**: ELK's layered algorithm is roughly O(n log n) but degenerates with highly connected graphs.

### 6.2 Progressive Computation Timeline

Example: 100 snapshots of 1,000-node graphs

| Time | Event |
|------|-------|
| 0s | User clicks "Run Preset" |
| 0s-1s | Engine generates 100 snapshots (fast, structural sharing) |
| 1s | Visual states computed for all snapshots (~100ms) |
| 1s-2s | **First layout computed (blocks)** |
| 2s | **User sees initial graph** |
| 2s-90s | Background computation of remaining 99 layouts (~0.9s each) |
| 90s | All layouts complete |

**User Experience**:
- 2s wait for first view (acceptable)
- Immediate scrubbing available (with fallback)
- Full-fidelity scrubbing after ~90s (background, non-blocking)

### 6.3 Optimization: Batch Size

Instead of `setTimeout(..., 0)` for every snapshot, batch them:

**Strategy**: Process N snapshots per batch, yield to UI between batches

```
Batch 1: Compute layouts 1-10 (10s)
Yield to UI (100ms)
Batch 2: Compute layouts 11-20 (10s)
Yield to UI (100ms)
...
```

**Benefits**:
- Reduces scheduling overhead
- Still allows UI responsiveness
- Completes precomputation faster overall

**Tuning**: Batch size of 5-10 snapshots balances speed and responsiveness.

## 7. Layout Stability

### 7.1 Problem: Node Jumping

Without careful handling, nodes can "jump" between snapshots even when their structure doesn't change.

**Causes**:
- ELK's layout algorithm is deterministic but sensitive to graph topology
- Adding/removing edges changes the entire layout
- Different canonical orderings affect layering

### 7.2 Solutions

**Solution 1: Fixed Seed**
- Use deterministic seed for layout randomization
- Ensures reproducible layouts

**Solution 2: Incremental Layout**
- Pass previous layout as constraint to ELK
- Minimize changes between snapshots

**Solution 3: Position Hints**
- For nodes that exist in both snapshots, prefer similar positions
- Only recompute positions for new/deleted nodes

**Recommendation**: Implement Solution 2 (incremental layout) for best stability.

## 8. Integration with Timeline Store

### 8.1 Data Flow

**Timeline Generation**:
```
1. TimelineEngine.runUntilHalt()
2. Generates all EGraphState snapshots
3. Computes visual states (cheap)
4. LayoutManager.precomputeAll(timeline)
5. Returns timeline (first layout complete, rest in progress)
6. Timeline store updates
7. UI renders immediately
```

**Scrubbing**:
```
1. User drags slider to position 4.5
2. scrubData derived store updates:
   - currentState = timeline.states[4]
   - nextState = timeline.states[5]
   - progress = 0.5
3. GraphPane checks:
   - currentState.layout ✓
   - nextState.layout ✓
4. Interpolate positions and render
```

### 8.2 Store Reactivity

Components subscribe to `scrubData` derived store, which automatically updates when:
- Timeline position changes
- Layout becomes available (`state.layout` populated)

**Reactivity Pattern**:
```
$: scrubData = ...
$: updateGraphView($scrubData)

function updateGraphView(data) {
    if (!data.currentState?.layout) {
        showFallback();
        return;
    }
    renderWithLayout(data);
}
```

## 9. Testing Strategy (Minimal)

### 9.1 Essential Unit Tests

Test the layout manager's pure logic (not UI):
- Verify tracking of pending/completed layouts
- Test fallback behavior when layouts aren't ready

### 9.2 Performance Measurement (If Needed)

Only if performance issues arise:
- Measure time to first layout for various graph sizes
- Verify memory usage stays within budget

### 9.3 Manual Testing

- Scrub timeline and verify smoothness (does it feel good?)
- Check fallback behavior (what happens when layout isn't ready?)

**Skip**: UI automation, visual regression tests, exhaustive edge cases

## 10. Future Optimizations

### 10.1 Web Workers

Move ELK computation to a Web Worker:
- Completely non-blocking
- Parallel computation possible
- Complexity: Serializing ELK graph structures

### 10.2 Selective Recomputation

Only recompute layout for snapshots that have structural changes:
- Compare snapshot topology (nodes, edges)
- Reuse previous layout if identical
- Significant savings for snapshots with only metadata changes

### 10.3 Layout Caching Across Presets

For presets with similar structure, reuse layout computations:
- Hash graph topology
- Cache by hash, not snapshot index
- Useful for exploring variations of the same preset

## 11. Relationship to Other Specs

- **ANIMATION.md**: Layout precomputation is Phase 2 of the animation system
- **INTERPOLATION.md**: Precomputed positions enable position interpolation
- **UI.md**: GraphPane consumes the precomputed layout data
- **ARCHITECTURE.md**: Layout computation happens after timeline generation
