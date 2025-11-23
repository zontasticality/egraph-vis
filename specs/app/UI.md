# SPEC-UI: Visualization & Interaction Spec

Describes how snapshots from the timeline are rendered. All components consume immutable `EGraphState` objects; no component mutates engine data.

## 1. Layout & Structure
- **Root Layout**: Uses `PaneGroup` to split horizontally:
  - **Left Pane (60%)**: Graph Pane (Visual Topology).
  - **Right Pane (40%)**: Vertical stack of Header, Controller, and State Pane.
- **Header**: Contains project title, preset dropdown, implementation toggle, and summary badges (Phase, Step Index, Invariant Status).
- **Controller**: Pinned below the header on the right.

## 2. Design System
Shared visual primitives used across both Graph and State panes to ensure consistency.

### 2.1 E-Node ID (Diamond)
- **Shape**: Colored diamond containing the ID number.
- **Color**: Mapped to a fixed accessible palette based on the ID (stable across renders).
- **Badge**: Yellow star (`★`) in top-right if it is a *canonical* ID (representative).
- **Usage**: Represents an E-Class ID in lists, headers, and graph nodes.

### 2.2 E-Node (Symbol Box)
- **Shape**: Transparent box with rounded corners.
- **Content**: Operator symbol (e.g., `*`, `+`, `a`) followed by child E-Node IDs (Diamonds) in parentheses.
- **Style**:
  - **Active**: Black text, white background, solid border.
  - **Ghost**: Dark grey stroke, light grey background (used for merged/stale nodes in history or diffs).

### 2.3 E-Class (Cluster)
- **Shape**: Box with dotted border.
- **Content**: Collection of E-Nodes belonging to the same equivalence class.

## 3. Interaction Model
Global rules for user interaction, managed via `interactionStore`.

### 3.1 Selection
- **Behavior**: Exclusive selection. Clicking an item selects it and deselects the previous one.
- **Persistence**: Selection persists across timeline steps if the target ID still exists.
- **Deselection**: Clicking the background of any pane clears the selection.
- **Visuals**: Selected items get a high-contrast accent outline (e.g., Blue or Purple).

### 3.2 Hover
- **Behavior**: Transient highlighting. Hovering an item highlights it and its related counterparts in other panes.
- **Synchronous**: Hover effects happen instantly via `interactionStore` without triggering a timeline re-render.

## 4. Graph Pane (`GraphPane.svelte`)
Backed by Svelte Flow (`@xyflow/svelte`) and ELK Layout.

### 4.1 Layout & Rendering
- **Algorithm**: `elk.layered` with `elk.direction: 'DOWN'`.
- **Stability**: `elk.layered.crossingMinimization.strategy: 'INTERACTIVE'` to minimize node jumping.
- **Nodes**: Rendered as **E-Class Clusters**.
  - **Header**: Canonical Diamond ID.
  - **Body**: List of E-Node Symbol Boxes.
- **Edges**: Drawn from Parent E-Class to Child Canonical ID. Labelled with argument index.

### 4.2 Interaction
- **Click Node**: Selects `{ type: 'eclass', id }`.
- **Hover Node**: Highlights corresponding entry in State Pane.
- **Empty State**: If graph is empty, show "Empty E-Graph" placeholder.

## 5. State Pane (`StatePane.svelte`)
Scrollable column visualizing internal structures.

### 5.1 Hashcons View
- **Purpose**: Deduplication map (`canonicalKey -> canonicalId`).
- **Visuals**: List of `Symbol Box → Diamond ID` pairs.
- **Interaction**:
  - **Hover Symbol**: Highlights matching E-Node in E-Class Map.
  - **Hover ID**: Highlights E-Class in E-Class Map.
  - **Click**: Selects the E-Class.

### 5.2 E-Class Map View
- **Purpose**: Primary state view.
- **Layout**: Vertical list of **E-Class Cards**, sorted by Canonical ID.
- **Card Content**:
  - **Header**: Canonical Diamond ID.
  - **Body**: List of Symbol Boxes.
  - **Metadata**: Chips for "Worklist" status.
- **Interaction**:
  - **Hover ID**: Highlights ID in Union-Find.
  - **Hover Symbol**: Highlights child arguments in E-Class Map.
  - **Click**: Selects the E-Class or specific E-Node.

### 5.3 Union-Find View
- **Purpose**: Equivalence tree.
- **Visuals**: Grouped by Canonical ID. Non-canonical IDs point to representatives via arrows.
- **Interaction**: Hovering an ID highlights it in other views.

### 5.4 Worklist View
- **Purpose**: Repair queue.
- **Visuals**: Chips/Tags for E-Class IDs. Red/Orange = Pending.
- **Empty State**: Green "Invariants Restored" message.

## 6. Controller & Playback
- **Controls**: Play/Pause, Step Prev/Next, Jump to Phase, Rewind.
- **Scrub Bar**: Range input with colored ticks for Phase Markers (Read/Write/Rebuild).
- **Feedback**: Tooltips on disabled buttons explaining why (e.g., "At end of timeline").

## 7. Animation Strategy
Managed via `timelineStore.transitionMode`.

### 7.1 Modes
- **Smooth (Play/Step)**:
  - CSS transitions for color/opacity.
  - Svelte `animate:flip` for list reordering.
  - Svelte Flow nodes interpolate positions (`transition: transform 0.3s`).
- **Instant (Scrub/Jump)**:
  - **Disable all transitions**. Immediate DOM updates.
  - Essential for responsive scrubbing.

### 7.2 Graph Interpolation (Advanced)
For "exact tweening" during scrubbing:
1.  **Controller**: Exposes `scrubFraction` (e.g., `4.5`).
2.  **Graph Pane**:
    -   Calculates `t = fraction % 1`.
    -   Interpolates node positions `(x, y)` between Step `floor(fraction)` and `ceil(fraction)`.
    -   Updates Svelte Flow positions directly, bypassing ELK for intermediate frames.

## 8. Accessibility & Performance
- **Accessibility**:
  - High-contrast theme toggle.
  - Keyboard navigation (Tab order: Header -> Controller -> Panes).
  - `aria-live` regions for playback status.
- **Performance**:
  - **Culling**: Hide off-screen graph nodes using `IntersectionObserver`.
  - **Limits**: Warn/Simplify view if node count > 500.
  - **Memoization**: State Pane views memoize derived data on `state.id`.
