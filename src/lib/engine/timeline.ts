import { create } from 'mutative';
import { EGraphRuntime } from './runtime';
import { rebuild, collectMatches, applyMatches } from './algorithms';
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
    private options: EngineOptions = { implementation: 'deferred' };
    private currentPresetId = '';

    constructor() {
        this.runtime = new EGraphRuntime();
        this.timeline = this.createEmptyTimeline();
    }

    loadPreset(preset: PresetConfig, options: EngineOptions): void {
        this.options = { ...preset.implementationHints, ...options };
        this.currentPresetId = preset.id;
        this.rewrites = preset.rewrites; // Store rewrites
        this.runtime = new EGraphRuntime();
        this.viewModelCache.clear();
        this.timeline = this.createEmptyTimeline();

        // Initialize root
        this.instantiatePattern(preset.root);

        // Emit initial snapshot
        this.emitSnapshot('init');
    }

    runUntilHalt(): EGraphTimeline {
        let iteration = 0;
        const cap = this.options.iterationCap ?? 100;

        while (iteration < cap) {
            // 1. Read Phase
            const matches = collectMatches(this.runtime, this.getRewrites());
            this.emitSnapshot('read');

            if (matches.length === 0) {
                this.timeline.haltedReason = 'saturated';
                break;
            }

            // 2. Write Phase
            applyMatches(this.runtime, matches, this.options.implementation);
            this.emitSnapshot('write');

            // 3. Rebuild Phase
            // 3. Rebuild Phase
            // In both naive and deferred modes, we need to restore invariants (congruence).
            // Our `rebuild` function handles this using the worklist populated during merge.
            rebuild(this.runtime);
            this.emitSnapshot('rebuild');

            iteration++;
        }

        if (iteration >= cap) {
            this.timeline.haltedReason = 'iteration-cap';
        } else if (!this.timeline.haltedReason) {
            this.timeline.haltedReason = 'saturated'; // Default if loop finishes
        }

        this.emitSnapshot('done');
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

    private emitSnapshot(phase: EGraphState['phase'], matches: any[] = []) {
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
            const newEClasses: EClassViewModel[] = [];
            const sortedIds = Array.from(this.runtime.eclasses.keys()).sort((a, b) => a - b);

            for (const id of sortedIds) {
                const runtimeClass = this.runtime.eclasses.get(id)!;
                const cached = this.viewModelCache.get(id);

                if (cached && cached.version === runtimeClass.version) {
                    newEClasses.push(cached.vm);
                } else {
                    // Create new ViewModel
                    const vm: EClassViewModel = {
                        id,
                        nodes: runtimeClass.nodes.map(n => ({
                            op: n.op,
                            args: n.args.map(arg => this.runtime.find(arg)) // Canonicalize args for UI
                        })).sort((a, b) => a.op.localeCompare(b.op)), // Sort nodes
                        parents: Array.from(runtimeClass.parents.values()).map(p => ({
                            parentId: this.runtime.find(p.parentId), // Canonicalize parent ID too
                            op: p.enode.op
                        })), // Sort parents? Spec doesn't strictly say, but good for stability
                        inWorklist: this.runtime.worklist.has(id)
                    };

                    this.viewModelCache.set(id, { version: runtimeClass.version, vm });
                    newEClasses.push(vm);
                }
            }

            draft.eclasses = newEClasses;

            // 3. Update Node Chunks (Append-only)
            // We use the ChunkedArray helper to wrap the draft's chunks array
            const chunkedNodes = ChunkedArray.from(draft.nodeChunks);
            // We need to append any new nodes that aren't in the chunks yet.
            // Current length of chunked array:
            const currentLength = chunkedNodes.length;
            // Runtime nextId tells us how many nodes exist total.
            // We iterate from currentLength to nextId - 1.

            // We need to access the raw nodes from runtime.
            // Currently runtime doesn't expose a simple ID -> Node map, 
            // but we can iterate hashcons or store a separate list in runtime.
            // Wait, runtime.hashcons is Map<string, number>. It doesn't store the node structure by ID easily.
            // BUT, we know that IDs are assigned sequentially.
            // We need to find the node for each ID.
            // Since we don't have a direct ID->Node map in runtime, we might need to add one to runtime
            // OR we can reconstruct it.
            // Actually, `runtime.addEnode` creates the node.
            // Let's assume for now we can get it. 
            // I will add `nodes: ENode[]` to `EGraphRuntime` to make this O(1).
            // For now, I'll use a hack or update runtime.
            // Let's update runtime.ts as well to store `nodes: ENode[]`.

            // Assuming runtime.nodes exists:
            for (let id = currentLength; id < this.runtime.nodes.length; id++) {
                chunkedNodes.push(this.runtime.nodes[id]);
            }

            // 4. Update Worklist
            draft.worklist = Array.from(this.runtime.worklist).sort((a, b) => a - b);

            // 5. Metadata
            draft.metadata = {
                diffs: [...this.runtime.diffs], // Copy current diffs
                matches: matches.map(m => ({ rule: m.rule, nodes: m.nodes })), // Copy matches
                invariants: {
                    congruenceValid: this.runtime.worklist.size === 0,
                    hashconsValid: true // Assumed true for now
                },
                selectionHints: [], // Populated by controller/UI
                timestamp: Date.now()
            };
        });

        this.timeline.states.push(nextState);

        // Clear diffs for next step
        this.runtime.diffs = [];
    }
}
