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

### 2.1 E-Node Component (`<ENode />`)
A unified, context-aware component that renders an E-Node or E-Class ID.

#### Props
- `id`: `ENodeId` (Required) - The ID of the E-Node/E-Class to render.
- `variant`: `'default' | 'ghost' | 'active'` (Optional) - Overrides the derived state.
- `mode`: `'id' | 'symbol'` (Optional) - Explicitly force a mode. If undefined, defaults to `'id'` unless the component is used in a context that implies symbol view (e.g. E-Class body). *Actually, let's make it smarter: The component can check if the ID corresponds to a Canonical Class ID or a specific E-Node ID if we distinguish them. But currently `ENodeId` and `EClassId` are just numbers.*
*Refinement*: To support the user's request, we need a way to know *which* E-Node structure to render for a given ID if that ID represents a Class (which has multiple nodes).
*Correction*: The user asked: "if we could just fetch the e-node from the timelineState given the id".
If `id` refers to an E-Class, it has *many* nodes.
If `id` refers to a specific E-Node (hashcons), it has *one* structure.
In the `EGraphState`, `eclasses` maps `EClassId -> ENode[]`.
So if we pass an `EClassId`, we can't know *which* symbol to show unless we are iterating over the class.
*However*, the user might be thinking of the *Hashcons* view where `ENode -> ID`.
Or maybe they want to pass `(EClassId, index)` to uniquely identify an E-Node?
Let's look at `types.ts` again. `EClassViewModel` has `nodes: Array<{ op, args }>`.
So an E-Node is identified by `(classId, index)`.
Or we can pass the `ENode` structure itself if it's ephemeral (like in a list).
*But* the user said "fetch the e-node from the timelineState given the id".
This implies stable IDs for *individual* E-Nodes.
Currently `ENodeId` is just `number`. In `runtime`, `addEnode` returns an ID.
If we use `hashcons`, every unique `ENode` structure has a stable ID.
So yes, `id` *should* uniquely map to an `{ op, args }` structure if we look it up in the `hashcons` or a global node registry.
*Current Implementation*: `EGraphState` has `hashcons: Array<{ key, canonical }>`. It doesn't explicitly store `ID -> {op, args}` map for *all* nodes, but `eclasses` contains the grouped nodes.
To support "ID -> Node" lookup, we might need a helper or a map in the state.
*Decision*: I will assume we can implement a helper `getENode(state, id)` that finds the node structure. If `id` is a Class ID, it might return the *representative* node or we might need to be specific.
*Actually*, in an E-Graph, "E-Node ID" usually *is* the "E-Class ID" it belongs to (after canonicalization).
But physically, `f(a)` and `f(b)` might be different nodes that merge into the same class.
If the user wants to render a specific *structure* `f(a)` using just an ID, that ID must be unique to that structure (the "Hashcons ID").
If the system uses Hashcons IDs as the primary keys, then yes, `ID -> Structure` is stable.
I will update the spec to say:
- `id`: The Hashcons ID of the node.
- The component looks up `{ op, args }` from the state using this ID.
- If the ID represents a Class (canonical), it might show the representative?
Let's stick to:
- `id`: `number`
- `structure`: `ENode` (Optional). If provided, use it. If not, try to look it up.
*Wait*, the user specifically asked to *avoid* passing the node.
"shouldn't we be able to always assume the id-e-node relation is stable"
Yes, if we track it.
I will update the spec to use `id` primarily, and fetch structure from a new `nodeRegistry` or similar in the state if needed, or just iterate to find it (slow).
Better: Ensure `EGraphState` has a `nodes` map or we can derive it.
For now, let's assume we can look it up.

#### Props
- `id`: `ENodeId` (Required)
- `mode`: `'id' | 'symbol'` (Default: 'id') - 'id' shows the diamond. 'symbol' shows the box content.
- `variant`: `'default' | 'ghost' | 'active'` (Optional)

#### Modes
1.  **ID Mode** (Default):
    -   **Visual**: A colored "pill" or "diamond" containing the ID.
    -   **Color**: Derived from `id`.
2.  **Symbol Mode** (Explicit `mode="symbol"`):
    -   **Visual**: A container displaying the `op` string, followed by a list of arguments rendered as **ID Mode** E-Nodes.
    -   **Data**: Fetches `{ op, args }` corresponding to `id` from the current state.
    -   **Layout**: `op` + `(` + `arg0` + `,` + `arg1` + ... + `)`

#### Visual States (Derived)
The component automatically subscribes to `interactionStore` and `timelineStore` to determine its look:
-   **Base**:
    -   Background: White (Symbol) or Light Color (ID).
    -   Border: Thin Grey (Symbol) or None (ID).
-   **Active** (Modified in current step):
    -   *Trigger*: ID is in `step.diffs` (created/merged) or `step.matches` (read phase).
    -   *Visual*: High-contrast border, slightly elevated shadow.
-   **Hovered** (User hovering this ID anywhere):
    -   *Trigger*: `interactionStore.hover.id === id`.
    -   *Visual*: Light Blue highlight/glow.
-   **Selected** (User clicked this ID):
    -   *Trigger*: `interactionStore.selection.id === id`.
    -   *Visual*: Solid Blue border, Blue background tint.
-   **Ghost** (Merged/Stale):
    -   *Trigger*: ID is not canonical in the current state.
    -   *Visual*: Greyed out, dashed border, reduced opacity.

#### Interaction
-   **Click**: Calls `interactionStore.select(id)`.
-   **Hover**: Calls `interactionStore.hover(id)`.

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
Scrollable column visualizing internal structures with 2 sub-sections: Hashcons, and E-Classes

### 5.1 Hashcons View
- **Purpose**: **Canonical Node Registry**. Maps unique node structures to their assigned E-Class IDs.
- **Visuals**: List of `Canonical E-Node (Symbol Box) → E-Class ID (Diamond)` pairs.
  - *Clarification*: This view confirms that identical nodes (e.g., `f(a)` and `f(a)`) map to the same ID.
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
- **Interaction**: Clicking a worklist chip highlights the corresponding E-Class in the Map.
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
