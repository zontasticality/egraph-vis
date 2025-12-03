# SPEC-INTERPOLATION: Style & Position Blending

Defines how visual properties (colors, positions, opacity) are blended between snapshots during timeline scrubbing. This spec focuses on performance through intelligent caching and browser-native acceleration.

## 1. Objectives

- **Smooth Transitions**: Linear interpolation of all visual properties for seamless scrubbing
- **Cache Efficiency**: Minimize redundant calculations through intelligent caching strategy
- **Browser Acceleration**: Leverage CSS `color-mix()` for GPU-accelerated color blending
- **Handle Edge Cases**: Gracefully handle nodes/edges appearing or disappearing

## 2. Interpolation Model

### 2.1 Linear Interpolation (Lerp)

**Formula**: `value = start + (end - start) × progress`

**Properties Interpolated**:
- **Position**: x, y coordinates
- **Color**: Border color, background color, text color
- **Opacity**: Fade in/out for appearing/disappearing elements

**Not Interpolated** (discrete):
- **Border style**: solid vs dashed (snaps at 50% threshold)
- **Border width**: Fixed per style class
- **Text content**: Node labels, e-class IDs

### 2.2 Progress Normalization

Given timeline position `p` (e.g., 4.5):
- **Current Index**: `floor(p)` = 4
- **Next Index**: `floor(p) + 1` = 5
- **Progress**: `p % 1.0` = 0.5

**Progress Range**: `[0.0, 1.0]`
- `0.0`: Entirely at current snapshot
- `0.5`: Halfway between current and next
- `1.0`: Entirely at next snapshot

**Snapping Thresholds**:
- `progress < 0.01`: Treat as 0.0 (current only)
- `progress > 0.99`: Treat as 1.0 (next only)
- Avoids micro-interpolations that are imperceptible

## 3. Style Interpolation

### 3.1 The Caching Problem

**Naive Approach**: Cache by node ID
```
Cache Key: node-42-progress-0.5
Problem: 10,000 nodes × 20 progress values = 200,000 cache entries
Memory: 200,000 × 48 bytes = 9.6 MB (wasteful)
```

**Smart Approach**: Cache by style class transition
```
Cache Key: MatchedLHS→NewNode-progress-0.5
Problem: 5 classes × 5 classes × 20 progress values = 500 cache entries
Memory: 500 × 48 bytes = 24 KB (efficient!)
```

**Insight**: Many nodes share the same style class transition. Cache the interpolated style once and reuse it for all nodes with that transition.

### 3.2 Progress Quantization

To further reduce cache keys, quantize progress values:

**Strategy**: Round to nearest 0.05 (20 steps)
```
progress = 0.523 → 0.50
progress = 0.574 → 0.55
progress = 0.991 → 1.00
```

**Rationale**:
- Human eye cannot distinguish 0.50 from 0.52
- Reduces cache keys by 5× (100 → 20 unique progress values)
- Scrubbing feels equally smooth

**Trade-off**: Slight quantization artifacts (imperceptible) for massive cache efficiency.

### 3.3 Cache Key Structure

**Format**: `{currentClass}-{nextClass}-{quantizedProgress}`

**Examples**:
```
0-1-0.50  → Default to MatchedLHS at 50%
1-2-0.75  → MatchedLHS to NewNode at 75%
3-0-0.00  → NonCanonical to Default at 0% (not interpolating)
```

**Cache Size Calculation**:
- 5 node style classes × 5 = 25 possible transitions
- 20 quantized progress values
- Max keys: 25 × 20 = 500 entries
- Memory: 500 × 48 bytes = 24 KB (negligible)

### 3.4 Interpolated Style Structure

**Output Format**:
```
InterpolatedStyle: {
    // Concrete values for current position
    borderColor: string,
    borderWidth: number,
    borderStyle: 'solid' | 'dashed',
    backgroundColor: string,
    textColor: string,
    opacity: number,

    // Metadata for CSS color-mix
    _progress: number,           // Quantized progress
    _nextBorderColor?: string,   // For CSS interpolation
    _nextBackgroundColor?: string
}
```

**Usage Pattern**:
1. Look up `InterpolatedStyle` from cache
2. If `_progress > 0`, use CSS `color-mix()` for smooth blending
3. Otherwise, use direct color values

## 4. Color Interpolation

### 4.1 CSS color-mix() Strategy

**Modern Approach** (Chrome 111+, Firefox 113+, Safari 16.2+):
```
CSS: color-mix(in srgb, #facc15 50%, #ef4444)
```

