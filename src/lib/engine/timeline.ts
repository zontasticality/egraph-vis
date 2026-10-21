import { EGraphRuntime, SeededRandom } from './runtime';
import {
    collectMatches,
    collectMatchesGen,
    applyRewrite,
    rebuildGen,
    type Match,
    type RebuildStep
} from './algorithms';
import { computeVisualStates } from './visual';
import { assertInvariants } from './invariants';
import type {
    EGraphEngine,
    EGraphTimeline,
    EGraphState,
    PresetConfig,
    EngineOptions,
    EClassViewModel,
    StepMetadata,
    Pattern,
    ENode,
    ENodeId,
    HaltReason,
    HashconsEntry,
    MatchEvent,
    Phase,
    RewriteRule,
    UnionFindEntry,
    WriteListEntry
} from './types';

export const CHUNK_SIZE = 1024;

export const DEFAULT_LIMITS = {
    iterationCap: 100,
    maxNodes: 400,
    maxSteps: 5000
} as const;

type SnapshotExtras = Partial<Omit<StepMetadata, 'iteration' | 'diffs' | 'invariants' | 'selectionHints' | 'timestamp'>>;

/**
 * Runs equality saturation once and records an immutable snapshot after every
 * unit of work. Snapshots share unchanged sub-structures with their
 * predecessors (union-find entries, node chunks, hashcons, view models).
 */
export class TimelineEngine implements EGraphEngine {
    private runtime = new EGraphRuntime();
    private timeline: EGraphTimeline;
    private options: EngineOptions = { implementation: 'deferred', seed: 1 };
    private currentPresetId = '';
    private rng?: SeededRandom;
    private rewrites: RewriteRule[] = [];
    private iteration = 0;

    // Structural-sharing caches (previous snapshot's pieces)
    private viewModelCache = new Map<number, { version: number; vm: EClassViewModel }>();
    private emittedNodes: ENode[] = [];
    private hashconsCache?: { signature: string; entries: HashconsEntry[] };

    constructor() {
        this.timeline = this.createEmptyTimeline();
    }

    loadPreset(preset: PresetConfig, options: EngineOptions): void {
        const defaults: EngineOptions = { implementation: 'deferred', seed: 1 };
        const hints: Partial<EngineOptions> = {};
        if (preset.implementationHints?.iterationCap !== undefined) {
            hints.iterationCap = preset.implementationHints.iterationCap;
        }
        if (preset.implementationHints?.defaultImpl) {
            hints.implementation = preset.implementationHints.defaultImpl;
        }
        this.options = { ...defaults, ...hints, ...stripUndefined(options) };
        this.currentPresetId = preset.id;
        this.rewrites = preset.rewrites;
        this.runtime = new EGraphRuntime();
        this.viewModelCache.clear();
        this.emittedNodes = [];
        this.hashconsCache = undefined;
        this.iteration = 0;
        this.timeline = this.createEmptyTimeline();
        this.rng = this.options.seed !== undefined ? new SeededRandom(this.options.seed) : undefined;

        this.instantiateRoot(preset.root);
        this.emitSnapshot('init');
    }

    async runUntilHalt(): Promise<EGraphTimeline> {
        return this.run();
    }

    /** Synchronous version of {@link runUntilHalt}. */
    run(): EGraphTimeline {
        const cap = this.options.iterationCap ?? DEFAULT_LIMITS.iterationCap;
        let halted: HaltReason | undefined;

        while (!halted) {
            if (this.iteration >= cap) {
                halted = 'iteration-cap';
                break;
            }
            const limit = this.limitReached();
            if (limit) {
                halted = limit;
                break;
            }
            halted = this.options.implementation === 'deferred'
                ? this.runDeferredIteration()
                : this.runNaiveIteration();
            if (!halted) this.iteration++;
        }

        this.timeline.haltedReason = halted;
        this.emitSnapshot('done', { haltedReason: halted });
        return this.timeline;
    }

    getTimeline(): EGraphTimeline {
        return this.timeline;
    }

    /** Exposed for tests and debugging. */
    getRuntime(): EGraphRuntime {
        return this.runtime;
    }

    // ─── Iterations ────────────────────────────────────────────────────────

