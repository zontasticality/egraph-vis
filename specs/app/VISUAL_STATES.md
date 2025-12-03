# SPEC-VISUAL_STATES: Node & E-Class Visual Classification

Defines how nodes and e-classes are classified into semantic visual states based on their role in each snapshot. This classification is lightweight (stored as enum indices) and drives the visual appearance during rendering.

## 1. Objectives

- **Semantic Clarity**: Separate "what a node represents" from "how it looks" for flexibility
- **Memory Efficiency**: Store only a single byte enum instead of full style objects
- **Centralized Logic**: Move visual classification out of components into engine layer
- **Consistency**: Graph Pane and State Pane use identical visual states

## 2. Visual State Philosophy

### 2.1 Separation of Concerns

**Visual State** (stored in snapshot):
- Semantic category: "This node is matched in the current pattern"
- Lightweight enum index: 1 byte
- Derived from snapshot phase, diffs, and metadata

**Visual Style** (applied at render time):
- Concrete appearance: colors, borders, opacity
- Stored in shared style definitions (not duplicated per node)
- Mapped from visual state enum

### 2.2 Example

**Storage**:
```
Node 42: { styleClass: NodeStyleClass.MatchedLHS }  // 1 byte
```

**Rendering**:
```
Look up NODE_STYLES[NodeStyleClass.MatchedLHS]
→ { borderColor: '#facc15', backgroundColor: '#facc15', ... }
```

**Memory Savings**: 1 byte vs ~48 bytes (6 strings × 8 bytes)

## 3. Node Visual States

### 3.1 Node Style Classes

Five distinct semantic categories for nodes:

| Style Class | Meaning | When Applied |
|-------------|---------|--------------|
| **Default** | Normal node, not special in this snapshot | No special conditions met |
| **MatchedLHS** | Part of a pattern match (left-hand side) | Read phase: node appears in `metadata.matches` |
| **NewNode** | Newly created in this step | Write phase: node appears in `metadata.diffs` as `add` or `rewrite` |
| **NonCanonical** | Ghost node (merged away) | Compact phase: node has arguments pointing to non-canonical e-classes |
| **ParentNode** | Parent being repaired | Repair phase: node's arguments include the active e-class ID |

### 3.2 Priority Rules

When multiple conditions apply, use the highest priority (top wins):

**Priority Order** (highest to lowest):
1. **ParentNode** — Repair phase overrides everything
2. **NonCanonical** — Compact phase ghost visualization
3. **NewNode** — Write phase creation (higher than matches)
4. **MatchedLHS** — Read/Write phase pattern matching
5. **Default** — Fallback

**Example Scenario**:
- Node 42 is matched (MatchedLHS)
- Node 42 is also newly created (NewNode)
- Result: NewNode wins (priority 3 > priority 4)

### 3.3 Phase-Specific Behavior

| Phase | Typical Visual States |
|-------|----------------------|
| **Init** | All Default |
| **Read** | MatchedLHS (yellow) for pattern matches, rest Default |
| **Write** | MatchedLHS (yellow) for LHS tree, NewNode (red) for created nodes |
| **Compact** | NonCanonical (dashed border) for ghost nodes |
| **Repair** | ParentNode (blue) for nodes being re-canonicalized |
| **Done** | All Default |

### 3.4 Data Structure

Stored in each `EGraphState`:

```
visualStates: {
    nodes: Map<NodeId, NodeVisualState>
}

NodeVisualState: {
    styleClass: NodeStyleClass (enum, 0-4),
    portTargets: number[]  // Canonical IDs for each argument
}
```

**Port Targets Rationale**: Port colors depend on whether they point to canonical or non-canonical e-classes. Storing the canonical target ID for each port avoids recomputation and supports interpolation.

## 4. E-Class Visual States

### 4.1 E-Class Style Classes

Four semantic categories for e-class groups:

| Style Class | Meaning | When Applied |
|-------------|---------|--------------|
| **Default** | Normal e-class | No special conditions |
| **Active** | Currently being processed | Repair/Compact: matches `metadata.activeId` |
| **InWorklist** | Pending congruence restoration | E-class ID appears in `worklist` |
| **Merged** | Non-canonical e-class (merged away) | Union-find shows this ID is not canonical |

### 4.2 Priority Rules

**Priority Order** (highest to lowest):
1. **Merged** — Non-canonical classes are grayed out
2. **Active** — Currently processing (compact/repair highlight)
3. **InWorklist** — Pending work
4. **Default** — Fallback

### 4.3 Data Structure

```
visualStates: {
    eclasses: Map<EClassId, EClassVisualState>
}

EClassVisualState: {
    styleClass: EClassStyleClass (enum, 0-3),
    isCanonical: boolean  // Redundant with Merged, but cached for convenience
}
```

## 5. Style Definitions

### 5.1 Shared Style Dictionary

A single source of truth for visual appearance, defined once and shared by all components.

