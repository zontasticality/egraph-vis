import type {
    ENodeId,
    ENode,
    EClassRuntime,
    DiffEvent,
    ParentInfo
} from './types';

export class SeededRandom {
    private seed: number;

    constructor(seed: number) {
        this.seed = seed;
    }

    next(): number {
        // Simple LCG (Linear Congruential Generator)
        this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
        return this.seed / 0x7fffffff;
    }
}

export class UnionFind {
    private parent: number[] = [];

    get size(): number {
        return this.parent.length;
    }

    makeSet(id: number) {
        // Ensure array is large enough
        while (this.parent.length <= id) {
            this.parent.push(this.parent.length);
        }
        this.parent[id] = id;
    }

    find(id: number): number {
        if (!(id >= 0 && id < this.parent.length)) {
            throw new Error(`Unknown ENodeId: ${id}`);
        }
        // Iterative find with path compression (no recursion depth limits)
        let root = id;
        while (this.parent[root] !== root) {
            root = this.parent[root];
        }
        let cur = id;
        while (this.parent[cur] !== root) {
            const next = this.parent[cur];
            this.parent[cur] = root;
            cur = next;
        }
        return root;
    }

    union(a: number, b: number, rng?: SeededRandom): number {
        const rootA = this.find(a);
        const rootB = this.find(b);

        if (rootA === rootB) {
            return rootA;
        }

        // Use seeded randomness if provided, otherwise min-ID strategy
        let winner: number, loser: number;
        if (rng && rng.next() > 0.5) {
            winner = Math.max(rootA, rootB);
            loser = Math.min(rootA, rootB);
        } else {
            winner = Math.min(rootA, rootB);
            loser = Math.max(rootA, rootB);
        }

        this.parent[loser] = winner;
        return winner;
    }

    // Helper to export state for snapshots
    toArray(): Array<{ id: number; canonical: number; isCanonical: boolean }> {
        return this.parent.map((_, id) => {
            const canonical = this.find(id);
            return {
                id,
                canonical,
                isCanonical: id === canonical
            };
        });
    }
}

/** Result of repairing a single e-class (one step of congruence closure). */
export interface RepairResult {
    /** Every parent e-node that was examined. */
    parentNodes: ENodeId[];
    /** E-nodes whose stored children were re-canonicalized. */
    updatedNodes: ENodeId[];
    /** Pairs of e-classes that were found congruent and merged. */
    merges: Array<[ENodeId, ENodeId]>;
    /** Duplicate e-nodes removed after becoming identical to another e-node. */
    removedNodes: ENodeId[];
}

/**
 * Mutable e-graph following the structure of egg (Willsey et al. 2021):
 * union-find + e-class map + hashcons + worklist, with `merge` (union) and a
 * `repairClass` step used by rebuilding to restore the congruence and
 * hashcons invariants.
 *
 * E-node IDs double as e-class IDs: every e-node starts in its own e-class
 * whose ID is the e-node's ID.
 */
export class EGraphRuntime {
    unionFind = new UnionFind();
    eclasses = new Map<ENodeId, EClassRuntime>();
    /** Canonical e-node key -> e-class ID (possibly stale; always `find()` the value). */
    hashcons = new Map<string, ENodeId>();
    /** Registry of every e-node ever created, indexed by ID, in its *stored* form. */
    nodes: ENode[] = [];
    /** E-nodes that were deduplicated away during rebuilding. */
    removedNodes = new Set<ENodeId>();
    worklist = new Set<ENodeId>();
    nextId = 0;
    diffs: DiffEvent[] = [];
    /** Bumped on every hashcons mutation so snapshots can share unchanged copies. */
    hashconsVersion = 0;
    /** Number of successful unions performed so far. */
    unionCount = 0;

    addEnode(enode: ENode): ENodeId {
        const canonical = this.canonicalize(enode);
        const key = this.canonicalKey(canonical);

        const existing = this.hashcons.get(key);
        if (existing !== undefined) {
            return this.find(existing);
        }

        const id = this.nextId++;
        this.unionFind.makeSet(id);

        const newClass: EClassRuntime = {
            id,
            nodes: [id],
            parents: new Map(),
            version: 0
        };

        this.eclasses.set(id, newClass);
        this.hashcons.set(key, id);
        this.hashconsVersion++;

        // Register as a parent of each (distinct) child class
        for (const childId of new Set(canonical.args)) {
            const childClass = this.eclasses.get(childId);
            if (childClass) {
                childClass.parents.set(String(id), { parentId: id, enode: canonical });
            }
        }

        this.diffs.push({ type: 'add', nodeId: id, enode: canonical });
        this.nodes[id] = canonical;
        return id;
    }

    /**
     * Union two e-classes.
     *
     * - `naive`: nodes are moved into the winning class immediately and the
     *   losing class is deleted.
     * - `deferred`: only the union-find and parent lists are updated; the losing
     *   class keeps its nodes until it is compacted during rebuild.
     *
     * In both modes the winner is pushed onto the worklist so its parents can
     * be repaired later.
     */
    merge(a: ENodeId, b: ENodeId, implementation: 'naive' | 'deferred' = 'naive', rng?: SeededRandom): ENodeId {
        const rootA = this.find(a);
        const rootB = this.find(b);

        if (rootA === rootB) {
            return rootA;
        }

        const winner = this.unionFind.union(rootA, rootB, rng);
        const loser = winner === rootA ? rootB : rootA;
        this.unionCount++;

        const winnerClass = this.eclasses.get(winner)!;
        const loserClass = this.eclasses.get(loser)!;

        winnerClass.version++;

        // The winner inherits all parents of the loser: they now point into it.
        for (const [key, parentInfo] of loserClass.parents) {
            winnerClass.parents.set(key, parentInfo);
        }

        this.diffs.push({ type: 'merge', winner, losers: [loser] });
        this.worklist.add(winner);

        if (implementation === 'deferred') {
            // Physical merge happens later during compaction.
            return winner;
        }

        this.absorbClass(winnerClass, loserClass);
        return winner;
    }

