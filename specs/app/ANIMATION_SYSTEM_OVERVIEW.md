# Animation System Overview

This document provides a high-level introduction to the animation system specifications. Read this first to understand the overall design before diving into the detailed specs.

## What is the Animation System?

The animation system enables smooth timeline scrubbing with interpolated positions, colors, and visual states. Users can drag the timeline slider to any fractional position (e.g., 4.5) and see a smooth blend between discrete snapshots.

## Goals

1. **Smooth Scrubbing**: 60fps interpolation during timeline slider dragging
2. **Large Graph Support**: Handle 1,000-10,000 nodes across 100+ snapshots
3. **Memory Efficiency**: Stay under 50 MB overhead for large graphs
4. **Non-Blocking UI**: Progressive background computation, no freezes
5. **Backward Compatible**: Existing discrete step navigation continues to work

## Key Concepts

### Float-Based Timeline Position

**Before**: Integer index (0, 1, 2, 3, ...)
**After**: Float position (0.0, 0.5, 1.0, 1.5, ...)

Position 4.5 means "halfway between snapshot 4 and snapshot 5"

### Precomputed Rendering Data

Instead of computing visual appearance on-the-fly during scrubbing, we precompute:
- **Visual States**: Classify each node/e-class into semantic categories (enums)
- **Layout Positions**: Run ELK layout for all snapshots in advance
- **Style Definitions**: Define colors/borders once, reuse for all nodes

### Intelligent Caching

