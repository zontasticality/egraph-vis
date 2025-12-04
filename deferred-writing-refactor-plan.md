# Deferred Writing Refactoring Plan

## Overview

Refactor the engine to enable true deferred writing in deferred mode, where:
- **Read phase**: Processes e-classes in parallel batches on a **stable graph**, collecting matches without mutation
- **Write phase**: Consumes writelist sequentially, instantiating RHS patterns and applying merges

This is faithful to the egg paper's deferred mode: search on a stable graph, then mutate.

## Architecture

```
DEFERRED MODE:
┌─────────────────────────────────────────────────────────────┐
│ READ PHASE (Parallelized Batching - PURE, NO MUTATION)     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│  │ Batch 1    │→ │ Batch 2    │→ │ Batch 3    │ ...       │
│  │ (N eclasses)  │ (N eclasses)  │ (N eclasses)           │
│  │ - Match LHS │  │ - Match LHS │  │ - Match LHS │         │
│  │ - Record    │  │ - Record    │  │ - Record    │         │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘           │
│        │                │                │                   │
│        └────────────────┴────────────────┘                   │
│                         ↓                                     │
│                   WRITELIST                                   │
│        [(rule, subst, target), (rule, subst, target), ...]  │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ WRITE PHASE (Sequential Consumption - MUTATES)              │
│  For each entry:                                             │
│    1. Instantiate RHS from pattern + substitution            │
│    2. Re-canonicalize target and new IDs                     │
│    3. Merge → snapshot → repeat                              │
└─────────────────────────────────────────────────────────────┘

NAIVE MODE (unchanged):
  Read → Write/Rebuild → Read → Write/Rebuild → ...
```

## Current Bugs to Fix

### Bug 1: `collectMatchesGen` accumulates matches
**Location**: `src/lib/engine/algorithms.ts:138-164`

```typescript
export function* collectMatchesGen(
    runtime: EGraphRuntime,
    rules: RewriteRule[],
    parallelism: number = 1
): Generator<Match[]> {
    const allMatches: Match[] = [];  // ⚠️ Accumulates across batches
    let processedCount = 0;
    const eclassArray = Array.from(runtime.eclasses);

    for (const rule of rules) {
        for (const [id, eclass] of eclassArray) {
            const found = matchPattern(runtime, rule.lhs, id);
            for (const substitution of found) {
                allMatches.push({ rule, eclassId: id, substitution });
            }

            processedCount++;

            if (processedCount >= parallelism) {
                yield allMatches.slice(); // ⚠️ Returns ALL matches so far
                processedCount = 0;
            }
        }
    }

    if (processedCount > 0 || allMatches.length > 0) {
        yield allMatches; // ⚠️ Final batch also has everything
    }
}
```

**Issue**: Returns cumulative matches instead of batch-local matches.

### Bug 2: Read phase overwrites matches
**Location**: `src/lib/engine/timeline.ts:62-73`

```typescript
if (this.options.implementation === 'deferred' && parallelism > 1) {
    const matchGen = collectMatchesGen(this.runtime, this.getRewrites(), parallelism);
    for (const batchMatches of matchGen) {
        allMatches = batchMatches;  // ⚠️ Overwrites, doesn't accumulate
        this.emitSnapshot('read', allMatches);
    }
} else {
    allMatches = collectMatches(this.runtime, this.getRewrites());
    this.emitSnapshot('read', allMatches);
}
```

**Issue**: Loses matches from earlier batches.

---

## Implementation Plan

### Phase 0: Fix Current Bugs (Minimal Changes)

Fix the two bugs with minimal, code-aligned changes first.

#### Step 0.1: Fix `collectMatchesGen` to yield batch-local matches

**File**: `src/lib/engine/algorithms.ts`

**Change lines 138-164**:

```typescript
export function* collectMatchesGen(
    runtime: EGraphRuntime,
    rules: RewriteRule[],
    parallelism: number = 1
): Generator<Match[]> {
    let processedCount = 0;
    const eclassArray = Array.from(runtime.eclasses);

    // Batch-local matches only
    let batchMatches: Match[] = [];

    for (const rule of rules) {
        for (const [id, eclass] of eclassArray) {
            const found = matchPattern(runtime, rule.lhs, id);
            for (const substitution of found) {
                batchMatches.push({ rule, eclassId: id, substitution });
            }

            processedCount++;

            if (processedCount >= parallelism) {
                // Yield batch-local matches, then reset
                yield batchMatches;
                batchMatches = [];
                processedCount = 0;
            }
        }
    }

    // Yield final batch if any remaining
    if (batchMatches.length > 0) {
        yield batchMatches;
    }
}
```

**Test**: Verify generator yields only new matches per batch.

#### Step 0.2: Fix timeline to accumulate matches

**File**: `src/lib/engine/timeline.ts`

**Change line 66**:

```typescript
if (this.options.implementation === 'deferred' && parallelism > 1) {
    const matchGen = collectMatchesGen(this.runtime, this.getRewrites(), parallelism);
    for (const batchMatches of matchGen) {
        allMatches.push(...batchMatches);  // ✅ Accumulate instead of overwrite
        this.emitSnapshot('read', allMatches);
    }
} else {
    allMatches = collectMatches(this.runtime, this.getRewrites());
    this.emitSnapshot('read', allMatches);
}
```

**Test**:
- Load preset with `{ implementation: 'deferred', parallelism: 4 }`
- Verify all matches are preserved across batches
- Verify final match count is correct

---

### Phase 1: Introduce Writelist Architecture

After bugs are fixed, refactor for true deferred writing with pure read phase.

## Data Structure Design

### Writelist Entry

Store match metadata, **not pre-computed nodes** (keep read phase pure):

```typescript
interface WriteListEntry {
    ruleName: string;       // Rule name for diff recording
    rhsPattern: Pattern;    // RHS pattern to instantiate
    targetClass: ENodeId;   // The e-class that matched (will be re-canonicalized)
    substitution: Map<string, ENodeId>;  // Variable bindings (will be re-canonicalized)
    batchId: number;        // Which parallel batch found this
}

interface WriteList {
    entries: WriteListEntry[];
    nextIndex: number;      // Current consumption position
}
```

**Key**: Store only the RHS pattern and rule name (not the entire rule). Instantiate only during write phase.

### Metadata Extensions

```typescript
interface StepMetadata {
    // ... existing fields ...

    // NEW: Deferred mode tracking
    writelist?: WriteList;              // Current writelist state
    currentMatchingNodes?: number[];    // Nodes being matched in current batch
}
```

### Phase Extension

```typescript
phase: 'init' | 'read' | 'read-batch' | 'write' | 'compact' | 'repair' | 'done';
```

New phase `'read-batch'` shows intermediate read progress.

---

## File-by-File Implementation

### 1. `src/lib/engine/types.ts`

**Add new interfaces** (after line 133):

```typescript
export interface WriteListEntry {
    ruleName: string;       // Rule name for diff recording
    rhsPattern: Pattern;    // RHS pattern to instantiate
    targetClass: ENodeId;   // E-class from the match (needs re-canonicalization)
    substitution: Map<string, ENodeId>;  // Variable bindings (need re-canonicalization)
    batchId: number;        // Batch that discovered this
}

export interface WriteList {
    entries: WriteListEntry[];
    nextIndex: number;      // Consumption pointer for write phase
}
```

**Update `StepMetadata`** (line 89):

```typescript
export interface StepMetadata {
    diffs: DiffEvent[];
    matches: MatchEvent[];
    invariants: {
        congruenceValid: boolean;
        hashconsValid: boolean;
    };
    selectionHints: Array<{ type: 'eclass' | 'enode' | 'hashcons'; id: number | string }>;
    haltedReason?: 'saturated' | 'iteration-cap' | 'canceled';
    timestamp?: number;
    activeId?: number;

    // NEW: Deferred mode fields
    writelist?: WriteList;
    currentMatchingNodes?: number[];
}
```

