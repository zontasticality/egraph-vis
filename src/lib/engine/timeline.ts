import { create } from 'mutative';
import { EGraphRuntime, SeededRandom } from './runtime';
import { rebuild, collectMatches, collectMatchesGen, applyMatches, applyMatchesGen, rebuildGen } from './algorithms';
import { computeVisualStates } from './visual';
import { layoutManager } from './layout';
import type {
    EGraphEngine,
    EGraphTimeline,
    EGraphState,
    PresetConfig,
    EngineOptions,
    EClassViewModel,
    StepMetadata,
    Pattern,
    ENodeId
} from './types';
import { ChunkedArray } from '../utils/chunkedArray';

export class TimelineEngine implements EGraphEngine {
    private runtime: EGraphRuntime;
    private timeline: EGraphTimeline;
    private viewModelCache = new Map<number, { version: number, vm: EClassViewModel }>();
    private options: EngineOptions = { implementation: 'deferred', seed: 4 };
    private currentPresetId = '';
    private rng?: SeededRandom; // Seeded RNG for union-find

    constructor() {
        this.runtime = new EGraphRuntime();
        this.timeline = this.createEmptyTimeline();
    }

    loadPreset(preset: PresetConfig, options: EngineOptions): void {
        // Merge options: defaults → preset hints → passed options
        const defaults = { implementation: 'deferred' as const, seed: 1 };
        this.options = { ...defaults, ...preset.implementationHints, ...options };
        this.currentPresetId = preset.id;
        this.rewrites = preset.rewrites; // Store rewrites
        this.runtime = new EGraphRuntime();
        this.viewModelCache.clear();
        this.timeline = this.createEmptyTimeline();

        // Initialize RNG if seed is provided
        this.rng = this.options.seed !== undefined ? new SeededRandom(this.options.seed) : undefined;

        // Initialize root
        this.instantiatePattern(preset.root);

        // Emit initial snapshot
        this.emitSnapshot('init');
    }

