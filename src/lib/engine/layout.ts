import ELK from 'elkjs';
import type { EGraphState, EGraphTimeline, LayoutData } from './types';
import { create } from 'mutative';
import {
    DEFAULT_LAYOUT_CONFIG,
    ENODE_LAYOUT,
    CONTAINER_PADDING,
    toELKOptions,
    toPaddingString,
    type LayoutConfig,
} from './layoutConfig';

/**
 * Layout Manager for progressive precomputation of ELK graph layouts.
 * Computes first layout synchronously, then progressively computes remaining layouts in background.
 */
export class LayoutManager {
    private elk: InstanceType<typeof ELK>;
    private layouts = new Map<number, LayoutData>();
    private pending = new Map<number, Promise<LayoutData>>();
    private computing = new Set<number>();
    private config: LayoutConfig;
    private listeners: ((index: number) => void)[] = [];
    private currentRunId = 0;

    constructor(config: LayoutConfig = DEFAULT_LAYOUT_CONFIG) {
        this.elk = new ELK();
        this.config = config;
    }

    /**
     * Subscribe to layout completion events
     */
    subscribe(listener: (index: number) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * Compute layouts for all snapshots. First layout is synchronous, rest are progressive.
     * Returns immediately after first layout is complete.
     */
    async precomputeAll(timeline: EGraphTimeline): Promise<void> {
        // Cancel any previous run
        this.currentRunId++;
        const runId = this.currentRunId;
        this.clear();

        if (timeline.states.length === 0) return;

        // SYNC: Compute first layout (required for initial render)
        console.log('[LayoutManager] Computing first layout synchronously...');
        const firstLayout = await this.computeLayout(timeline.states[0]);

        // Check if run was cancelled during await
        if (runId !== this.currentRunId) return;

        this.layouts.set(0, firstLayout);

        // Update the first state with its layout
        timeline.states[0] = create(timeline.states[0], draft => {
            draft.layout = firstLayout;
        });

        console.log(`[LayoutManager] First layout complete. Queueing ${timeline.states.length - 1} remaining layouts...`);

        // ASYNC: Start computing remaining layouts in background
        // Use setTimeout to avoid blocking the UI thread
        for (let i = 1; i < timeline.states.length; i++) {
            const index = i;
            setTimeout(() => {
                // Check if this run is still active
                if (runId !== this.currentRunId) return;

                const prevLayout = this.layouts.get(index - 1);
                this.startLayoutComputation(index, timeline, prevLayout);
            }, 0);
        }
    }

    /**
     * Start computing layout for a specific snapshot (non-blocking)
     */
    private startLayoutComputation(
        index: number,
        timeline: EGraphTimeline,
        prevLayout?: LayoutData
    ): void {
        if (this.layouts.has(index) || this.computing.has(index)) return;

        this.computing.add(index);
        const state = timeline.states[index];
        const promise = this.computeLayout(state, prevLayout);
        this.pending.set(index, promise);

        promise.then(layout => {
            this.layouts.set(index, layout);

            // Backfill into state
            timeline.states[index] = create(state, draft => {
                draft.layout = layout;
            });

            this.pending.delete(index);
            this.computing.delete(index);

            // Log progress every 10 snapshots
            if (index % 10 === 0 || index === timeline.states.length - 1) {
                console.log(`[LayoutManager] Computed ${index + 1}/${timeline.states.length} layouts`);
            }

            // Notify listeners
            this.listeners.forEach(l => l(index));
        }).catch(err => {
            console.error(`[LayoutManager] Layout computation failed for snapshot ${index}:`, err);
            this.pending.delete(index);
            this.computing.delete(index);
        });
    }

    /**
     * Get layout synchronously (returns undefined if not ready)
     */
    getLayoutSync(index: number): LayoutData | undefined {
        return this.layouts.get(index);
    }

    /**
     * Get layout, waiting if necessary (for jump-to-step)
     */
    async getLayout(index: number): Promise<LayoutData | undefined> {
        if (this.layouts.has(index)) {
            return this.layouts.get(index);
        }
        if (this.pending.has(index)) {
            return await this.pending.get(index);
        }
        return undefined;
    }

    /**
     * Compute ELK layout for a snapshot
     * Note: For now, ignoring prevLayout hint. Can optimize later if needed.
     */
    private async computeLayout(state: EGraphState, prevLayout?: LayoutData): Promise<LayoutData> {
        // Convert EGraphState to ELK graph structure
        const elkGraph = this.stateToELKGraph(state);

        // Run ELK layout
        const layouted = await this.elk.layout(elkGraph);

        // Extract positions from layouted graph
        return this.elkGraphToLayoutData(layouted, state);
    }

    /**
     * Convert EGraphState to ELK graph format
     * Creates hierarchical layout matching GraphPane's structure
     */
    private stateToELKGraph(state: EGraphState): any {
        const elkNodes: any[] = [];
        const elkEdges: any[] = [];

        // Build hierarchical layout matching GraphPane
        if (state.implementation === 'deferred') {
            // Group eclasses by canonical ID (union-find sets)
            const sets = new Map<number, typeof state.eclasses>();
            for (const eclass of state.eclasses) {
                const canonicalId = state.unionFind[eclass.id]?.canonical ?? eclass.id;
                if (!sets.has(canonicalId)) {
                    sets.set(canonicalId, []);
                }
                sets.get(canonicalId)!.push(eclass);
            }

            // Create hierarchical structure: union-find sets > e-classes > e-nodes
            for (const [canonicalId, eclassesInSet] of sets) {
                const setChildren: any[] = [];

                for (const eclass of eclassesInSet) {
                    const classChildren: any[] = [];

                    for (const node of eclass.nodes) {
                        classChildren.push({
                            id: `node-${node.id}`,
                            width: ENODE_LAYOUT.width,
                            height: ENODE_LAYOUT.height
                        });
                    }

                    setChildren.push({
                        id: `class-${eclass.id}`,
                        children: classChildren,
                        layoutOptions: {
                            ...toELKOptions(this.config),
                            'elk.padding': toPaddingString(CONTAINER_PADDING.eclassGroup),
                            'elk.spacing.nodeNode': '8'
                        }
                    });
                }

                elkNodes.push({
                    id: `set-${canonicalId}`,
                    children: setChildren,
                    layoutOptions: {
                        ...toELKOptions(this.config),
                        'elk.padding': toPaddingString(CONTAINER_PADDING.unionFindGroup),
                        'elk.spacing.nodeNode': '10'
                    }
                });
            }
        } else {
            // Naive mode: just e-classes > e-nodes (no union-find groups)
            for (const eclass of state.eclasses) {
                const classChildren: any[] = [];

                for (const node of eclass.nodes) {
                    classChildren.push({
                        id: `node-${node.id}`,
                        width: ENODE_LAYOUT.width,
                        height: ENODE_LAYOUT.height
                    });
                }

                elkNodes.push({
                    id: `class-${eclass.id}`,
                    children: classChildren,
                    layoutOptions: {
                        ...toELKOptions(this.config),
                        'elk.padding': toPaddingString(CONTAINER_PADDING.eclassGroup),
                        'elk.spacing.nodeNode': '8'
                    }
                });
            }
        }

        // Create edges
        let edgeId = 0;
        for (const eclass of state.eclasses) {
            for (const node of eclass.nodes) {
                node.args.forEach((argId, argIndex) => {
                    const canonicalArgId = state.unionFind[argId]?.canonical ?? argId;
                    const targetId = state.implementation === 'deferred'
                        ? `set-${canonicalArgId}`
                        : `class-${canonicalArgId}`;

                    elkEdges.push({
                        id: `edge-${edgeId++}`,
                        sources: [`node-${node.id}`],
                        targets: [targetId],
                        sourcePort: `port-${node.id}-${argIndex}`
                    });
                });
            }
        }

        return {
            id: 'root',
            layoutOptions: toELKOptions(this.config),
            children: elkNodes,
            edges: elkEdges
        };
    }

    /**
     * Extract layout data from ELK's output
     * Stores positions as ELK provides them (relative to parent)
     * SvelteFlow nodes with parentId need relative positions
     *
     * Also adds alias entries for union-find equivalent IDs to enable seamless interpolation
     * when e-classes are merged (their canonical IDs change).
     */
    private elkGraphToLayoutData(elkGraph: any, state: EGraphState): LayoutData {
        const nodes = new Map<number, { x: number; y: number }>();
        const groups = new Map<string, { x: number; y: number; width: number; height: number }>();
        const edges = new Set<string>();

        // Recursively extract positions (keeping them relative as ELK provides)
        const traverse = (node: any) => {
            // Store position as-is (relative to parent, or absolute if no parent)
            const x = node.x ?? 0;
            const y = node.y ?? 0;

            if (node.id.startsWith('node-')) {
                // E-node position (relative to parent e-class)
                const nodeId = parseInt(node.id.substring(5));
                nodes.set(nodeId, { x, y });
            } else if (node.id.startsWith('class-') || node.id.startsWith('set-')) {
                // E-class or union-find group position
                // (relative to parent for e-class, absolute for set)
                groups.set(node.id, {
                    x,
                    y,
                    width: node.width ?? 0,
                    height: node.height ?? 0
                });
            }

            // Recurse into children
            if (node.children) {
                for (const child of node.children) {
                    traverse(child);
                }
            }
        };

        // Start traversal from root's children
        if (elkGraph.children) {
            for (const child of elkGraph.children) {
                traverse(child);
            }
        }

        // Extract edge IDs
        if (elkGraph.edges) {
            for (const edge of elkGraph.edges) {
                edges.add(edge.id);
            }
        }

        // Add alias entries for union-find equivalent IDs
        // This enables smooth interpolation when e-classes merge and canonical IDs change
        if (state.implementation === 'deferred') {
            // Build map of canonical → all equivalent IDs
            const unionFindSets = new Map<number, number[]>();
            for (const entry of state.unionFind) {
                if (!unionFindSets.has(entry.canonical)) {
                    unionFindSets.set(entry.canonical, []);
                }
                unionFindSets.get(entry.canonical)!.push(entry.id);
            }

            // For each union-find set, store its position under all equivalent set IDs
            for (const [canonical, equivalentIds] of unionFindSets) {
                const canonicalSetId = `set-${canonical}`;
                const canonicalPos = groups.get(canonicalSetId);

                if (canonicalPos) {
                    // Add alias entries for all non-canonical IDs in this set
                    for (const id of equivalentIds) {
                        if (id !== canonical) {
                            const aliasSetId = `set-${id}`;
                            // Only add if not already present (shouldn't happen, but safe)
                            if (!groups.has(aliasSetId)) {
                                groups.set(aliasSetId, { ...canonicalPos });
                            }
                        }
                    }
                }
            }
        }

        return { nodes, groups, edges };
    }

    /**
     * Clear all cached layouts
     */
    clear(): void {
        this.layouts.clear();
        this.pending.clear();
        this.computing.clear();
    }
}

// Global singleton instance
export const layoutManager = new LayoutManager();
