# SPEC-INTERPOLATION: Style & Position Blending

Defines how visual properties (colors, positions, opacity) are blended between snapshots during timeline scrubbing. This spec focuses on simplicity and browser-native acceleration.

## 1. Objectives

- **Smooth Transitions**: Linear interpolation of visual properties for seamless scrubbing
- **Simplicity**: Local component computation with Svelte reactivity (no complex caching)
- **Browser Acceleration**: Leverage CSS `color-mix()` for GPU-accelerated color blending
- **Handle Edge Cases**: Gracefully handle nodes appearing or disappearing

## 2. Interpolation Model

### 2.1 Linear Interpolation (Lerp)

**Formula**: `value = start + (end - start) × progress`

**Properties Interpolated**:
- **Position**: x, y coordinates (simple arithmetic)
- **Color**: Border, background, text (CSS color-mix string template)
- **Opacity**: Direct use of progress value for fades

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

**Snapping Thresholds** (optional optimization):
- `progress < 0.01`: Treat as 0.0 (current only, skip interpolation)
- `progress > 0.99`: Treat as 1.0 (next only, skip interpolation)

## 3. Component-Local Interpolation

### 3.1 Philosophy

Each component computes its own interpolated state using Svelte's reactive statements. No centralized interpolation engine or caching layer - keep it simple.

**Benefits**:
- Simpler architecture (no cache management)
- More maintainable (logic is local, easy to understand)
- Leverages Svelte's built-in memoization
- Fast enough for 10,000 nodes (2-3ms per frame)

### 3.2 Component Pattern

Each FlowENode component receives:
- Current visual state enum
- Next visual state enum (if exists)
- Progress value (0.0 to 1.0)

And computes interpolated appearance reactively:

```svelte
<script>
// Inputs from parent
export let currentStyleClass: NodeStyleClass;
export let nextStyleClass: NodeStyleClass | undefined;
export let progress: number;

// Look up style definitions
$: currentStyle = NODE_STYLES[currentStyleClass];
$: nextStyle = nextStyleClass ? NODE_STYLES[nextStyleClass] : currentStyle;

// Interpolate colors using CSS color-mix (string template - cheap!)
$: borderColor = progress > 0.01 && nextStyleClass
    ? `color-mix(in srgb, ${currentStyle.borderColor} ${(1-progress)*100}%, ${nextStyle.borderColor})`
    : currentStyle.borderColor;

$: backgroundColor = progress > 0.01 && nextStyleClass
    ? `color-mix(in srgb, ${currentStyle.backgroundColor} ${(1-progress)*100}%, ${nextStyle.backgroundColor})`
    : currentStyle.backgroundColor;

// Border style snaps at midpoint
$: borderStyle = progress < 0.5 ? currentStyle.borderStyle : nextStyle.borderStyle;
</script>

<div
    style:border-color={borderColor}
    style:border-style={borderStyle}
    style:background-color={backgroundColor}
>
  ...
</div>
```

**Cost Per Node**: ~3 hash lookups + 2 string templates = negligible

## 4. Color Interpolation

### 4.1 CSS color-mix() Strategy

**Modern Approach** (Chrome 111+, Firefox 113+, Safari 16.2+):
```css
color-mix(in srgb, #facc15 50%, #ef4444)
```

**Benefits**:
- GPU-accelerated (browser-native)
- Perceptually accurate (sRGB color space)
- Minimal JavaScript overhead (just string template)

**Fallback** (Older Browsers):

Detect support and provide JavaScript fallback if needed:

```typescript
const supportsColorMix = CSS.supports('color', 'color-mix(in srgb, red, blue)');

function getInterpolatedColor(color1: string, color2: string, progress: number): string {
    if (supportsColorMix) {
        return `color-mix(in srgb, ${color1} ${(1-progress)*100}%, ${color2})`;
    }
    // Fallback: JavaScript RGB interpolation
    return interpolateRGB(color1, color2, progress);
}
```

### 4.2 Browser Compatibility