    async runUntilHalt(): Promise<EGraphTimeline> {
        let iteration = 0;
        const cap = this.options.iterationCap ?? 100;

        while (iteration < cap) {
            // 1. Read Phase (PARALLELIZABLE - search for matches)
            // Higher parallelism = simulate more parallel search threads = fewer snapshots
            let allMatches: Match[] = [];
            const parallelism = this.options.parallelism ?? 1;

            if (this.options.implementation === 'deferred' && parallelism > 1) {
                // Use generator to show intermediate search progress
                const matchGen = collectMatchesGen(this.runtime, this.getRewrites(), parallelism);
                for (const batchMatches of matchGen) {
                    allMatches = batchMatches;
                    this.emitSnapshot('read', allMatches);
                }
            } else {
                // Sequential search (naive mode or parallelism = 1)
                allMatches = collectMatches(this.runtime, this.getRewrites());
                this.emitSnapshot('read', allMatches);
            }

            if (allMatches.length === 0) {
                this.timeline.haltedReason = 'saturated';
                break;
            }

            // 2. Write Phase (SEQUENTIAL - mutates shared data structures)
            // Apply all matches sequentially
            const applyGen = applyMatchesGen(this.runtime, allMatches, this.options.implementation, this.rng);

            let hasChanges = false;
            for (const _step of applyGen) {
                hasChanges = true;
                this.emitSnapshot('write', allMatches);

                // In naive mode, rebuild after each rewrite
                if (this.options.implementation === 'naive') {
                    const rebuildIterator = rebuildGen(this.runtime);
                    for (const step of rebuildIterator) {
                        // Emit snapshot with the specific phase (compact or repair)
                        // Don't pass matches during rebuild - they're not relevant to rebuild phases
                        this.emitSnapshot(step.phase, [], step.eclassId);
                    }
                }
            }

            if (!hasChanges) {
                this.timeline.haltedReason = 'saturated';
                break;
            }

            // 3. Rebuild Phase (SEQUENTIAL - only for deferred mode)
            // Efficiency comes from amortization (once per iteration) and deduplication (worklist)
            // Naive mode already rebuilt during applyMatchesGen
            if (this.options.implementation === 'deferred') {
                const rebuildIterator = rebuildGen(this.runtime);
                for (const step of rebuildIterator) {
                    // Emit snapshot with the specific phase (compact or repair)
                    // Pass the active e-class ID to highlight just that class
                    this.emitSnapshot(step.phase, allMatches, step.eclassId);
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

        // Compute visual states for all snapshots (Phase 1 of animation system)
        console.log('[Timeline] Computing visual states for all snapshots...');
        for (let i = 0; i < this.timeline.states.length; i++) {
            const state = this.timeline.states[i];
            const visualStates = computeVisualStates(state);
            // Update the state with computed visual states
            this.timeline.states[i] = create(state, draft => {
                draft.visualStates = visualStates;
            });
        }

        // Compute layouts progressively (Phase 2 of animation system)
        // First layout is synchronous, rest are computed in background
        await layoutManager.precomputeAll(this.timeline);

        return this.timeline;
    }

    step(): EGraphState | null {
        throw new Error('Step mode not implemented yet');
    }

    getTimeline(): EGraphTimeline {
        return this.timeline;
    }

    private createEmptyTimeline(): EGraphTimeline {
        return {
            presetId: this.currentPresetId,
            implementation: this.options.implementation,
            states: [],
            haltedReason: 'saturated' // Default, will be updated
        };
    }

    private getRewrites() {
        // In a real app, we'd fetch from the preset config passed to loadPreset.
        // But here I don't store the full preset object, just ID.
        // I should store the rewrites in the class.
        // I'll add `rewrites` to the class.
        return this.rewrites;
    }
    private rewrites: any[] = []; // Typed as RewriteRule[]

    // Helper to instantiate pattern (similar to algorithms but for root)
    private instantiatePattern(pattern: Pattern) {
        const build = (p: Pattern | string | number): ENodeId => {
            if (typeof p === 'number') return p;
            if (typeof p === 'string') {
                // Treat as 0-arity op
                return this.runtime.addEnode({ op: p, args: [] });
            }
            const args = p.args.map(a => build(a));
            return this.runtime.addEnode({ op: p.op, args });
        };
        build(pattern);
    }


    /**
     * Build an EClassViewModel from runtime data, using cache when possible.
     */
    private buildEClassViewModel(id: number): EClassViewModel {
        const runtimeClass = this.runtime.eclasses.get(id)!;
        const cached = this.viewModelCache.get(id);

        if (cached && cached.version === runtimeClass.version) {
            return cached.vm;
        }

        // Create new ViewModel
        const vm: EClassViewModel = {
            id,
            nodes: runtimeClass.nodes.map(nodeId => {
                const n = this.runtime.nodes[nodeId];
                return {
                    id: nodeId,
                    op: n.op,
                    args: n.args // Keep original args (non-canonical) so UI can detect non-canonical nodes
                };
            }).sort((a, b) => a.op.localeCompare(b.op)), // Sort nodes
            parents: Array.from(runtimeClass.parents.values()).map(p => ({
                parentId: this.runtime.find(p.parentId), // Canonicalize parent ID too
                op: p.enode.op
            })),
            inWorklist: this.runtime.worklist.has(id)
        };

        this.viewModelCache.set(id, { version: runtimeClass.version, vm });
        return vm;
    }

    /**
     * Collect all node IDs that match a specific pattern structure.
     * Used for highlighting matched nodes during the read phase.
     */
    private collectMatchedNodes(eclassId: number, pattern: Pattern | string | number): Set<number> {
        const matchedNodeIds = new Set<number>();
        const canonicalId = this.runtime.find(eclassId);
        const eclass = this.runtime.eclasses.get(canonicalId);
        if (!eclass) return matchedNodeIds;

        // For variables, collect ALL nodes in the matched e-class
        // The variable matched this entire e-class, so all nodes should be highlighted
        if (typeof pattern === 'string' && pattern.startsWith('?')) {
            for (const nodeId of eclass.nodes) {
                matchedNodeIds.add(nodeId);
            }
            return matchedNodeIds;
        }

        // For structural patterns, find matching nodes
        if (typeof pattern === 'object' && 'op' in pattern) {
            for (const nodeId of eclass.nodes) {
                const node = this.runtime.nodes[nodeId];
                // Only include nodes that match the operator
                if (node && node.op === pattern.op) {
                    matchedNodeIds.add(nodeId);
                    // Recursively collect from arguments
                    pattern.args.forEach((argPattern, index) => {
                        if (index < node.args.length) {
                            const childMatches = this.collectMatchedNodes(node.args[index], argPattern);
                            for (const childId of childMatches) {
                                matchedNodeIds.add(childId);
                            }
                        }
                    });
                }
            }
        } else if (typeof pattern === 'string') {
            // Constant pattern like "foo" - match nodes with that op
            for (const nodeId of eclass.nodes) {
                const node = this.runtime.nodes[nodeId];
                if (node && node.op === pattern && node.args.length === 0) {
                    matchedNodeIds.add(nodeId);
                }
            }
        }

        return matchedNodeIds;
    }

    /**
     * Build step metadata from current runtime state and matches.
     */
    private buildMetadata(matches: any[], activeId?: number): StepMetadata {
        return {
            diffs: [...this.runtime.diffs], // Copy current diffs
            matches: matches.map(m => {
                // Extract only the nodes that structurally match the pattern
                const matchedNodeIds = this.collectMatchedNodes(m.eclassId, m.rule.lhs);

                return {
                    rule: m.rule.name,
                    nodes: Array.from(matchedNodeIds).sort((a, b) => a - b)
                };
            }),
            invariants: {
                congruenceValid: this.runtime.worklist.size === 0,
                hashconsValid: true // Assumed true for now
            },
            selectionHints: [], // Populated by controller/UI
            timestamp: Date.now(),
            activeId: activeId
        };
    }

    private emitSnapshot(phase: EGraphState['phase'], matches: any[] = [], activeId?: number) {
        const prevState = this.timeline.states[this.timeline.states.length - 1];

        // If no previous state, create initial empty state
        const baseState: EGraphState = prevState || {
            id: `${this.currentPresetId}:0`,
            presetId: this.currentPresetId,
            stepIndex: -1,
            phase: 'init',
            implementation: this.options.implementation,
            unionFind: [],
            eclasses: [],
            nodeChunks: [],
            worklist: [],
            metadata: {
                diffs: [],
                matches: [],
                invariants: { congruenceValid: true, hashconsValid: true },
                selectionHints: []
            },
            visualStates: {
                nodes: new Map(),
                eclasses: new Map()
            }
        };

        const nextState = create(baseState, draft => {
            draft.stepIndex++;
            draft.phase = phase;
            draft.id = `${this.currentPresetId}:${draft.stepIndex}`;

            // 1. Update UnionFind
            for (let id = 0; id < this.runtime.nextId; id++) {
                const canonical = this.runtime.find(id);
                if (!draft.unionFind[id]) {
                    draft.unionFind[id] = { id, canonical, isCanonical: id === canonical };
                } else {
                    const entry = draft.unionFind[id];
                    if (entry.canonical !== canonical) {
                        entry.canonical = canonical;
                        entry.isCanonical = id === canonical;
                    }
                }
            }

            // 2. Update EClasses
            const sortedIds = Array.from(this.runtime.eclasses.keys()).sort((a, b) => a - b);
            draft.eclasses = sortedIds.map(id => this.buildEClassViewModel(id));

            // 3. Update Node Chunks (Append-only)
            // We use the ChunkedArray helper to wrap the draft's chunks array
            const chunkedNodes = ChunkedArray.from(draft.nodeChunks);
            // We need to append any new nodes that aren't in the chunks yet.
            // Current length of chunked array:
            const currentLength = chunkedNodes.length;
            // Runtime nextId tells us how many nodes exist total.

            // Assuming runtime.nodes exists:
            for (let id = currentLength; id < this.runtime.nodes.length; id++) {
                chunkedNodes.push(this.runtime.nodes[id]);
            }

            // 4. Update Worklist
            draft.worklist = Array.from(this.runtime.worklist).sort((a, b) => a - b);

            // 5. Metadata
            draft.metadata = this.buildMetadata(matches, activeId);
        });

        this.timeline.states.push(nextState);

        // Clear diffs for next step
        this.runtime.diffs = [];
    }
}