**Update `EGraphState` phase** (line 68):

```typescript
phase: 'init' | 'read' | 'read-batch' | 'write' | 'compact' | 'repair' | 'done';
```

---

### 2. `src/lib/engine/algorithms.ts`

**Export Match interface** (currently at line 6):

```typescript
export interface Match {
    rule: RewriteRule;
    eclassId: ENodeId;
    substitution: Map<string, ENodeId>;
}
```

**Add batch result interface**:

```typescript
export interface MatchBatchResult {
    matches: Match[];       // Batch-local matches only
    batchId: number;
    matchingNodeIds: number[];  // Nodes involved in matches (for highlighting)
}
```

**Refactor `collectMatchesGen`** (replace bug-fixed version):

```typescript
/**
 * Generator version that yields periodically to allow snapshots during long searches.
 * In deferred mode with parallelism > 1, simulates parallel search by batching e-classes.
 *
 * IMPORTANT: Read phase is PURE - does not mutate the graph.
 * Returns matches with RHS patterns to be instantiated later in write phase.
 */
export function* collectMatchesGen(
    runtime: EGraphRuntime,
    rules: RewriteRule[],
    parallelism: number = 1
): Generator<MatchBatchResult> {
    const eclassArray = Array.from(runtime.eclasses);
    let batchId = 0;
    let processedCount = 0;

    let batchMatches: Match[] = [];
    let batchNodeIds: Set<number> = new Set();

    for (const rule of rules) {
        if (!rule.enabled) continue;

        for (const [id, eclass] of eclassArray) {
            // Find matches for this rule in this e-class
            const found = matchPattern(runtime, rule.lhs, id);

            for (const substitution of found) {
                batchMatches.push({
                    rule,
                    eclassId: id,
                    substitution
                });

                // Collect matching node IDs for visualization
                // Use existing logic (will be shared with timeline.collectMatchedNodes)
                const matchedNodes = collectMatchingNodes(runtime, rule.lhs, id);
                matchedNodes.forEach(nodeId => batchNodeIds.add(nodeId));
            }

            processedCount++;

            // Yield after processing 'parallelism' e-classes
            if (processedCount >= parallelism) {
                if (batchMatches.length > 0 || batchNodeIds.size > 0) {
                    yield {
                        matches: batchMatches,
                        batchId: batchId++,
                        matchingNodeIds: Array.from(batchNodeIds)
                    };
                    batchMatches = [];
                    batchNodeIds = new Set();
                }
                processedCount = 0;
            }
        }
    }

    // Yield final batch if any remaining
    if (batchMatches.length > 0 || batchNodeIds.size > 0) {
        yield {
            matches: batchMatches,
            batchId: batchId++,
            matchingNodeIds: Array.from(batchNodeIds)
        };
    }
}
```

**Extract and export matching node collection** (consolidate with timeline.ts logic):

```typescript
/**
 * Collect node IDs that match a pattern for visualization highlighting.
 * Shared logic between algorithms and timeline for consistency.
 */
export function collectMatchingNodes(
    runtime: EGraphRuntime,
    pattern: Pattern | number,
    eclassId: ENodeId
): Set<number> {
    const matchedNodeIds = new Set<number>();
    const canonicalId = runtime.find(eclassId);
    const eclass = runtime.eclasses.get(canonicalId);
    if (!eclass) return matchedNodeIds;

    // Variable pattern: match all nodes in e-class
    if (typeof pattern === 'string' && pattern.startsWith('?')) {
        for (const nodeId of eclass.nodes) {
            matchedNodeIds.add(nodeId);
        }
        return matchedNodeIds;
    }

    // Structural pattern: match specific nodes
    if (typeof pattern === 'object' && 'op' in pattern) {
        for (const nodeId of eclass.nodes) {
            const node = runtime.nodes[nodeId];
            if (node && node.op === pattern.op) {
                matchedNodeIds.add(nodeId);
                // Recursively collect from arguments
                pattern.args.forEach((argPattern, index) => {
                    if (index < node.args.length) {
                        const childMatches = collectMatchingNodes(
                            runtime,
                            argPattern,
                            node.args[index]
                        );
                        childMatches.forEach(id => matchedNodeIds.add(id));
                    }
                });
            }
        }
    } else if (typeof pattern === 'string') {
        // Constant pattern
        for (const nodeId of eclass.nodes) {
            const node = runtime.nodes[nodeId];
            if (node && node.op === pattern && node.args.length === 0) {
                matchedNodeIds.add(nodeId);
            }
        }
    }

    return matchedNodeIds;
}
```

