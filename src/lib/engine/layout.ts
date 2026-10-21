import type { EGraphState, EGraphTimeline, LayoutData, Rect } from './types';
import { DEFAULT_LAYOUT_CONFIG, toELKOptions, type LayoutConfig } from './layoutConfig';
import { NODE_HEIGHT, CLASS_PADDING, SET_PADDING, nodeWidth, portOffset, unionRects } from '../graph/geometry';

// ─── Pure helpers (shared by layout + renderer) ────────────────────────────

/**
 * The e-class an e-node argument visually points at: the e-class with the
 * stored ID while it still exists (deferred mode keeps merged classes around
 * until compaction), otherwise its canonical representative.
 */
export function edgeTargetClass(state: Pick<EGraphState, 'unionFind'>, classIds: Set<number>, arg: number): number {
    if (classIds.has(arg)) return arg;
    return state.unionFind[arg]?.canonical ?? arg;
}

/** Union-find sets that currently contain more than one e-class (deferred mode only). */
export function multiClassSets(state: Pick<EGraphState, 'eclasses' | 'unionFind'>): Map<number, number[]> {
    const sets = new Map<number, number[]>();
    for (const c of state.eclasses) {
        const canon = state.unionFind[c.id]?.canonical ?? c.id;
        if (!sets.has(canon)) sets.set(canon, []);
        sets.get(canon)!.push(c.id);
    }
    for (const [canon, members] of sets) {
        if (members.length < 2) sets.delete(canon);
    }
    return sets;
}

/**
 * A string identifying everything that influences the layout of a snapshot.
 * Snapshots with equal keys share one computed layout.
 */
export function structureKey(state: Pick<EGraphState, 'eclasses' | 'unionFind'>): string {
    const classIds = new Set(state.eclasses.map(c => c.id));
    const parts: string[] = [];
    for (const c of state.eclasses) {
        const canon = state.unionFind[c.id]?.canonical ?? c.id;
        const nodes = c.nodes.map(n => `${n.id}.${n.op}(${n.args.map(a => edgeTargetClass(state, classIds, a)).join(',')})`);
        parts.push(`${c.id}/${canon}:${nodes.join(';')}`);
    }
    return parts.join('|');
}

interface ElkPort {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    layoutOptions?: Record<string, string>;
}

interface ElkNodeJson {
    id: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    children?: ElkNodeJson[];
    ports?: ElkPort[];
    edges?: Array<{ id: string; sources: string[]; targets: string[] }>;
    layoutOptions?: Record<string, string>;
}

/** Above this many e-nodes, trade some layout stability for speed. */
export const LARGE_GRAPH_NODES = 150;

/** Horizontal gap between e-nodes in a class / classes in a set. */
const NODE_GAP = 10;
const CLASS_GAP = 14;

/**
 * Internal arrangement of one top-level box (an e-class, or a union-find set
 * holding several e-classes): e-nodes in a row, classes side by side.
 * Offsets are relative to the box's top-left corner.
 */
interface BoxPlan {
    id: string;
    width: number;
    height: number;
    classes: Array<{ id: number } & Rect>;
    nodes: Array<{ id: number; args: number[] } & Rect>;
}

function planClass(c: EGraphState['eclasses'][number], ox: number, oy: number, plan: BoxPlan): Rect {
    let x = ox + CLASS_PADDING.left;
    const y = oy + CLASS_PADDING.top;
    c.nodes.forEach((n, i) => {
        const width = nodeWidth(n.op, n.args.length);
        if (i > 0) x += NODE_GAP;
        plan.nodes.push({ id: n.id, args: n.args, x, y, width, height: NODE_HEIGHT });
        x += width;
    });
    const rect = {
        x: ox,
        y: oy,
        width: x + CLASS_PADDING.right - ox,
        height: CLASS_PADDING.top + NODE_HEIGHT + CLASS_PADDING.bottom
    };
    plan.classes.push({ id: c.id, ...rect });
    return rect;
}