**Benefits**:
- GPU-accelerated (browser-native)
- Perceptually accurate (sRGB color space)
- Minimal JavaScript overhead

**Fallback** (Older Browsers):
```
JavaScript: interpolateRGB('#facc15', '#ef4444', 0.5)
→ Convert to RGB, lerp each channel, convert back
```

### 4.2 Browser Compatibility

**Feature Detection**:
```
CSS.supports('color', 'color-mix(in srgb, red, blue)')
→ Use native color-mix

Fallback:
→ Polyfill with JavaScript RGB interpolation
```

**Browser Support**:
- ✅ Chrome 111+ (March 2023)
- ✅ Firefox 113+ (May 2023)
- ✅ Safari 16.2+ (December 2022)
- ❌ IE, Legacy Edge (acceptable)

**Decision**: Use CSS color-mix as primary, with JavaScript fallback for unsupported browsers (rare in 2024+).

### 4.3 Color Space Considerations

**sRGB vs Oklab**:
- **sRGB**: Standard, widely supported, can produce muddy mid-tones
- **Oklab**: Perceptually uniform, better interpolation, newer support

**Recommendation**: Use `srgb` for broad compatibility. Consider `oklab` as future enhancement.

## 5. Position Interpolation

### 5.1 Standard Case (Node Exists in Both Snapshots)

**Formula**:
```
x = current.x + (next.x - current.x) × progress
y = current.y + (next.y - current.y) × progress
opacity = 1.0
```

**Result**: Smooth movement from current position to next position.

### 5.2 Appearing Nodes (Only in Next Snapshot)

**Strategy**: Fade in at final position

```
x = next.x
y = next.y
opacity = min(1.0, progress × 2)  // Fade in faster (50% of transition)
```

**Rationale**:
- Node doesn't exist in current snapshot, no "from" position to interpolate
- Showing it immediately at next position with fade-in is most intuitive
- 2× fade speed ensures node is fully visible by midpoint

### 5.3 Disappearing Nodes (Only in Current Snapshot)

**Strategy**: Fade out at current position

```
x = current.x
y = current.y
opacity = max(0.0, 1.0 - progress × 2)  // Fade out faster
```

**Rationale**:
- Node will not exist in next snapshot
- Hold position while fading out feels natural
- 2× fade speed completes fade before reaching next snapshot

### 5.4 Non-Existent Nodes (In Neither Snapshot)

**Strategy**: Don't render

```
return undefined
```

**Context**: Unlikely scenario (node was in previous or will be in future snapshot). Skip rendering.

### 5.5 Position Caching

**Question**: Should positions be cached like styles?

**Answer**: No, position interpolation is cheap (3 arithmetic operations) and cache hit rate would be low (positions are unique per node). Compute on-demand.

## 6. Edge Interpolation

### 6.1 Edge Existence

Edges are defined by source node and target group. An edge exists if:
- Source node exists in the snapshot
- Target group exists in the snapshot
- Source node's argument points to target group

### 6.2 Edge Appearance/Disappearance

**Same Rules as Nodes**:
- Appearing: Fade in at next position
- Disappearing: Fade out at current position
- Opacity drives visibility

**Implementation**: Edges inherit opacity from their source node. No separate interpolation needed.

### 6.3 Edge Color Interpolation

**Simple Rule**: Edges use source node's port color (no separate interpolation)

## 7. Performance Optimizations

### 7.1 Cache Warming

**Strategy**: Pre-populate cache with common transitions when timeline loads

**Common Transitions**:
- Default → MatchedLHS (read phase)
- MatchedLHS → NewNode (write phase)
- NewNode → Default (completion)

**Benefit**: First scrub has cache hits immediately, no stutter.

### 7.2 Batching Updates

**Problem**: Updating 10,000 nodes individually triggers 10,000 Svelte reactivity cycles.

**Solution**: Batch updates into a single derived store update
```
$: interpolatedNodes = computeAllInterpolations($scrubData)
```

**Benefit**: One reactivity cycle, not 10,000.

### 7.3 Disable Interactions During Scrubbing

**Rationale**: Selection/hover logic adds overhead during high-frequency scrubbing updates.

**Strategy**: Use `isScrubbing` flag to disable:
- Node selection (click handlers return early)
- Hover effects (no highlights)
- Edge highlighting

**Enabled During Scrubbing**:
- Pan and zoom (essential for navigation)
- Slider dragging (obviously)

### 7.4 Throttling Updates

