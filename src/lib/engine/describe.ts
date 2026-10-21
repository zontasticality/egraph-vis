import type { EGraphState, HaltReason, Phase } from './types';

export const PHASE_LABELS: Record<Phase, string> = {
    init: 'Init',
    read: 'Read',
    'read-batch': 'Read',
    write: 'Write',
    compact: 'Compact',
    repair: 'Repair',
    done: 'Done'
};

export const PHASE_DESCRIPTIONS: Record<Phase, string> = {
    init: 'The initial term is added to the e-graph, one e-class per e-node.',
    read: 'E-matching: every rule is searched for in every e-class. The e-graph is not modified.',
    'read-batch': 'E-matching one batch of e-classes (simulating parallel search). Matches go into the writelist; the e-graph is not modified.',
    write: 'A rewrite is applied: its right-hand side is added and unioned with the matched e-class.',
    compact: 'An e-class that was unioned away is folded into its canonical representative.',
    repair: 'Rebuilding: the parents of an e-class from the worklist are re-canonicalized; parents that became identical are merged (congruence).',
    done: 'Equality saturation has stopped.'
};

export const HALT_DESCRIPTIONS: Record<HaltReason, string> = {
    saturated: 'Saturated: no rule can add anything new',
    'iteration-cap': 'Stopped at the iteration cap',
    'node-limit': 'Stopped: the e-graph hit the node limit',
    'step-limit': 'Stopped: the timeline hit the step limit',
    canceled: 'Canceled'
};

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function listIds(ids: number[], max = 6): string {
    if (ids.length <= max) return ids.join(', ');
    return `${ids.slice(0, max).join(', ')}, … (+${ids.length - max})`;
}

/** One-line, human readable summary of what happened in a snapshot. */
export function describeStep(state: EGraphState): string {
    const m = state.metadata;
    const nodes = state.eclasses.reduce((n, c) => n + c.nodes.length, 0);
    switch (state.phase) {
        case 'init':
            return `Built the initial term: ${plural(nodes, 'e-node')} in ${plural(state.eclasses.length, 'e-class', 'e-classes')}`;
        case 'read-batch': {
            const b = m.batch;
            const found = m.matches.length;
            const where = b ? `e-class${b.classIds.length === 1 ? '' : 'es'} ${listIds(b.classIds)} (batch ${b.index + 1}/${b.total})` : 'e-classes';
            const queued = m.writelist ? ` · writelist: ${m.writelist.count}` : '';
            return `Searching ${where} — ${found === 0 ? 'no matches' : plural(found, 'match', 'matches')}${queued}`;
        }
        case 'read': {
            const found = m.matches.length;
            return `Searched every e-class — ${found === 0 ? 'no matches' : plural(found, 'match', 'matches')}`;
        }
        case 'write': {
            const a = m.applied;
            if (!a) return 'Applying a rewrite';
            const created = a.newNodes.length > 0 ? `, +${plural(a.newNodes.length, 'new e-node')}` : '';
            const entry = m.writelist ? ` (entry ${m.writelist.nextIndex} of ${m.writelist.count})` : '';
            return `Applying ${a.rule}: union e-class ${a.targetClass} with ${a.createdId}${created}${entry}`;
        }
        case 'compact':
            return `Compacting e-class ${m.compactedId} into canonical e-class ${m.activeId}`;
        case 'repair': {
            const parents = m.repairedNodes?.length ?? 0;
            const merges = m.diffs.filter(d => d.type === 'merge').length;
            const removed = m.diffs.filter(d => d.type === 'remove').length;
            const extra = [
                merges > 0 ? `${plural(merges, 'congruent merge')}` : '',
                removed > 0 ? `${plural(removed, 'duplicate e-node')} removed` : ''
            ].filter(Boolean).join(', ');
            return `Repairing e-class ${m.activeId}: checked ${plural(parents, 'parent')}${extra ? ` → ${extra}` : ''}`;
        }
        case 'done':
            return `${HALT_DESCRIPTIONS[m.haltedReason ?? 'saturated']} · ${plural(state.eclasses.length, 'e-class', 'e-classes')}, ${plural(nodes, 'e-node')}`;
    }
}