---

### 3. `src/lib/engine/timeline.ts`

**Update imports** (line 3):

```typescript
import {
    rebuild,
    collectMatches,
    collectMatchesGen,
    applyMatches,
    applyMatchesGen,
    rebuildGen,
    collectMatchingNodes,  // NEW: import shared function
    type Match             // NEW: import type
} from './algorithms';
```

**Update type imports** (line 6):

```typescript
import type {
    EGraphEngine,
    EGraphTimeline,
    EGraphState,
    PresetConfig,
    EngineOptions,
    EClassViewModel,
    StepMetadata,
    Pattern,
    ENodeId,
    WriteList,          // NEW
    WriteListEntry      // NEW
} from './types';
```

**Refactor `runUntilHalt` method** (replace lines 52-144):

```typescript
async runUntilHalt(): Promise<EGraphTimeline> {
    let iteration = 0;
    const cap = this.options.iterationCap ?? 100;

    while (iteration < cap) {
        const parallelism = this.options.parallelism ?? 1;

        if (this.options.implementation === 'deferred') {
            // ═══════════════════════════════════════════════════════
            // DEFERRED MODE: Fully Separated Read → Write
            // ═══════════════════════════════════════════════════════

            // --- READ PHASE: Build writelist (PURE - no mutation) ---
            const writelist: WriteList = { entries: [], nextIndex: 0 };
            const allMatches: Match[] = [];  // Track all matches for highlighting

            const matchGen = collectMatchesGen(
                this.runtime,
                this.getRewrites(),
                parallelism
            );

            for (const batchResult of matchGen) {
                // Add matches to writelist with batch tracking
                for (const match of batchResult.matches) {
                    writelist.entries.push({
                        rule: match.rule,
                        targetClass: match.eclassId,
                        substitution: match.substitution,
                        batchId: batchResult.batchId
                    });
                }

                // Accumulate all matches for visualization
                allMatches.push(...batchResult.matches);

                // Emit snapshot showing batch progress
                this.emitSnapshot('read-batch', allMatches, undefined, {
                    writelist: this.cloneWritelist(writelist),
                    currentMatchingNodes: batchResult.matchingNodeIds
                });
            }

            // Final read snapshot with complete writelist
            this.emitSnapshot('read', allMatches, undefined, {
                writelist: this.cloneWritelist(writelist),
                currentMatchingNodes: []
            });

            if (writelist.entries.length === 0) {
                this.timeline.haltedReason = 'saturated';
                break;
            }

            // --- WRITE PHASE: Consume writelist sequentially (MUTATES) ---
            for (let i = 0; i < writelist.entries.length; i++) {
                const entry = writelist.entries[i];

                // Re-canonicalize substitution (may have changed from earlier merges)
                const canonicalSubst = new Map<string, ENodeId>();
                for (const [varName, id] of entry.substitution) {
                    canonicalSubst.set(varName, this.runtime.find(id));
                }

                // Instantiate RHS pattern NOW (write phase only)
                const newId = instantiatePattern(
                    this.runtime,
                    entry.rule.rhs,
                    canonicalSubst
                );

                // Re-canonicalize target (may have changed from earlier merges)
                const target = this.runtime.find(entry.targetClass);
                const actualNewId = this.runtime.find(newId);

                // Deduplication: skip if already equal
                if (target !== actualNewId) {
                    this.runtime.merge(target, actualNewId, 'deferred', this.rng);

                    // Record the rewrite diff
                    this.runtime.diffs.push({
                        type: 'rewrite',
                        rule: entry.rule.name,
                        targetClass: target,
                        createdId: actualNewId,
                        mergedInto: this.runtime.find(target)
                    });
                }

                // Update writelist consumption pointer
                writelist.nextIndex = i + 1;

                // Emit snapshot showing write progress
                // IMPORTANT: Pass allMatches to preserve LHS highlighting
                this.emitSnapshot('write', allMatches, undefined, {
                    writelist: this.cloneWritelist(writelist),
                    currentMatchingNodes: []
                });
            }

            // --- REBUILD PHASE: Compact and Repair ---
            const rebuildIterator = rebuildGen(this.runtime);
            for (const step of rebuildIterator) {
                this.emitSnapshot(step.phase, [], step.eclassId);
            }

        } else {
            // ═══════════════════════════════════════════════════════
            // NAIVE MODE: Interleaved Read-Write (unchanged)
            // ═══════════════════════════════════════════════════════

            const allMatches = collectMatches(this.runtime, this.getRewrites());
            this.emitSnapshot('read', allMatches);

            if (allMatches.length === 0) {
                this.timeline.haltedReason = 'saturated';
                break;
            }

            const applyGen = applyMatchesGen(
                this.runtime,
                allMatches,
                'naive',
                this.rng
            );

            let hasChanges = false;
            for (const _step of applyGen) {
                hasChanges = true;
                this.emitSnapshot('write', allMatches);

                // Rebuild after each write in naive mode
                const rebuildIterator = rebuildGen(this.runtime);
                for (const step of rebuildIterator) {
                    this.emitSnapshot(step.phase, [], step.eclassId);
                }
            }

            if (!hasChanges) {
                this.timeline.haltedReason = 'saturated';
                break;
            }
        }

        iteration++;
    }

    if (iteration >= cap) {
        this.timeline.haltedReason = 'iteration-cap';
    } else if (!this.timeline.haltedReason) {
        this.timeline.haltedReason = 'saturated';
    }

    this.emitSnapshot('done');

    // Compute visual states for all snapshots
    console.log('[Timeline] Computing visual states for all snapshots...');
    for (let i = 0; i < this.timeline.states.length; i++) {
        const state = this.timeline.states[i];
        const visualStates = computeVisualStates(state);
        this.timeline.states[i] = create(state, draft => {
            draft.visualStates = visualStates;
        });
    }

    // Compute layouts progressively
    await layoutManager.precomputeAll(this.timeline);

    return this.timeline;
}
```