/** Decide the top-level boxes and their internal geometry. */
export function planBoxes(state: Pick<EGraphState, 'eclasses' | 'unionFind'>): BoxPlan[] {
    const sets = multiClassSets(state);
    const setOf = new Map<number, number>();
    for (const [canon, members] of sets) members.forEach(m => setOf.set(m, canon));
    const byId = new Map(state.eclasses.map(c => [c.id, c]));

    const plans: BoxPlan[] = [];
    const emitted = new Set<number>();
    for (const c of state.eclasses) {
        const canon = setOf.get(c.id);
        if (canon === undefined) {
            const plan: BoxPlan = { id: `c${c.id}`, width: 0, height: 0, classes: [], nodes: [] };
            const r = planClass(c, 0, 0, plan);
            plan.width = r.width;
            plan.height = r.height;
            plans.push(plan);
        } else if (!emitted.has(canon)) {
            emitted.add(canon);
            const plan: BoxPlan = { id: `s${canon}`, width: 0, height: 0, classes: [], nodes: [] };
            let x = SET_PADDING.left;
            let height = 0;
            sets.get(canon)!.forEach((id, i) => {
                if (i > 0) x += CLASS_GAP;
                const r = planClass(byId.get(id)!, x, SET_PADDING.top, plan);
                x += r.width;
                height = Math.max(height, r.height);
            });
            plan.width = x + SET_PADDING.right;
            plan.height = SET_PADDING.top + height + SET_PADDING.bottom;
            plans.push(plan);
        }
    }
    return plans;
}

/**
 * Convert a snapshot into a flat ELK graph: one box per e-class (or per
 * union-find set with several classes), with a fixed port under every
 * argument of every e-node so ELK keeps children in argument order.
 */
export function buildElkGraph(
    state: Pick<EGraphState, 'eclasses' | 'unionFind'>,
    config: LayoutConfig,
    plans: BoxPlan[] = planBoxes(state)
): ElkNodeJson {
    const base = toELKOptions(config);
    const classIds = new Set(state.eclasses.map(c => c.id));
    const boxOfClass = new Map<number, string>();
    for (const plan of plans) plan.classes.forEach(c => boxOfClass.set(c.id, plan.id));

    const portSide = { DOWN: 'SOUTH', UP: 'NORTH', RIGHT: 'EAST', LEFT: 'WEST' }[config.direction] ?? 'SOUTH';
    const children: ElkNodeJson[] = plans.map(plan => ({
        id: plan.id,
        width: plan.width,
        height: plan.height,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: plan.nodes.flatMap(n =>
            n.args.map((_, i) => ({
                id: `p${n.id}_${i}`,
                x: n.x + portOffset(n.width, n.args.length, i),
                y: plan.height,
                width: 0,
                height: 0,
                layoutOptions: { 'elk.port.side': portSide }
            }))
        )
    }));

    const edges: NonNullable<ElkNodeJson['edges']> = [];
    for (const plan of plans) {
        for (const n of plan.nodes) {
            n.args.forEach((arg, i) => {
                const target = edgeTargetClass(state, classIds, arg);
                const box = boxOfClass.get(target);
                if (!box || box === plan.id) return; // loops inside a box are drawn, not laid out
                edges.push({ id: `e${n.id}_${i}`, sources: [`p${n.id}_${i}`], targets: [box] });
            });
        }
    }

    const rootOptions: Record<string, string> = { ...base };
    delete rootOptions['elk.hierarchyHandling'];
    if (config.algorithm === 'layered') {
        const size = plans.reduce((n, p) => n + p.nodes.length, 0);
        if (size <= LARGE_GRAPH_NODES) {
            // Keep the input order (ascending ids) where possible so consecutive
            // snapshots get similar layouts and animations stay calm.
            rootOptions['elk.layered.considerModelOrder.strategy'] = 'NODES_AND_EDGES';
        } else {
            // Model order is ~4x slower on big graphs; favor responsiveness.
            rootOptions['elk.layered.thoroughness'] = '3';
        }
    }

    return { id: 'root', layoutOptions: rootOptions, children, edges };
}

/** Place every e-class / e-node using the computed top-level box positions. */
export function elkToLayoutData(graph: ElkNodeJson, plans: BoxPlan[]): LayoutData {
    const nodes = new Map<number, Rect>();
    const classes = new Map<number, Rect>();
    const sets = new Map<number, Rect>();
    const positions = new Map((graph.children ?? []).map(c => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));

    for (const plan of plans) {
        const { x: ox, y: oy } = positions.get(plan.id) ?? { x: 0, y: 0 };
        if (plan.id[0] === 's') {
            sets.set(Number(plan.id.slice(1)), { x: ox, y: oy, width: plan.width, height: plan.height });
        }
        for (const c of plan.classes) classes.set(c.id, { x: ox + c.x, y: oy + c.y, width: c.width, height: c.height });
        for (const n of plan.nodes) nodes.set(n.id, { x: ox + n.x, y: oy + n.y, width: n.width, height: n.height });
    }

    const bounds = unionRects([...classes.values(), ...sets.values()]) ?? { x: 0, y: 0, width: 0, height: 0 };
    return { nodes, classes, sets, bounds };
}

