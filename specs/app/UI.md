# SPEC-UI: Visualization & Interaction Spec

Describes how snapshots from the timeline are rendered. All components consume immutable `EGraphState` objects; no component mutates engine data.

## 1. Layout
- Root page uses `PaneGroup` to split horizontally: Graph (left, default 60%) and State + Controller stack (right, default 40%).
- Header contains project title, preset dropdown, implementation toggle, and summary badges (current phase, step index, invariant status).
- Controller and playback bar stay pinned under the header on the right pane.

## 2. Graph Pane (`GraphPane.svelte`)
- Backed by Svelte Flow (`@xyflow/svelte`).
- Layout requirements:
  - Use ELK (ELK layout plugin) in layered mode to keep parents above children.
  - Node: represents an e-class. Display canonical id badge + inline list of node ops. Color seed = canonical id.
  - Edge: from parent e-class to child canonical id. Label with the argument index.
- Animation:
  - When `metadata.diffs` contains merges, fade out losing nodes and pulse the winner.
  - When new nodes are added, scale-in the node and draw edges with stroke-dashoffset animation.
- Interaction:
  - Clicking a node updates selection metadata with `{ type: 'eclass', id }`.
  - Hover shows tooltip: canonical id, node count, parents count, worklist flag.
  - If selection matches, outline the node in accent color.

## 3. State Pane
Scrollable column containing the following sections. Each section receives `state`, `selection`, and `prevState` to compute highlights.

### 3.1 Hashcons View
- Render rows `canonicalKey → canonicalId`. Keys truncated to 32 chars with tooltip for full text.
- Highlight rule: keys touched in the latest diff or containing the selected e-node (if selection type `enode`).
- When clicking a row, update selection to `{ type: 'hashcons', key }` and scroll corresponding e-class into view.

### 3.2 E-class Map View
- Display cards sorted by canonical id.
- Each e-node string uses format `op(arg1, arg2, …)` with child ids resolved through union-find to ensure canonical display.
- Show metadata chips: `★` for canonical, `W` badge if e-class is currently in worklist.
- Clicking an e-node selects `{ type: 'enode', id: childId }` and triggers cross-highlighting.

### 3.3 Union-Find View
- Visualize mapping table with canonical ids grouped. Non-canonical ids point to their representative via arrows (SVG or CSS arrows).
- Active styling:
  - `selected` id → accent background.
  - Ids changed since previous state → pulse background once.

### 3.4 Worklist View
- Shows queue order as chips. Top entry marked with “next”.
- Empty state = green “invariants restored” message.
- When playing, auto-scroll to keep highlighted worklist entries in view.

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
- Graph pane should virtualize nodes if count exceeds 250 (use `@xyflow/svelte` viewports + hidden classes).
- State panes rely on snapshots; avoid recomputing heavy derived data by memoizing on `state.id`.
- Animations should be CSS-based (transition/animation) to stay off the JS main thread during scrubbing.

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
