import type {
    ENodeId,
    ENode,
    EClassRuntime,
    DiffEvent,
    ParentInfo
} from './types';

export class UnionFind {
    private parent: number[] = [];

    makeSet(id: number) {
        // Ensure array is large enough
        while (this.parent.length <= id) {
            this.parent.push(this.parent.length);
        }
        this.parent[id] = id;
    }

    find(id: number): number {
        if (id >= this.parent.length) {
            throw new Error(`Unknown ENodeId: ${id}`);
        }
        if (this.parent[id] === id) {
            return id;
        }
        // Path compression
        this.parent[id] = this.find(this.parent[id]);
        return this.parent[id];
    }

    union(a: number, b: number): number {
        const rootA = this.find(a);
        const rootB = this.find(b);

        if (rootA === rootB) {
            return rootA;
        }

        // Smaller ID wins strategy for visual stability
        const winner = Math.min(rootA, rootB);
        const loser = Math.max(rootA, rootB);

        this.parent[loser] = winner;
        return winner;
    }

    // Helper to export state for snapshots
    toArray(): Array<{ id: number; canonical: number; isCanonical: boolean }> {
        return this.parent.map((p, id) => {
            const canonical = this.find(id);
            return {
                id,
                canonical,
                isCanonical: id === canonical
            };
        });
    }
}

export class EGraphRuntime {
    unionFind = new UnionFind();
    eclasses = new Map<ENodeId, EClassRuntime>();
    hashcons = new Map<string, ENodeId>();
    worklist = new Set<ENodeId>();
    nextId = 0;
    diffs: DiffEvent[] = [];

    addEnode(enode: ENode): ENodeId {
        const canonical = this.canonicalize(enode);
        const key = this.canonicalKey(canonical);

        if (this.hashcons.has(key)) {
            return this.hashcons.get(key)!;
        }

        const id = this.nextId++;
        this.unionFind.makeSet(id);

        const newClass: EClassRuntime = {
            id,
            nodes: [canonical],
            parents: new Map(),
            version: 0
        };

        this.eclasses.set(id, newClass);
        this.hashcons.set(key, id);

        // Update parents for children
        for (const childId of canonical.args) {
            const childClass = this.eclasses.get(childId);
            if (childClass) {
                childClass.parents.set(`${id}:${key}`, { parentId: id, enode: canonical });
                childClass.version++;
            }
        }

        this.diffs.push({ type: 'add', nodeId: id, enode: canonical });
        return id;
    }

    merge(a: ENodeId, b: ENodeId): ENodeId {
        const rootA = this.find(a);
        const rootB = this.find(b);

        if (rootA === rootB) {
            return rootA;
        }

        const winner = this.unionFind.union(rootA, rootB);
        const loser = winner === rootA ? rootB : rootA;

        const winnerClass = this.eclasses.get(winner)!;
        const loserClass = this.eclasses.get(loser)!;

        // Increment version of winner (it changed)
        winnerClass.version++;

        // IMPORTANT: Increment version of all PARENTS of the loser.
        // Their canonical args have changed (pointing to loser -> pointing to winner).
        // We must do this so the snapshot generator knows to re-render them.
        for (const parentInfo of loserClass.parents.values()) {
            const parentClass = this.eclasses.get(parentInfo.parentId);
            if (parentClass) {
                parentClass.version++;
            }
        }

        // Merge nodes
        winnerClass.nodes.push(...loserClass.nodes);

        // Merge parents
        for (const [key, parentInfo] of loserClass.parents) {
            winnerClass.parents.set(key, parentInfo);
        }

        winnerClass.version++;

        // Merge data (if any) - simple overwrite for now, spec doesn't specify merge strategy for data
        if (loserClass.data) {
            winnerClass.data = { ...winnerClass.data, ...loserClass.data };
        }

        // Update hashcons for nodes moving to winner
        // We don't strictly need to update hashcons for *existing* nodes in the loser class 
        // because their canonical key might change, but they are already in the e-class.
        // However, future lookups might fail if we don't re-insert them with new keys?
        // Actually, hashcons maps Key -> EClassId. 
        // The Key depends on children's canonical IDs. 
        // Since children didn't change (we merged A and B, not their children), 
        // the keys of nodes *inside* A and B don't change yet.
        // BUT, if A or B were children of some other node C, then C's key changes.
        // That is handled by `rebuild`.
        // Here we just need to ensure `hashcons` points to `winner` for any keys that pointed to `loser`.
        // But wait, `hashcons` keys are structural. 
        // If `op(x)` was in `loser`, `hashcons[op(x)]` was `loser`.
        // Now it should be `winner`.
        for (const node of loserClass.nodes) {
            const key = this.canonicalKey(node);
            this.hashcons.set(key, winner);
        }

        this.eclasses.delete(loser);
        this.diffs.push({ type: 'merge', winner, losers: [loser] });

        // In deferred mode, we'll add to worklist in the algorithms layer or here?
        // OPERATIONS.md says: "Deferred: merge pushes canonical id into worklist Set."
        // It's safer to always add to worklist here, and naive mode just ignores it or clears it.
        this.worklist.add(winner);

        return winner;
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

    // Helper for rebuild/repair
    // Returns a list of parent classes that need to be inspected
    getParents(id: ENodeId): { parentId: ENodeId; enode: ENode }[] {
        const canonicalId = this.find(id);
        const eclass = this.eclasses.get(canonicalId);
        if (!eclass) return [];
        return Array.from(eclass.parents.values());
    }
}