// ─── ELK backends ────────────────────────────────────────────────────────

export interface ElkLike {
    layout(graph: any): Promise<any>;
    terminateWorker?(): void;
}

async function createElk(): Promise<ElkLike> {
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
        // Run ELK in a web worker so long layouts never block the UI
        const [{ default: ELKApi }, { default: workerUrl }] = await Promise.all([
            import('elkjs/lib/elk-api.js'),
            import('elkjs/lib/elk-worker.min.js?url')
        ]);
        return new ELKApi({ workerUrl }) as ElkLike;
    }
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    return new ELK() as ElkLike;
}

// ─── Layout manager ──────────────────────────────────────────────────────

/** Number of upcoming snapshots that are laid out before looking backwards. */
const LOOKAHEAD = 24;
/** A layout taking longer than this is treated as hung; the worker is restarted. */
const LAYOUT_TIMEOUT_MS = 30_000;
/** Attempts per layout before giving up on it (failures are often a dead worker). */
const MAX_ATTEMPTS = 2;

/**
 * Computes ELK layouts for the snapshots of a timeline, one at a time,
 * prioritizing the snapshots around the current playhead. Snapshots with the
 * same {@link structureKey} share a single layout.
 */
export class LayoutManager {
    private elk: Promise<ElkLike> | null = null;
    private elkFactory: () => Promise<ElkLike>;
    private timeoutMs: number;
    private config: LayoutConfig;
    private timeline: EGraphTimeline | null = null;
    private keys: string[] = [];
    private cache = new Map<string, LayoutData>();
    private failed = new Set<string>();
    private attempts = new Map<string, number>();
    private waiters = new Map<string, Array<(l: LayoutData | undefined) => void>>();
    private busy = false;
    private focus = 0;
    private generation = 0;
    private listeners: Array<() => void> = [];

    /**
     * @param elk an ELK instance or factory (defaults to a web worker in browsers)
     */
    constructor(
        config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
        elk?: ElkLike | (() => Promise<ElkLike>),
        options: { timeoutMs?: number } = {}
    ) {
        this.config = config;
        this.elkFactory = typeof elk === 'function' ? elk : elk ? () => Promise.resolve(elk) : createElk;
        this.timeoutMs = options.timeoutMs ?? LAYOUT_TIMEOUT_MS;
    }