**Refactor `collectMatchedNodes` method** (lines 224-268):

Replace with call to shared function:

```typescript
/**
 * Collect all node IDs that match a specific pattern structure.
 * Used for highlighting matched nodes during the read phase.
 */
private collectMatchedNodes(eclassId: number, pattern: Pattern | string | number): Set<number> {
    // Delegate to shared implementation in algorithms.ts
    return collectMatchingNodes(this.runtime, pattern, eclassId);
}
```

**Add helper method** (new method):

```typescript
/**
 * Deep clone writelist for immutable snapshots.
 */
private cloneWritelist(writelist: WriteList): WriteList {
    return {
        entries: writelist.entries.map(e => ({
            ...e,
            substitution: new Map(e.substitution)  // Clone the Map
        })),
        nextIndex: writelist.nextIndex
    };
}
```

**Update `emitSnapshot` method signature** (line 295):

```typescript
private emitSnapshot(
    phase: EGraphState['phase'],
    matches: any[] = [],
    activeId?: number,
    deferredMetadata?: {
        writelist?: WriteList;
        currentMatchingNodes?: number[];
    }
) {
    const prevState = this.timeline.states[this.timeline.states.length - 1];

    // ... existing baseState setup ...

    const nextState = create(baseState, draft => {
        draft.stepIndex++;
        draft.phase = phase;
        draft.id = `${this.currentPresetId}:${draft.stepIndex}`;

        // ... existing unionFind, eclasses, nodeChunks, worklist updates ...

        // Update metadata
        draft.metadata = this.buildMetadata(matches, activeId);

        // Add deferred mode metadata if provided
        if (deferredMetadata) {
            if (deferredMetadata.writelist) {
                draft.metadata.writelist = deferredMetadata.writelist;
            }
            if (deferredMetadata.currentMatchingNodes) {
                draft.metadata.currentMatchingNodes = deferredMetadata.currentMatchingNodes;
            }
        }
    });

    this.timeline.states.push(nextState);

    // Clear diffs for next step
    this.runtime.diffs = [];
}
```

