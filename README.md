# E-Graph Visualization

An interactive visualization of **e-graphs** and **equality saturation**, based on the paper ["egg: Fast and Extensible Equality Saturation"](https://egraphs-good.github.io/). This project demonstrates how the equality saturation algorithm works step-by-step using an interactive web interface.

- **Two engines**: *naive* (restore invariants after every union) and *deferred* (egg's rebuilding: read every match into a writelist, apply them all, then compact and repair once). The deferred read phase can be batched to simulate parallel search.
- **Every step is a snapshot**: init → read → write → compact → repair → … → done. Scrub, step, jump by phase, or play with smooth animations between snapshots.
- **Faithful rebuilding**: unions leave stale e-node children and hashcons keys behind; repair re-canonicalizes parents, merges congruent ones and removes duplicate e-nodes, exactly as in egg.
- **Linked views**: the graph, e-class table, hashcons, union-find, worklist and writelist highlight the same e-classes on hover and selection.
- **Editable presets**: edit the initial term and rewrite rules live, save your own presets (stored in `localStorage`), import/export them as JSON.

## Development

```sh
npm install
npm run dev        # start the dev server
npm test           # run the test suite
npm run check      # type-check (svelte-check)
npm run build      # static build for GitHub Pages
```

`FC_RUNS=1000 npm test` runs more property-based test cases.

## Architecture

| Path | Purpose |
| --- | --- |
| `src/lib/engine/runtime.ts` | E-graph data structure: union-find, e-classes, hashcons, worklist, `merge`, `repairClass` |
| `src/lib/engine/algorithms.ts` | E-matching, applying rewrites, the compaction + repair rebuild loop |
| `src/lib/engine/timeline.ts` | Runs equality saturation and records structurally shared snapshots |
| `src/lib/engine/invariants.ts` | Checks the congruence/hashcons invariants (used by tests and `debugInvariants`) |
| `src/lib/engine/layout.ts` | ELK layouts (in a web worker), cached per distinct graph structure |
| `src/lib/graph/frame.ts` | Pure frame builder: interpolates two snapshots into positioned shapes and edge paths |
| `src/lib/components/graph_pane/GraphCanvas.svelte` | SVG renderer with pan/zoom and a follow camera |
| `src/lib/stores/timelineStore.ts` | Loading presets, playback, scrubbing and step animations |

See [SPECIFICATION.md](./SPECIFICATION.md) for the original design notes.

## Testing

The suite (Vitest) covers:

- **Engine units**: union-find, hashcons, merging in both modes, congruence repair and deduplication.
- **Property-based tests** (fast-check): random terms × random rule sets; invariants hold after every rebuild, saturation really is saturated, naive and deferred reach the same e-graph, runs are deterministic, disabled rules never fire.
- **Timeline integrity**: phase grammar, snapshot ids, structural sharing, writelist sharing, halting limits, metadata.
- **Presets**: every built-in preset is well formed and runs with valid invariants; known results (e.g. the paper's `(a * 2) / 2 = a`).
- **Layout & rendering**: ELK containment/overlap checks, edge routing, frame interpolation (no NaNs, no dangling edges, merge/dedup animations), viewport math.
- **Stores & components**: playback, load races, preset editing/revert, preset import validation, and rendering of the state pane, controller, rules panel, rule editor and graph canvas (jsdom + Testing Library).