    /** Move all nodes/data of `loser` into `winner` and delete `loser`. */
    absorbClass(winnerClass: EClassRuntime, loserClass: EClassRuntime) {
        winnerClass.nodes.push(...loserClass.nodes);
        for (const [key, parentInfo] of loserClass.parents) {
            winnerClass.parents.set(key, parentInfo);
        }
        if (loserClass.data) {
            winnerClass.data = { ...winnerClass.data, ...loserClass.data };
        }
        winnerClass.version++;
        this.eclasses.delete(loserClass.id);
    }

    /**
     * Restore invariants for the parents of one e-class (egg's `repair`):
     *  1. Re-canonicalize each parent e-node and re-insert it into the hashcons.
     *  2. Deduplicate parents; parents that became identical are congruent, so
     *     their e-classes are merged (eagerly) and the duplicate e-node removed.
     */
    repairClass(eclassId: ENodeId): RepairResult {
        const result: RepairResult = { parentNodes: [], updatedNodes: [], merges: [], removedNodes: [] };
        const eclass = this.eclasses.get(eclassId);
        if (!eclass) return result;

        const parents = Array.from(eclass.parents.values()).filter(
            p => !this.removedNodes.has(p.parentId)
        );
        result.parentNodes = parents.map(p => p.parentId);

        // 1. Hashcons maintenance + update stored children of each parent e-node
        for (const p of parents) {
            const stored = this.nodes[p.parentId];
            this.hashcons.delete(this.canonicalKey(p.enode));
            this.hashcons.delete(this.canonicalKey(stored));
            const canon = this.canonicalize(stored);
            this.hashcons.set(this.canonicalKey(canon), this.find(p.parentId));
            if (!sameArgs(stored.args, canon.args)) {
                this.nodes[p.parentId] = canon;
                result.updatedNodes.push(p.parentId);
                const owner = this.eclasses.get(this.find(p.parentId));
                if (owner) owner.version++;
            }
        }
        this.hashconsVersion++;

        // 2. Deduplicate parents, remembering which ones are congruent
        //    (parent maps are keyed by e-node ID; `seen` dedups by canonical form)
        const newParents = new Map<string, ParentInfo>();
        const seen = new Map<string, ENodeId>();
        const congruent: Array<[ENodeId, ENodeId]> = [];
        for (const p of parents) {
            const canon = this.nodes[p.parentId];
            const key = this.canonicalKey(canon);
            const existing = seen.get(key);
            if (existing !== undefined && existing !== p.parentId) {
                congruent.push([existing, p.parentId]);
                continue;
            }
            seen.set(key, p.parentId);
            newParents.set(String(p.parentId), { parentId: p.parentId, enode: canon });
        }
        // Assign before merging so merges append the loser's parents correctly.
        eclass.parents = newParents;

        for (const [keep, dup] of congruent) {
            const before = this.find(keep) !== this.find(dup);
            if (before) {
                this.merge(keep, dup, 'naive');
                result.merges.push([keep, dup]);
            }
            this.removeDuplicateNode(dup, keep);
            result.removedNodes.push(dup);
        }

        if (result.merges.length > 0) {
            this.hashconsVersion++;
        }
        return result;
    }

    /** Remove `dup` from its e-class (it is identical to `keep`, which lives in the same class). */
    private removeDuplicateNode(dup: ENodeId, keep: ENodeId) {
        if (this.removedNodes.has(dup)) return;
        const owner = this.eclasses.get(this.find(dup));
        if (!owner) return;
        const idx = owner.nodes.indexOf(dup);
        if (idx === -1) return;
        owner.nodes.splice(idx, 1);
        owner.version++;
        this.removedNodes.add(dup);
        // Make sure the hashcons entry for the shared key points at the class.
        this.hashcons.set(this.canonicalKey(this.nodes[keep]), owner.id);
        this.diffs.push({ type: 'remove', nodeId: dup, duplicateOf: keep });
    }

    find(id: ENodeId): ENodeId {
        return this.unionFind.find(id);
    }

    canonicalize(enode: ENode): ENode {
        return {
            op: enode.op,
            args: enode.args.map(arg => this.find(arg))
        };
    }

    canonicalKey(enode: ENode): string {
        return `${enode.op}(${enode.args.join(',')})`;
    }

    /** IDs of all e-nodes that are still part of some e-class. */
    liveNodeIds(): ENodeId[] {
        const ids: ENodeId[] = [];
        for (const eclass of this.eclasses.values()) ids.push(...eclass.nodes);
        return ids;
    }

    // Helper for rebuild/repair
    // Returns a list of parent classes that need to be inspected
    getParents(id: ENodeId): ParentInfo[] {
        const canonicalId = this.find(id);
        const eclass = this.eclasses.get(canonicalId);
        if (!eclass) return [];
        return Array.from(eclass.parents.values());
    }
}

function sameArgs(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