---

### 4. `src/lib/engine/visual.ts`

**Update `computeVisualStates` to handle new phases**:

Find the phase handling logic and add `'read-batch'`:

```typescript
export function computeVisualStates(state: EGraphState): {
    nodes: Map<number, NodeVisualState>;
    eclasses: Map<number, EClassVisualState>;
} {
    const nodeStates = new Map<number, NodeVisualState>();
    const eclassStates = new Map<number, EClassVisualState>();

    // Handle phase-specific styling
    switch (state.phase) {
        case 'init':
            // ... existing logic ...
            break;
        case 'read':
        case 'read-batch':  // NEW: handle read-batch same as read
            // Highlight matched nodes from metadata
            const matchedNodeIds = new Set<number>();
            for (const match of state.metadata.matches) {
                match.nodes.forEach(nodeId => matchedNodeIds.add(nodeId));
            }

            // Also highlight currentMatchingNodes if present (for read-batch)
            if (state.metadata.currentMatchingNodes) {
                state.metadata.currentMatchingNodes.forEach(nodeId => matchedNodeIds.add(nodeId));
            }

            for (const nodeId of matchedNodeIds) {
                // Mark as MatchedLHS
                // ... existing logic ...
            }
            break;
        case 'write':
            // ... existing logic ...
            break;
        // ... other cases ...
    }

    return { nodes: nodeStates, eclasses: eclassStates };
}
```

**Ensure metadata defaults are safe**:

```typescript
// At the top of computeVisualStates
const matches = state.metadata.matches ?? [];
const currentMatchingNodes = state.metadata.currentMatchingNodes ?? [];
const writelist = state.metadata.writelist;  // Optional, check before use
```

---

### 5. Add Regression Test

