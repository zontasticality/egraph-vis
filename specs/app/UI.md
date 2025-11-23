# SPEC-UI: Visualization & Interaction Spec

Describes how snapshots from the timeline are rendered. All components consume immutable `EGraphState` objects; no component mutates engine data.

## 1. Layout
- Root page uses `PaneGroup` to split horizontally: Graph (left, default 60%) and State + Controller stack (right, default 40%).
- Header contains project title, preset dropdown, implementation toggle, and summary badges (current phase, step index, invariant status).
- Controller and playback bar stay pinned under the header on the right pane.

## 2. Graph Pane (`GraphPane.svelte`)
- Backed by Svelte Flow (`@xyflow/svelte`).
- Layout requirements:
  - **Algorithm**: `elk.layered` with `elk.direction: 'DOWN'`.
  - **Stability**: Use `elk.layered.crossingMinimization.strategy: 'INTERACTIVE'` to minimize node jumping between updates.
  - **Sync**: When ELK returns new positions, animate Svelte Flow nodes to them. *Note: User dragging should be disabled or strictly temporary (snaps back on next step) to maintain layout consistency.*
  - Node: represents an e-class. Display canonical id badge + inline list of node ops. Color seed = canonical id (mapped to a fixed accessible palette).
  - Edge: from parent e-class to child canonical id. Label with the argument index.
- Animation:
  - When `metadata.diffs` contains merges, fade out losing nodes and pulse the winner.
  - When new nodes are added, scale-in the node and draw edges with stroke-dashoffset animation.
- Interaction:
  - Clicking a node updates selection metadata with `{ type: 'eclass', id }`.
  - Hover shows tooltip: canonical id, node count, parents count, worklist flag.
  - If selection matches, outline the node in accent color.

## 3. State Pane
The State Pane (right side) contains scrollable sections visualizing the internal e-graph structures.

### 3.1 Visual Language
To ensure consistency across views, we use the following component primitives:

- **E-Node ID (Diamond)**:
  - **Shape**: Colored diamond containing the number.
  - **Color**: Random hue seeded by the ID number (stable across renders).
  - **Badge**: Yellow star in top-right if it is a *canonical* ID (representative).
  
- **E-Node (Symbol Box)**:
  - **Shape**: Transparent box with rounded corners.
  - **Content**: Operator symbol (e.g., `*`, `+`, `a`) followed by child E-Node IDs in parentheses (if any).
  - **Style**:
    - **Active/Normal**: Black text, white background.
    - **Inactive/Ghost**: Dark grey stroke, light grey background (used for merged/stale nodes).

- **E-Class (List Box)**:
  - **Shape**: Transparent box with dotted border.
  - **Content**: Inline list of E-Nodes belonging to this class.
  - **Style**: Active (black border) vs Inactive (grey border).

### 3.2 Hashcons View
- **Purpose**: Visualizes the deduplication map.
- **Visuals**: List of `E-Node (Symbol Box) → E-Node ID (Diamond)` pairs.
  - *Note*: This replaces the raw text key with the rendered symbol box for readability.
- **Interaction**:
  - **Hovering the Symbol Box**: Highlights the matching E-Node in the E-Class Map.
  - **Hovering the ID**: Highlights the E-Class in the E-Class Map.
  - **Clicking**: Selects the corresponding E-Class.

### 3.3 E-Class Map View
- **Purpose**: The primary view of the e-graph state.
- **Layout**: Vertical list of E-Class cards, sorted by Canonical ID.
- **Card Content**:
  - **Header**: Canonical E-Node ID (Diamond with Star).
  - **Body**: List of E-Nodes (Symbol Boxes) in this class.
  - **Metadata**: Chips for "Worklist" status or analysis data.
- **Component-Level Interaction**:
  - **E-Node ID Component**:
    - Hover: Highlights this ID in Union-Find and Hashcons views.
    - Click: Selects `{ type: 'eclass', id }`.
  - **E-Node Component**:
    - Hover: Highlights child arguments (IDs) in the E-Class Map.
    - Click: Selects `{ type: 'enode', id }` (the specific node instance).
  - **E-Class Card**:
    - Hover: Adds subtle border highlight.
    - Click: Selects `{ type: 'eclass', id }`.

### 3.4 Union-Find View
- **Purpose**: Visualizes the equivalence tree.
- **Layout**:
  - Grouped by Canonical ID.
  - Non-canonical IDs point to their representative with arrows.
