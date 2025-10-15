import { describe, it, expect, beforeEach } from 'vitest';
import { EGraphWithHistory } from './egraph-with-history.svelte';

describe('EGraphWithHistory', () => {
  let eg: EGraphWithHistory;

  beforeEach(() => {
    eg = new EGraphWithHistory();
  });

  describe('event tracking', () => {
    it('should record add events', () => {
      eg.add({ op: 'a', args: [] });

      expect(eg.eventCount).toBe(1);
      expect(eg.latestEvent?.type).toBe('add');

      const events = eg.allEvents;
      expect(events[0].type).toBe('add');
      if (events[0].type === 'add') {
        expect(events[0].node.op).toBe('a');
      }
    });

    it('should record merge events', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      eg.merge(a, b);

      const events = eg.allEvents;
      expect(events).toHaveLength(3); // 2 adds + 1 merge

      const mergeEvent = events[2];
      expect(mergeEvent.type).toBe('merge');
      if (mergeEvent.type === 'merge') {
        expect(mergeEvent.id1).toBe(a);
        expect(mergeEvent.id2).toBe(b);
      }
    });

    it('should record rebuild events', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      eg.merge(a, b);
      eg.rebuild();

      const events = eg.allEvents;

      // Should have: 2 adds, 1 merge, rebuild_start, rebuild_complete
      expect(events.length).toBeGreaterThanOrEqual(5);

      const hasRebuildStart = events.some(e => e.type === 'rebuild_start');
      const hasRebuildComplete = events.some(e => e.type === 'rebuild_complete');

      expect(hasRebuildStart).toBe(true);
      expect(hasRebuildComplete).toBe(true);
    });

    it('should include timestamps', () => {
      const before = Date.now();
      eg.add({ op: 'a', args: [] });
      const after = Date.now();

      const event = eg.latestEvent!;
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('snapshots', () => {
    it('should create snapshots on merge by default', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      eg.merge(a, b);

      // Should have at least one snapshot
      expect(eg.snapshots.size).toBeGreaterThan(0);
    });

    it('should create snapshots on rebuild by default', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      eg.merge(a, b);
      eg.rebuild();

      // Should have snapshots
      expect(eg.snapshots.size).toBeGreaterThan(0);
    });

    it('should allow disabling snapshots', () => {
      eg.setSnapshotConfig({ onMerge: false, onRebuild: false });

      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      eg.merge(a, b);
      eg.rebuild();

      expect(eg.snapshots.size).toBe(0);
    });

    it('should capture e-graph state in snapshots', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      eg.merge(a, b);

      const eventIndex = eg.eventCount - 1;
      const snapshot = eg.getSnapshot(eventIndex);

      expect(snapshot).toBeDefined();
      expect(snapshot!.eclasses.length).toBeGreaterThan(0);
      expect(snapshot!.hashcons.size).toBeGreaterThan(0);
    });
  });

  describe('event timeline', () => {
    it('should group events by type', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const c = eg.add({ op: 'c', args: [] });

      eg.merge(a, b);
      eg.merge(b, c);

      eg.rebuild();

      const timeline = eg.getEventTimeline();

      expect(timeline.adds).toHaveLength(3);
      expect(timeline.merges).toHaveLength(2);
      expect(timeline.rebuilds).toHaveLength(1);
    });

    it('should pair rebuild start and complete', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      eg.merge(a, b);
      eg.rebuild();

      const timeline = eg.getEventTimeline();

      expect(timeline.rebuilds).toHaveLength(1);
      expect(timeline.rebuilds[0].start.type).toBe('rebuild_start');
      expect(timeline.rebuilds[0].complete.type).toBe('rebuild_complete');
    });
  });

  describe('history management', () => {
    it('should allow clearing history', () => {
      eg.add({ op: 'a', args: [] });
      eg.add({ op: 'b', args: [] });

      expect(eg.eventCount).toBeGreaterThan(0);

      eg.clearHistory();

      expect(eg.eventCount).toBe(0);
      expect(eg.snapshots.size).toBe(0);
    });

    it('should export history as JSON', () => {
      eg.add({ op: 'a', args: [] });
      eg.add({ op: 'b', args: [] });

      const json = eg.exportHistory();
      const parsed = JSON.parse(json);

      expect(parsed.events).toHaveLength(2);
      expect(parsed.finalStats).toBeDefined();
      expect(parsed.finalStats.eclassCount).toBeGreaterThan(0);
    });
  });

  describe('integration with e-graph operations', () => {
    it('should maintain e-graph functionality while tracking', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const fa = eg.add({ op: 'f', args: [a] });
      const fb = eg.add({ op: 'f', args: [b] });

      eg.merge(a, b);
      eg.rebuild();

      // E-graph should work correctly
      expect(eg.find(fa)).toBe(eg.find(fb));
      expect(eg.invariantsValid).toBe(true);

      // History should be recorded
      expect(eg.eventCount).toBeGreaterThan(0);

      const timeline = eg.getEventTimeline();
      expect(timeline.adds).toHaveLength(4);
      // Merge count includes user-initiated merge plus congruence repairs
      expect(timeline.merges.length).toBeGreaterThanOrEqual(1);
      expect(timeline.rebuilds).toHaveLength(1);
    });

    it('should handle complex example with history', () => {
      // (a × 2) / 2 example
      const a = eg.add({ op: 'a', args: [] });
      const two = eg.add({ op: '2', args: [] });
      const mul = eg.add({ op: '*', args: [a, two] });
      const div = eg.add({ op: '/', args: [mul, two] });

      const one = eg.add({ op: '1', args: [] });
      const shl = eg.add({ op: '<<', args: [a, one] });

      eg.merge(mul, shl);
      eg.rebuild();

      // Verify e-graph state
      expect(eg.find(mul)).toBe(eg.find(shl));
      expect(eg.invariantsValid).toBe(true);

      // Verify history
      const timeline = eg.getEventTimeline();
      expect(timeline.adds.length).toBeGreaterThan(0);
      expect(timeline.merges).toHaveLength(1);
      expect(timeline.rebuilds).toHaveLength(1);

      // Export should work
      const json = eg.exportHistory();
      // JSON is formatted with spaces, so check for the formatted version
      expect(json).toContain('"type": "add"');
      expect(json).toContain('"type": "merge"');
      expect(json).toContain('"type": "rebuild_start"');
    });
  });

  describe('snapshot retrieval', () => {
    it('should return undefined for non-existent snapshot', () => {
      const snapshot = eg.getSnapshot(999);
      expect(snapshot).toBeUndefined();
    });

    it('should return correct snapshot for given event', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      const beforeMerge = eg.allEClasses.length;

      eg.merge(a, b);

      const mergeEventIndex = eg.eventCount - 1;
      const snapshot = eg.getSnapshot(mergeEventIndex);

      if (snapshot) {
        // Snapshot should show merged state
        expect(snapshot.eclasses.length).toBeLessThan(beforeMerge);
      }
    });
  });

  describe('performance with history', () => {
    it('should not significantly slow down operations', () => {
      const n = 100;

      const start = performance.now();

      for (let i = 0; i < n; i++) {
        eg.add({ op: `n${i}`, args: [] });
      }

      const end = performance.now();

      // Should complete in reasonable time
      expect(end - start).toBeLessThan(1000);

      // Should have all events
      expect(eg.eventCount).toBe(n);
    });
  });
});