**Create new test file**: `src/lib/engine/deferred.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { TimelineEngine } from './timeline';
import type { PresetConfig } from './types';

describe('Deferred Mode Writelist', () => {
    it('should not lose matches across batches with parallelism > 1', () => {
        const engine = new TimelineEngine();

        const preset: PresetConfig = {
            id: 'test-deferred',
            label: 'Test Deferred',
            description: 'Test batched matching',
            root: { op: 'add', args: ['?a', '?b'] },
            rewrites: [
                {
                    name: 'comm',
                    lhs: { op: 'add', args: ['?a', '?b'] },
                    rhs: { op: 'add', args: ['?b', '?a'] },
                    enabled: true
                },
                {
                    name: 'assoc',
                    lhs: { op: 'add', args: [{ op: 'add', args: ['?a', '?b'] }, '?c'] },
                    rhs: { op: 'add', args: ['?a', { op: 'add', args: ['?b', '?c'] }] },
                    enabled: true
                }
            ]
        };

        engine.loadPreset(preset, {
            implementation: 'deferred',
            parallelism: 2,  // Force batching
            iterationCap: 5
        });

        const timeline = await engine.runUntilHalt();

        // Find read-batch snapshots
        const readBatchStates = timeline.states.filter(s => s.phase === 'read-batch');
        expect(readBatchStates.length).toBeGreaterThan(0);

        // Find final read snapshot
        const readState = timeline.states.find(s => s.phase === 'read');
        expect(readState).toBeDefined();

        // Verify writelist exists and has entries
        expect(readState!.metadata.writelist).toBeDefined();
        const writelist = readState!.metadata.writelist!;
        expect(writelist.entries.length).toBeGreaterThan(0);

        // Verify writelist is monotonically consumed
        const writeStates = timeline.states.filter(s => s.phase === 'write');
        expect(writeStates.length).toBe(writelist.entries.length);

        for (let i = 0; i < writeStates.length; i++) {
            const writeState = writeStates[i];
            expect(writeState.metadata.writelist).toBeDefined();
            expect(writeState.metadata.writelist!.nextIndex).toBe(i + 1);
        }

        // Verify no matches lost: count matches in all read-batch snapshots
        let totalBatchMatches = 0;
        for (const batchState of readBatchStates) {
            if (batchState.metadata.writelist) {
                totalBatchMatches = Math.max(
                    totalBatchMatches,
                    batchState.metadata.writelist.entries.length
                );
            }
        }

        // Final writelist should have all matches
        expect(writelist.entries.length).toBe(totalBatchMatches);
    });

    it('should preserve LHS highlighting during write phase', () => {
        const engine = new TimelineEngine();

        const preset: PresetConfig = {
            id: 'test-highlighting',
            label: 'Test Highlighting',
            description: 'Test match preservation',
            root: { op: 'f', args: ['x'] },
            rewrites: [
                {
                    name: 'simple',
                    lhs: { op: 'f', args: ['?a'] },
                    rhs: { op: 'g', args: ['?a'] },
                    enabled: true
                }
            ]
        };

        engine.loadPreset(preset, {
            implementation: 'deferred',
            parallelism: 2,
            iterationCap: 5
        });

        const timeline = await engine.runUntilHalt();

        // Find write snapshots
        const writeStates = timeline.states.filter(s => s.phase === 'write');

        for (const writeState of writeStates) {
            // Write snapshots should preserve matches for highlighting
            expect(writeState.metadata.matches.length).toBeGreaterThan(0);
        }
    });

    it('should re-canonicalize before merging in write phase', () => {
        const engine = new TimelineEngine();

        const preset: PresetConfig = {
            id: 'test-recanonicalization',
            label: 'Test Re-canonicalization',
            description: 'Test that write phase re-canonicalizes',
            root: { op: 'add', args: ['a', 'b'] },
            rewrites: [
                {
                    name: 'r1',
                    lhs: 'a',
                    rhs: 'c',
                    enabled: true
                },
                {
                    name: 'r2',
                    lhs: { op: 'add', args: ['?x', 'b'] },
                    rhs: { op: 'add', args: ['?x', 'c'] },
                    enabled: true
                }
            ]
        };

        engine.loadPreset(preset, {
            implementation: 'deferred',
            parallelism: 1,
            iterationCap: 5
        });

        // This should not crash despite 'a' being merged with 'c' before
        // the second rule's write entry is processed
        const timeline = await engine.runUntilHalt();

        expect(timeline.haltedReason).toBeDefined();
    });
});
```

---

## Implementation Order

### Step 0: Fix Current Bugs (Minimal Changes)

1. **Fix `collectMatchesGen`** in `algorithms.ts`
   - Yield batch-local matches only
   - Reset `batchMatches` after each yield

2. **Fix accumulation** in `timeline.ts`
   - Change `allMatches = batchMatches` to `allMatches.push(...batchMatches)`

3. **Test bug fixes**
   - Run existing tests
   - Manually test with `{ implementation: 'deferred', parallelism: 4 }`
   - Verify no matches lost

### Step 1: Update Type Definitions

**File**: `src/lib/engine/types.ts`

- Add `WriteListEntry` interface
- Add `WriteList` interface
- Update `StepMetadata` with optional writelist fields
- Update `EGraphState` phase union type

**Test**: TypeScript compilation succeeds.