**Browser Support**:
- ✅ Chrome 111+ (March 2023)
- ✅ Firefox 113+ (May 2023)
- ✅ Safari 16.2+ (December 2022)
- ❌ IE, Legacy Edge (acceptable - provide fallback)

**Decision**: Use CSS color-mix as primary, with simple JavaScript fallback for older browsers.

### 4.3 Color Space

**Recommendation**: Use `srgb` for broad compatibility and predictable results.

**Future Enhancement**: Consider `oklab` for perceptually uniform interpolation (better color accuracy), but requires newer browser support.

## 5. Position Interpolation

### 5.1 Standard Case (Node Exists in Both Snapshots)

**Formula** (applied in GraphPane when building node array):
```typescript
const currentPos = currentLayout.nodes.get(nodeId);
const nextPos = nextLayout?.nodes.get(nodeId);

const x = currentPos.x + (nextPos.x - currentPos.x) * progress;
const y = currentPos.y + (nextPos.y - currentPos.y) * progress;
const opacity = 1.0;
```

**Cost**: 4 arithmetic operations per node (negligible)

### 5.2 Appearing Nodes (Only in Next Snapshot)

**Strategy**: Fade in at final position

```typescript
const x = nextPos.x;
const y = nextPos.y;
const opacity = Math.min(1.0, progress * 2);  // Fade in at 2× speed
```

**Rationale**: Node appears at its final position while fading in. 2× speed ensures full visibility by midpoint.

### 5.3 Disappearing Nodes (Only in Current Snapshot)

**Strategy**: Fade out at current position

```typescript
const x = currentPos.x;
const y = currentPos.y;
const opacity = Math.max(0.0, 1.0 - progress * 2);  // Fade out at 2× speed
```

**Rationale**: Node holds position while fading out. Fully transparent before reaching next snapshot.

### 5.4 Non-Existent Nodes

**Strategy**: Don't render (skip in node array construction)

## 6. Opacity for Fades

### 6.1 Simplest Approach

Opacity directly uses the progress value - no interpolation function needed:

```typescript
// Appearing: opacity increases with progress
opacity = progress;

// Disappearing: opacity decreases with progress
opacity = 1.0 - progress;

// Standard (exists in both): always visible
opacity = 1.0;
```

For faster fades (recommended for appearing/disappearing), multiply by 2× and clamp:

```typescript
opacity = Math.min(1.0, progress * 2);  // Fade in
opacity = Math.max(0.0, 1.0 - progress * 2);  // Fade out
```

## 7. Edge Interpolation

### 7.1 Edge Behavior

Edges follow the same rules as their source nodes:
- Position: Endpoints interpolate with source/target nodes (automatic via Svelte Flow)
- Opacity: Inherit from source node
- Color: Based on port color (no interpolation needed)

**Implementation**: No special edge interpolation code needed - Svelte Flow handles edge positioning automatically when node positions change.

## 8. Performance Characteristics

### 8.1 Cost Analysis (10,000 nodes per frame @ 60fps)

| Operation | Count | Cost | Total |
|-----------|-------|------|-------|
| Style lookup | 20,000 | 0.1ms | 0.1ms |
| String template (color-mix) | 20,000 | 1-2ms | 1-2ms |
| Position arithmetic | 30,000 | 0.1ms | 0.1ms |
| **Total per frame** | | | **~2-3ms** |

**Frame budget**: 16.7ms @ 60fps
**Interpolation overhead**: 15-20% of budget (acceptable)

### 8.2 When to Optimize

**Profile first!** Only add optimization complexity if:
- Frame rate drops below 30fps on target hardware
- Profiling shows interpolation is >30% of frame time
- Evidence supports the complexity trade-off

**Likely optimizations** (if needed):
- Throttle slider updates to 30fps instead of 60fps
- Skip interpolation for off-screen nodes
- Use `will-change: transform` CSS hint for positions

## 9. Interaction During Scrubbing

### 9.1 What Works During Scrubbing

**Enabled** (no performance impact):
- Node selection (click to select)
- Pan and zoom
- Slider dragging

**Rationale**: These are low-frequency events (clicks, not mousemove), so no performance concern.