**Structure**:
```
NODE_STYLES: {
    [NodeStyleClass.Default]: StyleDefinition,
    [NodeStyleClass.MatchedLHS]: StyleDefinition,
    [NodeStyleClass.NewNode]: StyleDefinition,
    [NodeStyleClass.NonCanonical]: StyleDefinition,
    [NodeStyleClass.ParentNode]: StyleDefinition
}

StyleDefinition: {
    borderColor: string,
    borderWidth: number,
    borderStyle: 'solid' | 'dashed',
    backgroundColor: string,
    textColor: string,
    opacity: number (optional)
}
```

### 5.2 Current Style Mapping

Based on existing codebase conventions:

| Style Class | Border | Background | Text | Border Style |
|-------------|--------|------------|------|--------------|
| **Default** | Black | White | Dark Gray | Solid |
| **MatchedLHS** | Yellow (#facc15) | Yellow (#facc15) | White | Solid |
| **NewNode** | Red (#ef4444) | Red (#ef4444) | White | Solid |
| **NonCanonical** | Red (#ef4444) | White | Dark Gray | Dashed |
| **ParentNode** | Blue (#3b82f6) | Blue (#3b82f6) | White | Solid |

**E-Class Groups**:

| Style Class | Border | Background | Opacity |
|-------------|--------|------------|---------|
| **Default** | Gray | Light Gray | 1.0 |
| **Active** | Orange | Light Orange | 1.0 |
| **InWorklist** | Blue | Light Blue | 1.0 |
| **Merged** | Gray | Light Gray | 0.5 |

## 6. Port Colors

### 6.1 Port Color Rules

Ports (argument handles) have special coloring rules:

| Condition | Color | Rationale |
|-----------|-------|-----------|
| Points to canonical e-class | Hash-based color (derived from target ID) | Maintains visual identity |
| Points to non-canonical e-class | Red (#ef4444) | Indicates broken congruence |

### 6.2 Precomputing Port Colors

To avoid recomputation during rendering, `NodeVisualState` stores the canonical target ID for each port:

```
NodeVisualState: {
    portTargets: [canonical1, canonical2, ...]
}
```

**Derivation**:
For each argument ID in `node.args`, resolve it through `unionFind` to get the canonical ID.

**Rendering**:
- If `unionFind[portTargets[i]].isCanonical === false`: use red
- Otherwise: use `getColorForId(portTargets[i])`

## 7. Computation Strategy

### 7.1 When Visual States are Computed

**Timing**: After the `TimelineEngine` generates all snapshots, before layout computation.

**Process**:
1. Iterate through each snapshot in the timeline
2. For each snapshot, call `computeVisualStates(snapshot)`
3. Store result in `snapshot.visualStates`

**Performance**: ~1ms per snapshot (cheap, no DOM operations)

### 7.2 Centralized Logic Location

All classification logic lives in a dedicated module: `src/lib/engine/visual.ts`

**Function Signature**:
```
computeVisualStates(state: EGraphState): {
    nodes: Map<number, NodeVisualState>,
    eclasses: Map<number, EClassVisualState>
}
```

**Benefits**:
- Single source of truth for visual classification
- Testable in isolation
- Components become thin renderers (no complex logic)
- Easy to modify visual rules without touching UI code

### 7.3 Component Migration

**Before** (80+ lines of reactive logic in FlowENode.svelte):
```
$: isMatched = ...
$: isNew = ...
$: isNonCanonical = ...
$: borderColor = (isMatched ? yellow : isNew ? red : ...)
```

**After** (simple lookup):
```
$: visualState = $currentState.visualStates.nodes.get(data.id)
$: style = NODE_STYLES[visualState.styleClass]
```

## 8. Extensibility

### 8.1 Adding New Visual States

To add a new visual category (e.g., "HighlightedByUser"):

1. Add enum value to `NodeStyleClass`
2. Add style definition to `NODE_STYLES`
3. Update priority rules in `computeNodeStyleClass()`
4. No component changes needed (automatic)

### 8.2 Theme Support

The style definitions can be swapped for different themes:

```
const DARK_THEME_STYLES = { ... }
const LIGHT_THEME_STYLES = { ... }

// Switch themes by swapping the active definition
activeStyles = userPrefersDark ? DARK_THEME_STYLES : LIGHT_THEME_STYLES
```

Components remain unchanged.

## 9. Relationship to Interpolation

Visual states enable efficient interpolation (see INTERPOLATION.md):

- **Problem**: Interpolating 10,000 nodes × 20 progress values = 200,000 cache entries
- **Solution**: Cache by `(currentClass, nextClass, progress)` = only 500 entries max
- **Benefit**: Nodes with the same state transitions share cached interpolated styles

**Example**:
- Node 10, 20, 30 all transition from MatchedLHS to NewNode at progress 0.5
- All three reuse the same cached interpolated style
- Memory: 1 cached entry instead of 3
