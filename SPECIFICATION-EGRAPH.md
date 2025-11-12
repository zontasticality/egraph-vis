# E-graph Implementation Specification

This document specifies the e-graph implementations for equality saturation based on the [egg paper](https://arxiv.org/abs/2004.03082). The implementation provides two variants of e-graphs with different rebuilding strategies, along with supporting data structures and test requirements. The purpose of this implementation is to enable the easy visualization of the process behind the two different algorithms via Svelte.

## Overview

The system implements e-graphs (equivalence graphs), a data structure for efficiently representing and manipulating equivalence relations over terms. Two implementation strategies are required:

1. **Naive E-graph**: Maintains all invariants immediately after every operation
2. **Deferred E-graph**: Defers invariant maintenance until an explicit rebuild operation

Both implementations must maintain identical semantics while differing in performance characteristics and hook-ins to track the progress of the algorithm visually.

---

## Data Model

### Core Types

**E-node ID** (`ENodeId`):
- Opaque numeric identifier for e-nodes
- A canonical e-node ID is one where `find(id) = id`
- **Terminology note**: We use "canonical e-node ID" to refer to the representative of an e-class, rather than "e-class ID". This is clearer because:
  - Every e-node has an ID (whether canonical or not)
  - Multiple e-node IDs can point to the same e-class via union-find
  - The canonical ID of an e-class may change during union operations
  - An e-class is accessed via its canonical e-node ID in the e-class map

**E-node** (`ENode`):
- Represents a function application with children
- Contains:
  - `op`: String operation symbol (e.g., '+', '*', 'a', '2')
  - `args`: Array of e-node IDs representing children (empty for constants/variables)

**E-class** (`EClass`):
- An equivalence class of e-nodes
- Contains:
  - `id`: Canonical e-node ID for this class
  - `nodes`: List of equivalent e-nodes in this class
  - `parents`: Map from string keys to parent information (which e-nodes reference this e-class as a child)
  - `data` (optional): E-class analysis data for domain-specific reasoning

**Parent Information** (`ParentInfo`):
- Tracks which e-nodes use a given e-class as a child
- Contains:
  - `enode`: The parent e-node
  - `parent_id`: The e-class ID containing this parent

### Data Structures

An e-graph consists of four core data structures:

**Union-Find**:
- Disjoint set data structure tracking equivalence classes
- Must implement:
  - Path compression for efficient lookup
  - Union by rank for balanced trees
  - `makeSet(id)`: Create singleton set
  - `find(id)`: Return canonical representative
  - `union(id1, id2)`: Merge two sets, return new canonical ID
- Provides O(α(n)) amortized operations where α is inverse Ackermann

**E-class Map**:
- Mapping from canonical e-node IDs to their e-classes
- Key: Canonical e-node ID
- Value: Complete e-class structure

**Hashcons** (Hash Consing Table):
- Maps canonical e-nodes (as strings) to their canonical e-node IDs
- Enables deduplication: checking if an e-node already exists
- **Critical requirement**: E-nodes must be canonicalized before hashing
- Canonicalization process:
  1. For each child ID in the e-node, replace with its canonical ID via `find()`
  2. Generate string key from canonicalized e-node

**Worklist** (Deferred implementation only):
- Set of e-class IDs that need congruence repair
- E-classes added when merged
- Processed during `rebuild()` operation
- Should use set semantics to avoid duplicate work

### Parent Tracking

Parent pointers must be stored as a map rather than a set because:
- JavaScript/TypeScript Sets use reference equality
- Structurally equal `ParentInfo` objects are not reference-equal
- Map keys should be strings derived from parent information
- Key format: `"{parent_id}:{canonical_enode_string}"`

---

## Operations

### Core Operations

**find(id: ENodeId) → ENodeId**:
- Returns the canonical representative of an e-class
- Delegates to union-find structure
- Complexity: O(α(n)) amortized

**add(node: ENode) → ENodeId**:
- Adds an e-node to the e-graph
- Procedure:
  1. Canonicalize the e-node (replace all child IDs with canonical IDs)
  2. Check hashcons with canonicalized e-node
  3. If exists: return existing canonical ID
  4. If new:
     - Allocate fresh e-node ID
     - Create singleton e-class containing this e-node
     - Add e-class to e-class map
     - Update hashcons with new mapping
     - Add parent pointers to all child e-classes
  5. Return e-class ID
- Complexity: O(1) amortized with hashcons

**merge(id1: ENodeId, id2: ENodeId) → ENodeId**:
- Merges two e-classes
- Behavior differs between implementations (see below)
- Returns canonical ID of merged class
- Must handle self-merge (id1 = id2) as no-op

**rebuild()** (Deferred only):
- Restores all e-graph invariants
- Processes worklist until empty
- Naive implementation: no-op (invariants always valid)

### Implementation-Specific Behavior

**Naive Implementation**:

`merge(id1, id2)`:
1. Perform union-find merge
2. Combine e-class data (nodes, parents)
3. **Immediate upward merging**:
   - Group all parents by their canonicalized form
   - For each group with multiple parents, recursively merge them
   - Update hashcons for all affected parents
4. Return canonical ID

**Deferred Implementation**:

`merge(id1, id2)`:
1. Perform union-find merge
2. Combine e-class data (nodes, parents)
3. Add merged e-class to worklist
4. Return canonical ID (invariants NOT restored)

`rebuild()`:
1. While worklist non-empty:
   - Extract all e-class IDs from worklist
   - Clear worklist
   - For each extracted ID, call `repair(id)`
2. After completion, all invariants restored

`repair(eclass_id)`:
1. Get canonical e-class
2. Group all parents by canonicalized form
3. Remove outdated hashcons entries
4. For each group:
   - If multiple parents with same canonical form, merge their e-classes
   - Update hashcons with canonical parent → canonical e-class mapping
5. Merges triggered by repair add to worklist (processed in next iteration)

---

## Invariants

The e-graph must maintain three critical invariants:

### 1. Congruence Invariant

**Statement**: If two e-nodes `f(a₁, ..., aₙ)` and `f(b₁, ..., bₙ)` exist in the e-graph, and `find(aᵢ) = find(bᵢ)` for all i (i.e., all corresponding children are in the same e-class), then both e-nodes must be in the same e-class.

**Example**: If `a ≡ b` (in same e-class), then `f(a) ≡ f(b)` (congruence property).

**Checking procedure**:
- For each pair of e-nodes with the same operator and argument count
- Canonicalize both e-nodes
- If canonicalized forms are identical but e-nodes are in different e-classes → violation

TODO: Is this checking procedure correct? Isn't this kinda inefficient? I imagine in practice this is what the worklist/rebuild is for after a rewrite for propagation. Is there a way to make tracking the status of this invariant more efficient? For UI, how might we convey to a user where exactly the invariant is being broken in the datastructure?

### 2. Hashcons Invariant

**Statement**: Every canonical e-node in the e-graph must appear in the hashcons table, mapping to its canonical e-class ID.

**Checking procedure**:
- For each e-class and each e-node in that class:
  - Canonicalize the e-node
  - Look up in hashcons
  - Verify mapping exists and points to correct canonical e-class

### 3. Uniqueness Invariant

**Statement**: Each distinct canonical e-node appears in exactly one e-class.

**Enforcement**: The `add()` operation checks hashcons before creating new e-classes.

### Invariant Maintenance

**Naive implementation**: Invariants valid after every operation (worklist always empty)

**Deferred implementation**:
- Invariants may be violated after `merge()`
- Must call `rebuild()` to restore invariants
- Provides `invariantsValid` getter to check status

---

## Reactivity Requirements

NOTE: How might this egraph implementation be made compatible with Svelte 5 runes for visualization purposes? Should metadata like selection data be held in the egraph? In an associated data structure? Should the EGraph be made generic?

---

## History Tracking

NOTE: Based on your knowledge, what is the best strategy for doing history tracking of data structures? What's the most elegant/generic way you can think of to do this? What's the dead-simplest way?

## Pattern Matching & Rewrites

The system should support basic pattern matching for equality saturation:

### Pattern Language

**Pattern Variables**:
- Identifiers starting with '?' represent pattern variables (e.g., `?x`, `?y`)
- Pattern variables match any e-node or e-class
- Same variable must match same e-class within a pattern

**Patterns**:
- E-nodes where operator or children may be variables
- Example: `+(0, ?x)` matches any addition with 0 as first argument

### E-matching

**Pattern Matching**:
- Match a pattern against an e-node
- Return substitution (mapping from pattern variables to e-class IDs)
- Return undefined if no match

**E-matching** (pattern matching in e-graphs):
- Find all e-nodes in the e-graph matching a pattern
- Return list of (substitution, e-class ID) pairs
- Must search all e-classes and all e-nodes within each class

### Rewrites

**Rewrite Rule**:
- Named transformation with left-hand side (LHS) and right-hand side (RHS) patterns
- Example: `"add-zero": +(0, ?x) → ?x`

**Applying a Rewrite**:
1. E-match LHS pattern against e-graph
2. For each match with substitution σ:
   - Apply substitution to RHS pattern
   - Add resulting e-node to e-graph
   - Merge resulting e-class with matched e-class

**Equality Saturation**:
- Apply set of rewrite rules until no more matches (saturation)
- Algorithm:
  1. **Read phase**: Find all matches for all rewrites
  2. **Write phase**: Apply all matches (add RHS, merge with LHS)
  3. **Rebuild phase**: Call rebuild() (deferred only)
  4. Repeat until no matches found in read phase
- Limit iterations to prevent infinite loops

## Error Handling

**Invalid Operations**:
- `find(id)` where id not in union-find: Throw error with descriptive message
- Attempt to use e-node ID before calling `makeSet`: Throw error
- Operations on cleared/empty e-graph: Return sensible defaults (e.g., empty arrays)

**Consistency Checks**:
- Provide `checkCongruenceInvariant()` method returning violations
- Provide `checkHashconsInvariant()` method returning boolean
- Debug mode with verbose violation reporting

---

NOTE: I think the implementation notes should be integrated into the documentation above.

## Implementation Notes

### Parent Pointer Management

- Parents stored as `Map<string, ParentInfo>` not `Set<ParentInfo>`
- Key format: `"{parent_id}:{canonical_key(enode)}"`
- This avoids reference equality issues with JavaScript Sets

### Worklist Optimization

- Use Set for automatic deduplication
- Extract and clear in one step (avoid concurrent modification)
- Process all extracted items before checking worklist again

### Canonicalization

- Always canonicalize before hashing
- Cache canonicalized forms if performance critical
- Helper: `canonicalKey(enode)` produces string representation

### Testing Strategy

- Test naive and deferred separately for unit tests
- Test equivalence between implementations in integration tests
- Use small, manually verifiable examples in tests
- Use larger random graphs for performance tests