    /**
     * Deferred (egg-style) iteration: read every match into a writelist,
     * apply them all, then rebuild once.
     */
    private runDeferredIteration(): HaltReason | undefined {
        const entries: WriteListEntry[] = [];
        const parallelism = this.options.parallelism ?? 1;

        // --- READ: pure, batch by batch ---
        for (const batch of collectMatchesGen(this.runtime, this.rewrites, parallelism)) {
            for (const match of batch.matches) {
                entries.push({
                    ruleName: match.rule.name,
                    rhsPattern: match.rule.rhs,
                    targetClass: match.eclassId,
                    substitution: match.substitution,
                    batchId: batch.batchId,
                    lhsNodes: match.nodes
                });
            }
            this.emitSnapshot('read-batch', {
                matches: batch.matches.map(toMatchEvent),
                batch: { index: batch.batchId, total: batch.totalBatches, classIds: batch.classIds },
                writelist: { entries, count: entries.length, nextIndex: 0 }
            });
        }

        if (entries.length === 0) return 'saturated';

        // --- WRITE: consume the writelist sequentially ---
        let changed = false;
        let stopped: HaltReason | undefined;
        for (let i = 0; i < entries.length; i++) {
            stopped = this.limitReached();
            if (stopped) break;

            const entry = entries[i];
            const result = applyRewrite(
                this.runtime, entry.ruleName, entry.rhsPattern, entry.targetClass,
                entry.substitution, 'deferred', this.rng
            );
            if (!result.changed) continue;
            changed = true;

            this.emitSnapshot('write', {
                matches: [{ rule: entry.ruleName, eclassId: result.target, nodes: entry.lhsNodes }],
                applied: {
                    rule: entry.ruleName,
                    targetClass: result.target,
                    createdId: result.createdId,
                    newNodes: result.newNodes,
                    lhsNodes: entry.lhsNodes
                },
                writelist: { entries, count: entries.length, nextIndex: i + 1 }
            });
        }

        if (!changed) return stopped ?? 'saturated';

        // --- REBUILD ---
        this.runRebuild();
        return stopped;
    }

    /**
     * Naive iteration: collect matches, then apply them one at a time and
     * restore invariants immediately after each union.
     */
    private runNaiveIteration(): HaltReason | undefined {
        const matches = collectMatches(this.runtime, this.rewrites);
        this.emitSnapshot('read', { matches: matches.map(toMatchEvent) });
        if (matches.length === 0) return 'saturated';

        let changed = false;
        let stopped: HaltReason | undefined;
        for (const match of matches) {
            stopped = this.limitReached();
            if (stopped) break;

            const result = applyRewrite(
                this.runtime, match.rule.name, match.rule.rhs, match.eclassId,
                match.substitution, 'naive', this.rng
            );
            if (!result.changed) continue;
            changed = true;

            this.emitSnapshot('write', {
                matches: [toMatchEvent(match)],
                applied: {
                    rule: match.rule.name,
                    targetClass: result.target,
                    createdId: result.createdId,
                    newNodes: result.newNodes,
                    lhsNodes: match.nodes
                }
            });
            this.runRebuild();
        }

        if (!changed) return stopped ?? 'saturated';
        return stopped;
    }

    private runRebuild() {
        for (const step of rebuildGen(this.runtime)) {
            this.emitSnapshot(step.phase, rebuildExtras(step));
        }
        if (this.options.debugInvariants) {
            assertInvariants(this.runtime, `after rebuild, iteration ${this.iteration}`);
        }
    }