    /** Subscribe to layout completion events. Returns an unsubscribe function. */
    subscribe(listener: () => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    getConfig(): LayoutConfig {
        return this.config;
    }

    /** Start laying out a new timeline (cancels work for the previous one). */
    setTimeline(timeline: EGraphTimeline | null) {
        this.timeline = timeline;
        this.keys = timeline ? timeline.states.map(structureKey) : [];
        this.attempts.clear();
        this.focus = 0;
        this.generation++;
        this.resolveAllWaiters();
        this.pump();
    }

    /**
     * Change the layout configuration and recompute everything. Pending
     * `whenReady` calls keep waiting for the recomputed layouts.
     */
    updateConfig(config: LayoutConfig) {
        this.config = config;
        this.cache.clear();
        this.failed.clear();
        this.attempts.clear();
        this.generation++;
        this.pump();
    }

    /** Prioritize snapshots around `index`. */
    setFocus(index: number) {
        this.focus = Math.max(0, Math.floor(index));
        this.pump();
    }

    getLayout(index: number): LayoutData | undefined {
        const key = this.keys[index];
        return key === undefined ? undefined : this.cache.get(key);
    }

    isReady(index: number): boolean {
        return this.getLayout(index) !== undefined;
    }

    /** Number of distinct layouts the current timeline needs, and how many are done. */
    progress(): { done: number; total: number } {
        const unique = new Set(this.keys);
        let done = 0;
        for (const k of unique) if (this.cache.has(k) || this.failed.has(k)) done++;
        return { done, total: unique.size };
    }

    /** Resolve once the layout for `index` is available (undefined if it failed or was superseded). */
    whenReady(index: number): Promise<LayoutData | undefined> {
        const key = this.keys[index];
        if (key === undefined) return Promise.resolve(undefined);
        const cached = this.cache.get(key);
        if (cached) return Promise.resolve(cached);
        if (this.failed.has(key)) return Promise.resolve(undefined);
        this.setFocus(index);
        return new Promise(resolve => {
            if (!this.waiters.has(key)) this.waiters.set(key, []);
            this.waiters.get(key)!.push(resolve);
        });
    }

    /** Lay out a single snapshot directly (no caching). */
    async computeLayout(state: Pick<EGraphState, 'eclasses' | 'unionFind'>): Promise<LayoutData> {
        const elkPromise = (this.elk ??= this.elkFactory());
        let elk: ElkLike;
        try {
            elk = await elkPromise;
        } catch (err) {
            // Don't cache a failed worker start; try again next time
            if (this.elk === elkPromise) this.elk = null;
            throw err;
        }
        const plans = planBoxes(state);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`ELK layout timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
        });
        try {
            const result = await Promise.race([elk.layout(buildElkGraph(state, this.config, plans)), timeout]);
            return elkToLayoutData(result, plans);
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('ELK layout timed out')) {
                // A hung (or crashed) worker never answers again: replace it
                try {
                    elk.terminateWorker?.();
                } catch {
                    // ignore
                }
                if (this.elk === elkPromise) this.elk = null;
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    clear(): void {
        this.cache.clear();
        this.failed.clear();
        this.generation++;
    }

    private resolveAllWaiters() {
        for (const [key, fns] of this.waiters) {
            const layout = this.cache.get(key);
            fns.forEach(fn => fn(layout));
        }
        this.waiters.clear();
    }

    /** Pick the next snapshot to lay out: ahead of the playhead first, then behind, then the rest. */
    private nextIndex(): number | undefined {
        const n = this.keys.length;
        const todo = (i: number) => {
            const k = this.keys[i];
            return !this.cache.has(k) && !this.failed.has(k);
        };
        const ahead = Math.min(n, this.focus + LOOKAHEAD);
        for (let i = this.focus; i < ahead; i++) if (todo(i)) return i;
        for (let i = this.focus - 1; i >= Math.max(0, this.focus - LOOKAHEAD); i--) if (todo(i)) return i;
        for (let i = ahead; i < n; i++) if (todo(i)) return i;
        for (let i = 0; i < n; i++) if (todo(i)) return i;
        return undefined;
    }

    private async pump() {
        if (this.busy || !this.timeline) return;
        const index = this.nextIndex();
        if (index === undefined) return;

        this.busy = true;
        const generation = this.generation;
        const key = this.keys[index];
        const state = this.timeline.states[index];
        let layout: LayoutData | undefined;
        try {
            layout = await this.computeLayout(state);
        } catch (err) {
            console.error(`[LayoutManager] Layout failed for snapshot ${index}:`, err);
        }
        this.busy = false;

        if (generation === this.generation) {
            const attempts = (this.attempts.get(key) ?? 0) + 1;
            this.attempts.set(key, attempts);
            const settled = !!layout || attempts >= MAX_ATTEMPTS;
            if (layout) this.cache.set(key, layout);
            else if (settled) this.failed.add(key);
            const fns = settled ? this.waiters.get(key) : undefined;
            if (fns) {
                this.waiters.delete(key);
                fns.forEach(fn => fn(layout));
            }
            this.listeners.forEach(l => l());
        }
        this.pump();
    }
}

/**
 * Load layout config from localStorage if available
 */
function loadConfigFromStorage(): LayoutConfig | null {
    if (typeof localStorage === 'undefined') return null;

    try {
        const stored = localStorage.getItem('egraph-vis-layout-config');
        if (stored) {
            return { ...DEFAULT_LAYOUT_CONFIG, ...JSON.parse(stored) };
        }
    } catch (e) {
        console.error('Failed to load layout config from storage:', e);
    }
    return null;
}

// Global singleton instance - initialize with saved config if available
export const layoutManager = new LayoutManager(loadConfigFromStorage() || DEFAULT_LAYOUT_CONFIG);
