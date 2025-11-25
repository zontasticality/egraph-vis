# SPEC-UI: Visualization & Interaction Spec

Describes how snapshots from the timeline are rendered. All components consume immutable `EGraphState` objects; no component mutates engine data.

## 1. Layout & Structure
- **Root Layout**: Uses `paneforge` for resizable split panes:
  - **Left Pane**: Graph Pane (Visual Topology).
  - **Right Pane**: Vertical stack of Header, Controller, and State Pane.
  - **Persistence**: Split position is saved to `localStorage`.
- **Header**: Contains project title, implementation toggle (Naive/Deferred), and summary badges.
- **Controller**: Pinned below the header on the right.

## 2. Design System
Shared visual primitives used across both Graph and State panes to ensure consistency.

### 2.1 E-Node Component (`<ENode />`)
A unified, context-aware component that renders an E-Node or E-Class ID.

#### Props
- `id`: `ENodeId` (Required)
- `mode`: `'id' | 'symbol'` (Default: 'id')
- `variant`: `'default' | 'ghost' | 'active'` (Optional)

#### Visual States (Derived)
-   **Base**: White/Light background.
-   **Active** (Stage-Dependent Colors):
    -   **Read (Match)**: Yellow (`#eab308`) border/text, light yellow bg.
    -   **Write (Add/Merge)**: Red (`#ef4444`) border/text, light red bg.
    -   **Rebuild (Worklist)**: Blue (`#3b82f6`) border/text, light blue bg.
-   **Hovered**: Light Blue highlight/glow.
-   **Selected**: Solid Blue border, Blue background tint.
-   **Ghost**: Greyed out, dashed border.

## 4. Graph Pane (`GraphPane.svelte`)
Backed by Svelte Flow (`@xyflow/svelte`) and ELK Layout.

### 4.1 Layout & Rendering
- **Algorithm**: `elk.layered` with `elk.direction: 'DOWN'` and `elk.hierarchyHandling: 'INCLUDE_CHILDREN'`.
- **Nodes**: Rendered as **E-Class Clusters** (custom `FlowEClassGroup`).
  - **Header**: Canonical Diamond ID.
  - **Body**: List of E-Node Symbol Boxes (`FlowENode`).
- **Edges**: Drawn from Parent E-Node to Child E-Class Group. Arrow markers added. Edge labels removed for clarity.

## 5. State Pane (`StatePane.svelte`)
Single scrollable column visualizing internal structures.

### 5.1 Sections
- **Hashcons**: List of `ENode` (Symbol) -> `Diamond` (ID).
- **E-Classes**: Vertical list of E-Class Cards.
- **Worklist**: Chips for pending E-Class IDs.

## 6. Controller & Playback
- **Controls**: Play/Pause, Step Prev/Next, Jump to Phase.
- **Scrub Bar**: Range input.
- **Phase Badges**: Colored to match Active State (Yellow/Red/Blue).

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