    private limitReached(): HaltReason | undefined {
        const maxNodes = this.options.maxNodes ?? DEFAULT_LIMITS.maxNodes;
        const maxSteps = this.options.maxSteps ?? DEFAULT_LIMITS.maxSteps;
        if (this.runtime.nextId >= maxNodes) return 'node-limit';
        if (this.timeline.states.length >= maxSteps) return 'step-limit';
        return undefined;
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    private createEmptyTimeline(): EGraphTimeline {
        return {
            presetId: this.currentPresetId,
            implementation: this.options.implementation,
            states: [],
            haltedReason: 'saturated' // Updated when the run halts
        };
    }

    private instantiateRoot(pattern: Pattern) {
        const build = (p: Pattern | number): ENodeId => {
            if (typeof p === 'number') return p;
            if (typeof p === 'string') return this.runtime.addEnode({ op: p, args: [] });
            return this.runtime.addEnode({ op: p.op, args: p.args.map(build) });
        };
        build(pattern);
    }

    private buildEClassViewModel(id: number): EClassViewModel {
        const runtimeClass = this.runtime.eclasses.get(id)!;
        const cached = this.viewModelCache.get(id);
        if (cached && cached.version === runtimeClass.version) {
            return cached.vm;
        }

        const vm: EClassViewModel = {
            id,
            nodes: runtimeClass.nodes
                .slice()
                .sort((a, b) => a - b)
                .map(nodeId => {
                    const n = this.runtime.nodes[nodeId];
                    return { id: nodeId, op: n.op, args: n.args.slice() };
                })
        };
        this.viewModelCache.set(id, { version: runtimeClass.version, vm });
        return vm;
    }

    private buildUnionFind(prev: UnionFindEntry[] | undefined): UnionFindEntry[] {
        const n = this.runtime.nextId;
        let out: UnionFindEntry[] | undefined;
        for (let id = 0; id < n; id++) {
            const canonical = this.runtime.find(id);
            const old = prev?.[id];
            if (old && old.canonical === canonical) continue;
            out ??= prev ? prev.slice() : [];
            out[id] = { id, canonical, isCanonical: id === canonical };
        }
        return out ?? prev ?? [];
    }

    private buildNodeChunks(prev: ENode[][] | undefined): ENode[][] {
        const nodes = this.runtime.nodes;
        let chunks: ENode[][] | undefined;
        const copied = new Set<number>();
        for (let id = 0; id < nodes.length; id++) {
            if (this.emittedNodes[id] === nodes[id]) continue;
            chunks ??= prev ? prev.slice() : [];
            const c = Math.floor(id / CHUNK_SIZE);
            if (!copied.has(c)) {
                chunks[c] = chunks[c] ? chunks[c].slice() : [];
                copied.add(c);
            }
            chunks[c][id % CHUNK_SIZE] = nodes[id];
            this.emittedNodes[id] = nodes[id];
        }
        return chunks ?? prev ?? [];
    }

    private buildHashcons(): HashconsEntry[] {
        const signature = `${this.runtime.hashconsVersion}:${this.runtime.unionCount}`;
        if (this.hashconsCache?.signature === signature) return this.hashconsCache.entries;

        const entries: HashconsEntry[] = [];
        for (const [key, classId] of this.runtime.hashcons) {
            const paren = key.lastIndexOf('('); // args never contain '(' (ops might)
            const op = key.slice(0, paren);
            const inner = key.slice(paren + 1, -1);
            entries.push({
                key,
                op,
                args: inner.length ? inner.split(',').map(Number) : [],
                eclass: this.runtime.find(classId)
            });
        }
        entries.sort((a, b) => a.eclass - b.eclass || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        this.hashconsCache = { signature, entries };
        return entries;
    }

    private emitSnapshot(phase: Phase, extras: SnapshotExtras = {}) {
        const prev = this.timeline.states[this.timeline.states.length - 1];
        const stepIndex = prev ? prev.stepIndex + 1 : 0;

        const eclasses = Array.from(this.runtime.eclasses.keys())
            .sort((a, b) => a - b)
            .map(id => this.buildEClassViewModel(id));
        const worklist = Array.from(this.runtime.worklist).sort((a, b) => a - b);

        const metadata: StepMetadata = {
            iteration: this.iteration,
            diffs: this.runtime.diffs,
            matches: [],
            invariants: {
                congruenceValid: this.runtime.worklist.size === 0,
                hashconsValid: this.runtime.worklist.size === 0
            },
            selectionHints: [],
            ...extras
        };
        this.runtime.diffs = [];

        const state: EGraphState = {
            id: `${this.currentPresetId}:${stepIndex}`,
            presetId: this.currentPresetId,
            stepIndex,
            phase,
            implementation: this.options.implementation,
            unionFind: this.buildUnionFind(prev?.unionFind),
            eclasses,
            nodeChunks: this.buildNodeChunks(prev?.nodeChunks),
            hashcons: this.buildHashcons(),
            worklist,
            metadata,
            visualStates: { nodes: new Map(), eclasses: new Map() }
        };
        state.visualStates = computeVisualStates(state);

        this.timeline.states.push(state);
    }
}

function toMatchEvent(m: Match): MatchEvent {
    return { rule: m.rule.name, eclassId: m.eclassId, nodes: m.nodes };
}

function rebuildExtras(step: RebuildStep): SnapshotExtras {
    if (step.phase === 'compact') {
        return { activeId: step.eclassId, compactedId: step.compactedId };
    }
    return { activeId: step.eclassId, repairedNodes: step.result.parentNodes };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
    const out: Partial<T> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) (out as any)[k] = v;
    }
    return out;
}

/** Look up a node in a snapshot's chunked node registry. */
export function getSnapshotNode(state: Pick<EGraphState, 'nodeChunks'>, id: number): ENode | undefined {
    return state.nodeChunks[Math.floor(id / CHUNK_SIZE)]?.[id % CHUNK_SIZE];
}
