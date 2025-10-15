/**
 * E-graph wrapper that records history of operations for animation/debugging
 * Extends DeferredEGraph with event tracking
 */

import { DeferredEGraph } from './deferred-egraph.svelte';
import type { ENode, ENodeId, EGraphEvent, EGraphSnapshot } from './types';

export class EGraphWithHistory extends DeferredEGraph {
  // Reactive event history
  history = $state<EGraphEvent[]>([]);
  snapshots = $state(new Map<number, EGraphSnapshot>());

  // Configuration
  private snapshotOnMerge = true;
  private snapshotOnRebuild = true;

  // Derived getters
  get latestEvent() {
    return this.history[this.history.length - 1];
  }

  get eventCount() {
    return this.history.length;
  }

  get allEvents(): readonly EGraphEvent[] {
    return this.history;
  }

  /**
   * Override add to record events
   */
  override add(node: ENode): ENodeId {
    const result = super.add(node);
    this.recordEvent({
      type: 'add',
      node,
      result_id: result,
      timestamp: Date.now()
    });
    return result;
  }

  /**
   * Override merge to record events
   */
  override merge(id1: ENodeId, id2: ENodeId): ENodeId {
    const result = super.merge(id1, id2);
    this.recordEvent({
      type: 'merge',
      id1,
      id2,
      result_id: result,
      timestamp: Date.now()
    });

    if (this.snapshotOnMerge) {
      this.createSnapshot();
    }

    return result;
  }

  /**
   * Override rebuild to record events
   */
  override rebuild(): void {
    const worklistSize = this.worklist.size;

    this.recordEvent({
      type: 'rebuild_start',
      worklist_size: worklistSize,
      timestamp: Date.now()
    });

    super.rebuild();

    this.recordEvent({
      type: 'rebuild_complete',
      timestamp: Date.now()
    });

    if (this.snapshotOnRebuild) {
      this.createSnapshot();
    }
  }

  /**
   * Record an event in history
   */
  private recordEvent(event: EGraphEvent): void {
    this.history.push(event);
  }

  /**
   * Create a snapshot of current e-graph state
   */
  private createSnapshot(): void {
    const snapshot: EGraphSnapshot = {
      eclasses: this.allEClasses.map(ec => ({
        ...ec,
        nodes: [...ec.nodes],
        parents: new Map(ec.parents)
      })),
      hashcons: new Map(this.hashcons),
      worklist: new Set(this.worklist)
    };

    this.snapshots.set(this.history.length - 1, snapshot);
  }

  /**
   * Get snapshot at a specific event index
   */
  getSnapshot(eventIndex: number): EGraphSnapshot | undefined {
    return this.snapshots.get(eventIndex);
  }

  /**
   * Clear all history and snapshots
   */
  clearHistory(): void {
    this.history = [];
    this.snapshots.clear();
  }

  /**
   * Configure snapshot behavior
   */
  setSnapshotConfig(config: { onMerge?: boolean; onRebuild?: boolean }): void {
    if (config.onMerge !== undefined) {
      this.snapshotOnMerge = config.onMerge;
    }
    if (config.onRebuild !== undefined) {
      this.snapshotOnRebuild = config.onRebuild;
    }
  }

  /**
   * Get timeline of events grouped by type
   */
  getEventTimeline() {
    const timeline = {
      adds: [] as EGraphEvent[],
      merges: [] as EGraphEvent[],
      rebuilds: [] as { start: EGraphEvent; complete: EGraphEvent }[]
    };

    let rebuildStart: EGraphEvent | null = null;

    for (const event of this.history) {
      switch (event.type) {
        case 'add':
          timeline.adds.push(event);
          break;
        case 'merge':
          timeline.merges.push(event);
          break;
        case 'rebuild_start':
          rebuildStart = event;
          break;
        case 'rebuild_complete':
          if (rebuildStart) {
            timeline.rebuilds.push({ start: rebuildStart, complete: event });
            rebuildStart = null;
          }
          break;
      }
    }

    return timeline;
  }

  /**
   * Export history as JSON for debugging/analysis
   */
  exportHistory(): string {
    return JSON.stringify({
      events: this.history,
      finalStats: this.stats
    }, null, 2);
  }
}
