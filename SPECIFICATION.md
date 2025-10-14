# Specification

This is a animated interactive visualization built using Svelte 5 of the paper [egg: Fast and Extensible Equality Saturation](./egraphs-good.pdf).

## Features
 - Multi-Pane View
   - **Graph Pane**
   - **State Pane**
     - Hashcons (list of e-nodes mapped to node id)
     - e-class map (canonical e-node ids map to lists e-node structures)
     - Union find (lists of e-nodes-ids mapping to the canonical one)
   - **Controller & Preset Selector**

### Data model

The following is a data model for the program, developed from the egg paper's data model as well as taking into account potential extra data for interactive visualization.

*Note: the egg paper uses the term e-class-id to refer to the canonical node-id, we just use 'canonical e-node-id` here*.

 - e-node-id (`type ENodeId = number`): Opaque identifier
   - A canonical e-node-id is one where `find(id) === id` (at the top of union-find)

 - e-node (`type ENode`): A function symbol with e-node-id children
   - `op: string` - operation/function symbol (e.g., '+', '*', 'a', '2')
   - `args: number[]` - array of e-node-ids that are arguments. empty if leaf/constant.

 - e-class (`type EClass`): An equivalence class of e-nodes.
   - `nodes: ENode[]` - list of equivalent e-nodes in this class
   - `parents: Set<{enode: ENode, parent_id: ENodeId}>` - parent list tracking which e-nodes have this e-class as a child (needed for congruence maintenance)
   - `data?: any` - optional e-class analysis data (e.g., constant values, free variables, etc.)

 - Union-Find (`UnionFind<ENodeID>`): Array-based union-find data structure - Use https://www.npmjs.com/package/union-find
   - Provides `find`, and merge (`link`)

 - E-class Map (`Map<ENodeID, EClass>`): Maps canonical e-node-ids to their e-classes.
   - `Map` provides `get(node-id: ENodeID) -> EClass`

 - Hashcons (`Map<string, ENodeId>`): Fast lookup from canonical e-node to its canonical e-node-id.
   - Maps canonical e-nodes to their e-class IDs
   - **Canonicalization is critical**: before hashing, must call `find()` on all children
   - `canonicalize(enode)` - returns `{op: enode.op, args: enode.args.map(find)}`
   - Lookup: `get(canonicalize(enode)) -> ENodeId | undefined`

 - Worklist (`Set<ENodeId>`): Tracks e-classes that need congruence repair during rebuilding.
   - E-classes are added to worklist when merged
   - Worklist is processed during `rebuild()` to restore invariants

**E-graph Structure**: The complete e-graph is the tuple `(UnionFind, EClassMap, Hashcons, Worklist)`.

Operations:
 - `find(id: ENodeId) -> ENodeId` - Canonicalizes an e-node-id using union-find
   - Returns the canonical representative of the equivalence class

 - `add(enode: ENode) -> ENodeId` - Adds an e-node to the e-graph
   - First canonicalizes the e-node: `canonical = canonicalize(enode)`
   - Checks hashcons: if already exists, return existing id
   - Otherwise: create new singleton e-class, update hashcons, add parent links
   - Returns the e-node-id (e-class-id) containing this e-node

 - `merge(id1: ENodeId, id2: ENodeId) -> ENodeId` - Unions two e-classes
   - Uses union-find to merge the equivalence classes
   - Combines the e-class data (nodes, parents, analysis data)
   - Adds the merged e-class to the worklist for later congruence repair
   - Does NOT immediately restore invariants (deferred to rebuild)
   - Returns the canonical id of the merged class

 - `rebuild()` - Restores e-graph invariants (congruence and hashcons)
   - Processes worklist, calling `repair()` on each e-class
   - Continues until worklist is empty
   - After rebuild, all invariants are restored

 - `repair(eclass_id: ENodeId)` - Repairs a single e-class
   - Updates hashcons entries for parent e-nodes
   - Finds congruent parent e-nodes and merges their e-classes
   - May add new e-classes to worklist if parents are merged

**E-graph Invariants** (maintained by `rebuild()`):
 1. **Congruence Invariant**: If `f(a₁, ..., aₙ)` and `f(b₁, ..., bₙ)` are e-nodes and `aᵢ ≡ bᵢ` for all i (i.e., `find(aᵢ) = find(bᵢ)`), then both e-nodes must be in the same e-class.
 2. **Hashcons Invariant**: Every canonical e-node in the e-graph must be in the hashcons, mapping to its canonical e-class-id.
 3. **Uniqueness**: Each distinct e-node appears in exactly one e-class.

**Note on Deferred Rebuilding**: The key innovation of egg is that invariants are NOT maintained after every `add` or `merge`. Instead, they are restored by calling `rebuild()` at strategic points (e.g., between read and write phases in equality saturation).

### Graph Pane

A self-organizing graph of e-classes each containing e-nodes with arrows pointing
 - Use Svelte Flow.
   - Use ELK for layout with incremental editing.
   - TODO: Figure best layout algorithm for this.
 - TODO: See if this supports animation (e.g. for egraph merging)

### State Pane

The state pane (right side of the app) will contain a scrollable view with the sections below.

The basic components of these sections are as follows. Some of these come in an active and inactive mode.
 - A e-node ID, a colored diamong containing a number. Can have a yellow star in the top right to denote it being a canonical node id (defined by the current state of the union-find).
   - The color of the box is a random hue seeded by the e-node-id number.
 - A e-node renders as a symbol, e.g. '*', '/' 'add', '2', 'a', and 0 or more e-node ids enclosed in parentheses (if 0 associated e-nodes, there are no parens)
   - These render in a transparent box with rounded corners.
   - Active: black, with white background, Inactive: dark grey stroke and lighter grey background.
 - An e-class is a box inline list of e-nodes.
   - The box is transparent and has dotted lines around it.
   - Active: black, Inactive: grey
 - An arrow maps one of the components here to another.
   - Active: black, Inactive: grey.
   - Activeness for arrows depend on the view.
     - Hashcons: if 

#### Hashcons View

This section contains a list of arrow components mapping e-nodes to their associated e-node ids. The components are described above. When clicking on an e-node, if it is a canonical e-node, it should highlight the corresponding canonical e-node-id in the e-class-map view. Otherwise it should highlight the corresponding e-node-id in the union-find view.

#### E-class Map View

This is a block list of canonical e-node-ids (e.g. e-class-ids) to boxes that contain e-nodes. Each e-class displays:
 - Its canonical e-node-id (with star)
 - The list of e-nodes in this class
 - (Optional) Analysis data attached to the e-class
 - (Optional) Visual indicator if this e-class is in the worklist

#### Union-Find View

Displays the union-find structure showing which e-node-ids map to which canonical representatives. Non-canonical ids point to their canonical id with arrows.

#### Worklist View

Shows which e-classes are currently in the worklist awaiting congruence repair. These are the e-classes that will be processed during the next `rebuild()` call.
 - Highlights e-classes in red/orange if they're in the worklist
 - Shows empty when worklist is empty (invariants are restored)