### 9.2 Optional Performance Optimization

If performance becomes an issue, consider disabling high-frequency events:

**Potentially Disable** (only if profiling shows bottleneck):
- Hover effects (mousemove highlighting)
- Edge highlighting on port hover

**Implementation**: Use `isScrubbing` flag to skip expensive hover logic:
```svelte
function handleMouseEnter() {
    if ($scrubData.isScrubbing) return;  // Skip during scrubbing
    // ... normal hover logic
}
```

**Important**: Only disable hover effects if testing shows they impact frame rate. Don't prematurely optimize.

## 10. Data Flow

### 10.1 End-to-End Process

**Step 1: User Drags Slider**
```
Input: position = 4.5
Derived: currentIndex = 4, nextIndex = 5, progress = 0.5
```

**Step 2: Store Updates**
```
scrubData derived store recomputes:
{
    currentIndex: 4,
    nextIndex: 5,
    progress: 0.5,
    currentState: timeline.states[4],
    nextState: timeline.states[5],
    isScrubbing: true
}
```

**Step 3: GraphPane Reacts**
```
$: buildNodeArray($scrubData)

For each node:
    - Fetch current/next visual states
    - Interpolate position (simple arithmetic)
    - Pass data to FlowENode component
```

**Step 4: FlowENode Reacts**
```
$: borderColor = interpolateColor(current, next, progress)
$: position = interpolatedPos

Svelte updates DOM efficiently
```

### 10.2 Svelte's Built-in Optimizations

Svelte automatically:
- Memoizes reactive statements (only recomputes on input change)
- Batches DOM updates
- Avoids unnecessary re-renders

**No manual optimization needed** - trust Svelte's reactivity system.

## 11. Edge Cases & Fallbacks

### 11.1 Missing Layout Data

**Scenario**: Next layout not ready yet

**Behavior**: Use current position only (no interpolation)
```typescript
const nextPos = nextLayout?.nodes.get(nodeId);
if (!nextPos) {
    // No interpolation, show current position
    return { x: currentPos.x, y: currentPos.y, opacity: 1.0 };
}
```

**User Experience**: Position snaps instead of interpolating (acceptable degradation).

### 11.2 Missing Visual State

**Scenario**: Visual state not computed for some reason

**Fallback**: Use Default style class
```typescript
const styleClass = visualState?.styleClass ?? NodeStyleClass.Default;
```

## 12. Testing Strategy (Minimal)

### 12.1 Essential Tests Only

**Unit Tests** (important - these are pure functions):
- Position interpolation math (standard, appearing, disappearing cases)
- Progress normalization (floor, modulo)
- Opacity calculations

**Manual Testing** (UI behavior - not worth automating):
- Scrub timeline and verify smoothness
- Check appearing/disappearing nodes fade correctly
- Verify colors look reasonable at mid-transitions

**Performance Testing** (if issues arise):
- Measure frame rate during scrubbing with large graphs
- Profile to identify bottlenecks (only if <30fps)

**Skip**:
- UI testing frameworks (too much overhead)
- Visual regression tests (not worth the maintenance)
- Exhaustive edge case testing (manual spot-checks sufficient)

## 13. Future Enhancements

### 13.1 Non-Linear Easing (Optional Polish)

Replace linear interpolation with easing functions:
```typescript
progress = easeInOutCubic(progress);
```

**Benefit**: More natural-feeling motion (ease in/out)
**Cost**: One function call per interpolation
**Priority**: Low (linear is fine)

### 13.2 Reduced Motion Support

Respect user's motion preferences:
```typescript
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (prefersReducedMotion) {
    // Snap to integer positions, skip interpolation
    timelinePosition.set(Math.round(position));
}
```

**Benefit**: Accessibility compliance
**Priority**: Medium (good practice)

## 14. Relationship to Other Specs

- **ANIMATION.md**: Interpolation is Phase 3 of the animation system
- **VISUAL_STATES.md**: Interpolation operates on visual state enums
- **LAYOUT.md**: Interpolation requires precomputed layouts
- **UI.md**: Components implement local interpolation logic