**Problem**: Interpolating 10,000 nodes = too slow
**Solution**: Cache by style transition, not by node
- Only ~500 unique transitions (5 classes × 5 classes × 20 progress steps)
- Nodes with same transition reuse cached result
- 95%+ cache hit rate

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│ 1. VISUAL STATES (VISUAL_STATES.md)                    │
│    Classify nodes: Default, Matched, New, etc.         │
│    Store: 1 byte enum per node                         │
│    Memory: ~17 MB for 10k nodes × 100 snapshots        │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 2. LAYOUT COMPUTATION (LAYOUT.md)                      │
│    Precompute ELK layouts progressively                │
│    Store: 8 bytes (x,y floats) per node                │
│    Memory: ~8 MB for 10k nodes × 100 snapshots         │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 3. INTERPOLATION (INTERPOLATION.md)                    │
│    Blend colors, positions, opacity                    │
│    Cache: ~500 entries (~24 KB)                        │
│    Performance: 60fps for 10k nodes                    │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 4. COMPONENT RENDERING                                  │
│    Apply precomputed data with CSS color-mix           │
│    Disable interactions during scrubbing               │
└─────────────────────────────────────────────────────────┘
```

## How to Read These Specs

### Recommended Reading Order

1. **Start Here**: This overview (you are here)
2. **ANIMATION.md**: High-level system architecture and data flow
3. **VISUAL_STATES.md**: How nodes are classified (foundational concept)
4. **LAYOUT.md**: Layout computation strategy and performance characteristics
5. **INTERPOLATION.md**: How blending works (most technical)
6. **ARCHITECTURE.md** (Section 6.2): Integration with existing architecture

### What Each Spec Covers

| Spec | Focus | Key Sections |
|------|-------|--------------|
| **ANIMATION.md** | System overview, timeline position model | Timeline position, precomputation strategy, performance targets |
| **VISUAL_STATES.md** | Node classification system | Style classes, priority rules, memory savings |
| **LAYOUT.md** | Graph layout computation | Progressive computation, fallback handling, performance timing |
| **INTERPOLATION.md** | Color/position blending | Caching strategy, CSS color-mix, edge cases |
| **ARCHITECTURE.md** | Integration points | Store changes, data extensions, backward compatibility |

## Key Design Decisions

### 1. Enums Instead of Inline Logic

**Before**:
```
Component has 80 lines of reactive logic to compute colors
```

**After**:
```
Engine classifies node → Default (enum 0)
Component looks up → NODE_STYLES[0] → colors
```

**Benefit**: Centralized logic, testable, memory-efficient

### 2. Progressive Layout Computation

**Before**:
```
Compute layout on-demand when rendering
→ 1-2s freeze for large graphs
```

**After**:
```
Compute first layout synchronously (required for initial view)
Queue remaining layouts in background
→ No UI freezes, smooth scrubbing available immediately
```

**Trade-off**: Full-fidelity interpolation takes time, but UI never freezes

### 3. Cache by Style Class, Not Node ID

**Naive**:
```
10,000 nodes × 20 progress values = 200,000 cache entries
```

**Smart**:
```
5 classes × 5 classes × 20 progress values = 500 entries
```

**Savings**: 400× reduction in cache size

### 4. CSS color-mix for GPU Acceleration

**JavaScript Interpolation**:
```
Parse hex colors → RGB → Lerp → Back to hex
Runs on CPU for every node every frame
```

**CSS color-mix**:
```
color-mix(in srgb, #facc15 50%, #ef4444)
GPU-accelerated by browser
```

**Benefit**: Offload work to browser, better performance

## Performance Characteristics

### Memory Budget (10,000 nodes × 100 snapshots)

| Component | Memory |
|-----------|--------|
| Visual States | 17 MB |
| Layout Positions | 8 MB |
| Interpolation Cache | 24 KB |
| **Total Overhead** | **~25 MB** |

**Context**: Modern browsers allocate 100+ MB per tab. 25 MB is acceptable.

### Timing (1,000 node graph)

| Operation | Time | Blocking? |
|-----------|------|-----------|
| Generate 100 snapshots | 500ms | Yes (acceptable) |
| Compute visual states | 100ms | Yes (cheap) |
| Compute first layout | 1s | Yes (required) |
| Compute remaining 99 layouts | 90s | No (background) |
| **Time to first view** | **~1.6s** | |
| Scrubbing (60fps) | 16ms/frame | No |

**User Experience**: 1.6s wait, then immediate smooth scrubbing (with progressive enhancement as layouts complete)

## Migration Strategy

The animation system is designed for incremental adoption:

### Phase 1: Types & Classification (No UI Changes)
- Add visual state enums to types
- Implement classification logic
- Store enums in snapshots
- **Deliverable**: Foundation for animation, no visible changes

### Phase 2: Layout Precomputation (Performance Win)
- Add LayoutManager
- Compute layouts progressively
- Store in snapshots
- **Deliverable**: Faster rendering, no layout recomputation

### Phase 3: Float Timeline Position (Enable Scrubbing)
- Change timelinePosition to float
- Keep currentIndex as derived store (backward compat)
- Update slider to support fractional values
- **Deliverable**: Scrubbing enabled (snaps to integers initially)

### Phase 4: Interpolation (Visual Smoothness)
- Implement style interpolation with caching
- Implement position interpolation
- Update components to use interpolated data
- **Deliverable**: Smooth 60fps scrubbing

Each phase is independently valuable and testable.

## Common Questions

### Q: What if a layout isn't ready when the user scrubs to it?

**A**: Three-tier fallback:
1. Best: Interpolate between current and next layouts
2. Partial: Show current layout (no interpolation)
3. Worst: Show last known layout or loading indicator

See LAYOUT.md Section 5 for details.

### Q: What happens to nodes that appear or disappear between snapshots?

**A**:
- Appearing nodes: Fade in at final position (2× speed)
- Disappearing nodes: Fade out at current position (2× speed)

See INTERPOLATION.md Section 5 for details.

### Q: Does this work in older browsers?

**A**: Yes, with graceful degradation:
- CSS color-mix: Feature detection + JavaScript fallback
- Core functionality works in all modern browsers (2022+)

See INTERPOLATION.md Section 4.2 for browser compatibility.

### Q: Can I disable animations?

**A**: Yes:
- User preference: "Reduce motion" accessibility setting
- Developer flag: `disableInterpolation = true` → snap to integers
- Automatic: Interactions disabled during scrubbing (selection still works at rest)

### Q: What's the fallback if precomputation fails?

**A**: System degrades gracefully:
- No visual states → use default styles
- No layout → show last known layout or recompute on-demand
- No cache → slower interpolation but still functional

## Testing Strategy

### Unit Tests
- Visual classification logic (priority rules)
- Interpolation math (lerp, quantization)
- Cache key generation
- Fallback handling

### Performance Tests
- Memory usage under budget
- Frame rate during scrubbing (60fps target)
- Cache hit rate (>95% expected)
- Layout computation time by graph size

### Visual Tests
- Scrubbing smoothness (manual verification)
- Color accuracy at mid-transitions
- Node fade-in/out timing
- Fallback behavior when layouts not ready

## Next Steps

1. **Review Specs**: Read the four detailed specs in order
2. **Provide Feedback**: Identify ambiguities, missing details, concerns
3. **Approve Design**: Give greenlight to proceed with implementation
4. **Phased Implementation**: Build incrementally following the migration strategy

## Questions to Consider During Review

- Are the performance targets realistic?
- Is the memory budget acceptable?
- Are there edge cases not covered?
- Is the fallback behavior intuitive?
- Are the specs clear enough for implementation?
- Should any design decisions be reconsidered?

---

**Total Specification Size**: ~4,500 words across 4 detailed specs
**Estimated Implementation Time**: 2-3 weeks (phased approach)
**Risk Level**: Low (incremental, backward compatible, well-specified)