### Step 2: Refactor Algorithms (Pure Read Phase)

**File**: `src/lib/engine/algorithms.ts`

- Export `Match` interface
- Add `MatchBatchResult` interface
- Refactor `collectMatchesGen` to return batch results with metadata
- Add and export `collectMatchingNodes` helper function

**Test**: No compilation errors, naive mode still works.

### Step 3: Refactor Timeline Engine

**File**: `src/lib/engine/timeline.ts`

- Update imports
- Split `runUntilHalt` into deferred/naive branches
- Implement pure read phase with writelist accumulation
- Implement write phase with re-canonicalization and instantiation
- Replace `collectMatchedNodes` with call to shared function
- Add `cloneWritelist` helper
- Update `emitSnapshot` signature
- Pass matches through write snapshots for highlighting

**Test**:
- Load preset with `{ implementation: 'naive' }` - unchanged
- Load preset with `{ implementation: 'deferred', parallelism: 4 }`
- Verify writelist builds during read
- Verify no mutations during read phase (graph size unchanged)

### Step 4: Update Visual Integration

**File**: `src/lib/engine/visual.ts`

- Handle `'read-batch'` phase in `computeVisualStates`
- Add safe defaults for new metadata fields
- Ensure `currentMatchingNodes` is used for highlighting

**Test**: Snapshots render correctly for all phases.

### Step 5: Add Regression Tests

**File**: `src/lib/engine/deferred.test.ts`

- Test no matches lost across batches
- Test writelist consumption is monotonic
- Test LHS highlighting preserved in write phase
- Test re-canonicalization works correctly

**Run**: `npm test`

### Step 6: Integration Testing

Test with various configurations:

```javascript
// Low parallelism - more snapshots
loadPreset(preset, { implementation: 'deferred', parallelism: 2 });

// High parallelism - fewer snapshots
loadPreset(preset, { implementation: 'deferred', parallelism: 16 });

// Naive mode - should be unchanged
loadPreset(preset, { implementation: 'naive' });
```

**Verify**:
- ✅ Read phase is pure (no new nodes until write)
- ✅ Writelist grows during read phase
- ✅ Writelist.nextIndex advances during write phase
- ✅ No matches lost between batches
- ✅ Matching nodes highlighted in read-batch snapshots
- ✅ LHS highlighting preserved in write snapshots
- ✅ Re-canonicalization prevents stale ID bugs
- ✅ Final result identical between naive and deferred modes
- ✅ All tests pass

---

## Visual Benefits

### Read Phase Visualization
- See writelist grow as batches complete
- Highlight nodes currently being matched
- Understand parallelism impact (more parallelism = fewer snapshots)
- **Graph remains unchanged during entire read phase**

### Write Phase Visualization
- Watch writelist consumption progress (nextIndex advancing)
- See which batch each merge came from
- Preserve LHS highlighting during writes
- Sequential application makes causality clear

### Parallelism Trade-offs
- **High parallelism** (16-32): Faster read phase, fewer snapshots, less observability
- **Low parallelism** (2-4): Slower read phase, more snapshots, better debugging

---

## Key Design Principles

1. **Pure Read Phase**: No graph mutation during read - faithful to egg paper
2. **Re-canonicalization**: Always re-run `find()` before using IDs in write phase
3. **Shared Logic**: One implementation of `collectMatchingNodes` for consistency
4. **Preserve Context**: Pass matches through write snapshots for highlighting
5. **Incremental Batching**: Yield only new matches per batch, accumulate at timeline level
6. **Safe Defaults**: All new metadata fields are optional, handled safely in visual.ts

---

## Notes

- **Immutability**: Clone writelist (including Maps) for each snapshot
- **Deduplication**: Happens in write phase after instantiation (check target === actualNewId)
- **Performance**: Pure read phase enables future actual parallelism (Web Workers)
- **Compatibility**: Naive mode completely unchanged, zero regression risk
- **Testing**: Comprehensive regression tests ensure correctness