- **Visuals**:
  - **Arrows**: Active (black) for current mappings, Inactive (grey) for history.
  - **Pulse**: IDs that changed parent in the last step pulse briefly.

### 3.5 Worklist View
- **Purpose**: Shows the queue of E-Classes awaiting repair.
- **Layout**: Chips/Tags representing E-Class IDs.
- **Visuals**:
  - **Red/Orange**: Items currently in the worklist.
  - **Empty State**: "Invariants Restored" (Green).

## 4. Controller & Playback UI
- Controller component renders: play/pause, step forward/back, jump-to-phase dropdown, rewind, FPS slider.
- Playback bar (range input + custom track) shows:
  - Current index (handle).
  - Phase markers (colored ticks: Read=blue, Write=orange, Rebuild=purple).
  - Invariant violation markers (red triangles) sourced from metadata.
- Buttons disabled states tie directly to `controllerStore` computed flags.

## 5. Preset Selector
- Dropdown listing presets from `/static/presets/index.json` (see `specs/egraph/PRESETS.md`). Each option shows expression label + number of rewrites.
- When selection changes, display loading skeletons until new timeline is ready.
- Offer “Customize” button that opens a modal (future work) where users can edit rewrites; spec placeholder references `specs/egraph/PRESETS.md` schema.

## 6. Accessibility & Theming
- Provide high-contrast theme toggle (light/dark). Colors defined via CSS variables.
- Ensure keyboard navigation: tab order flows header → controller → panes. Graph nodes focusable with outlines.
- Prefer `aria-live` region for controller status (e.g., “Paused at step 4/87, phase Write”).

## 7. Performance Guidelines
- **Graph Performance**:
  - **Culling**: Use `IntersectionObserver` to hide nodes/edges outside the viewport if performance degrades.
  - **Limit**: If node count > 500, show a warning and switch to a simplified "Cluster View" or stop auto-layout.
  - **Virtualization**: Avoid complex virtualization for MVP; rely on Svelte Flow's optimized rendering.
- State panes rely on snapshots; avoid recomputing heavy derived data by memoizing on `state.id`.
- State panes rely on snapshots; avoid recomputing heavy derived data by memoizing on `state.id`.

## 8. Animation Strategy
Svelte 5's FLIP animations (`animate:flip`) and transitions are powerful but must be managed carefully during timeline scrubbing.

### 8.1 Playback vs. Scrubbing
The `timelineStore` will expose a `transitionMode` flag:
- **`'smooth'` (Play/Step)**:
  - Use CSS transitions for color/opacity changes.
  - Use FLIP for list reordering (e.g., E-Classes moving).
  - Graph nodes interpolate positions.
- **`'instant'` (Scrub/Jump)**:
  - **Disable all transitions**.
  - Immediate DOM updates to prevent visual "catch-up" lag.
  - Essential for responsive scrubbing across large timelines.

### 8.2 Implementation Details
- **Graph Pane**:
  - Svelte Flow nodes use a `transition: transform 0.3s` only when `transitionMode === 'smooth'`.
  - When scrubbing, remove the transition class to snap instantly.
- **State Pane**:
### 8.3 Graph Interpolation (Optional/Advanced)
To achieve "exact tweening" during scrubbing (where dragging the bar 50% between steps moves nodes 50% of the way):
1.  **Controller**: Must expose a `scrubFraction` (float index, e.g., `4.5`).
2.  **Graph Pane**:
    -   On `scrubFraction` change, identify `floor(fraction)` (Start State) and `ceil(fraction)` (End State).
    -   For each node ID present in both states:
        -   Get `(x1, y1)` from Start and `(x2, y2)` from End.
        -   Calculate `t = fraction % 1`.
        -   Interpolate `x = x1 + (x2 - x1) * t`, `y = y1 + (y2 - y1) * t`.
    -   Update Svelte Flow node positions directly (bypassing ELK for the intermediate frame).
    -   *Note*: This requires the layout to be relatively stable (ELK Interactive mode) to look good. Nodes appearing/disappearing can fade in/out based on `t`.

## 8. File Structure
```
src/lib/components/
  GraphPane.svelte
  StatePane.svelte
  Controller/
  state-sections/
```
Each section component exports props for `state`, `previous`, `selection`, and emits `selectionChange` events bubbling up to a shared handler in `StatePane`.

This document works in tandem with `./ARCHITECTURE.md` (data flow) and the e-graph specs under `specs/egraph/` (what gets visualized).