**Problem**: User drags slider generating 100 position updates per second.

**Solution**: Throttle updates to 60fps (16.7ms intervals)
```
let lastUpdate = 0;
if (now - lastUpdate < 16.7) return;
lastUpdate = now;
updateView();
```

**Benefit**: Reduces unnecessary renders, maintains smooth appearance.

## 8. Interpolation Flow

### 8.1 End-to-End Process

**Step 1: User Drags Slider**
```
Input: position = 4.5
Derived: currentIndex = 4, nextIndex = 5, progress = 0.5
```

**Step 2: Fetch Snapshots**
```
currentState = timeline.states[4]
nextState = timeline.states[5]
```

**Step 3: Fetch Visual States**
```
currentVisual = currentState.visualStates.nodes.get(42)
nextVisual = nextState?.visualStates.nodes.get(42)
```

**Step 4: Interpolate Style**
```
quantizedProgress = 0.50
cacheKey = "1-2-0.50"
style = cache.get(cacheKey) || computeAndCache(...)
```

**Step 5: Interpolate Position**
```
currentPos = currentState.layout?.nodes.get(42)
nextPos = nextState?.layout?.nodes.get(42)
pos = lerp(currentPos, nextPos, 0.5)
```

**Step 6: Render**
```
Apply style colors via CSS color-mix
Set node position to interpolated pos
Set opacity for fade in/out
```

### 8.2 Caching Interaction

**First Scrub to Position 4.5**:
```
Cache miss → Compute interpolated style → Store in cache
Next frame: Cache hit → Return cached style
```

**Scrub to Position 5.5 (Similar Transition)**:
```
Same style classes, same quantized progress → Cache hit immediately
```

**Cache Hit Rate**: Expected >95% after first few scrubs.

## 9. Testing Strategy

### 9.1 Unit Tests

**Style Interpolation**:
- Verify quantization rounds correctly
- Check cache key generation
- Confirm color interpolation math

**Position Interpolation**:
- Standard case: both snapshots have node
- Appearing: only next has node
- Disappearing: only current has node
- Non-existent: neither has node

### 9.2 Performance Tests

**Cache Hit Rate**: Measure over 100 scrubs
**Interpolation Time**: Measure per-frame cost for 10,000 nodes
**Memory Usage**: Confirm cache stays under 1 MB

### 9.3 Visual Tests

**Smoothness**: Manually scrub and verify no stuttering
**Fade Timing**: Check appearing/disappearing nodes fade at correct rate
**Color Accuracy**: Verify mid-transition colors look correct

## 10. Edge Cases & Failure Modes

### 10.1 Missing Layout Data

**Scenario**: User scrubs to position where next layout isn't ready

**Behavior**: Use current position only, no interpolation
```
if (!nextPos) {
    return { x: currentPos.x, y: currentPos.y, opacity: 1.0 };
}
```

**User Experience**: Position doesn't interpolate (snaps), but view still renders.

### 10.2 Mismatched Visual States

**Scenario**: Visual states are computed but layout is missing

**Behavior**: Render with default layout or last known layout

**Prevention**: Visual states are cheap to compute, so this is rare.

### 10.3 Cache Overflow

**Scenario**: Cache grows beyond expected 500 entries (shouldn't happen)

**Mitigation**: Implement LRU eviction at 1,000 entries
```
if (cache.size > 1000) {
    evictLRU();
}
```

**Rationale**: Failsafe against unexpected cache growth.

## 11. Future Enhancements

### 11.1 Non-Linear Easing

Replace linear interpolation with easing functions:
```
progress = easeInOutCubic(progress)
```

**Benefit**: More natural-feeling motion (accelerate/decelerate).

### 11.2 Anticipatory Caching

Predict user's next scrub direction and pre-cache nearby transitions:
```
If scrubbing right, pre-cache transitions at position + 0.25, + 0.5, + 0.75
```

**Benefit**: Guaranteed cache hits during continuous scrubbing.

### 11.3 Interpolation Quality Levels

User-configurable quality:
- **Performance**: Snap positions, interpolate colors only
- **Balanced**: Interpolate positions + colors
- **Quality**: Add easing + anticipatory caching

## 12. Relationship to Other Specs

- **ANIMATION.md**: Interpolation is Phase 3 of the animation system
- **VISUAL_STATES.md**: Interpolation operates on visual state enums
- **LAYOUT.md**: Interpolation requires precomputed layouts
- **UI.md**: Components consume interpolated styles and positions
