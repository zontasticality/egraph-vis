# Specification

An interactive visualization of the equality-saturation algorithm from [egg: Fast and Extensible Equality Saturation](./egraphs-good.pdf), implemented with Svelte 5 runes.

This repo now splits the specification into focused documents so each concern can evolve independently:

| Spec | Purpose |
| --- | --- |
| [SPEC-ARCHITECTURE.md](./SPEC-ARCHITECTURE.md) | Application state flow, controller & playback model, immutable timeline pipeline. |
| [SPEC-ENGINE.md](./SPEC-ENGINE.md) | E-graph data structures, operations, rewrite system, instrumentation hooks. |
| [SPEC-UI.md](./SPEC-UI.md) | Pane layouts, interaction details, animation & highlighting rules. |
| [SPEC-TESTING.md](./SPEC-TESTING.md) | Required regression fixtures and contract tests for engine ↔ UI parity. |
| [SPEC-PRESETS.md](./SPEC-PRESETS.md) | Schema for preset expressions, rewrite sets, and visualization metadata. |

## Core Experience

- **Multi-pane layout**: Graph pane (visual topology), State pane (Hashcons, E-class Map, Union-Find, Worklist), and a Controller & Preset selector. Pane-specific requirements live in `SPEC-UI.md`.
- **Immutable timeline**: The equality-saturation engine runs through the preset once, using persistent data structures (via mutative) so every step yields a new structural snapshot that shares memory with predecessors (`SPEC-ARCHITECTURE.md`). The playback bar simply switches the referenced snapshot for high-speed scrubbing.
- **Controller contract**: Users can play, pause, step (Read/Write/Rebuild), jump to phase markers, or scrub through the cached snapshots. Controller enable/disable logic is defined alongside the timeline rules.
- **Data transparency**: Each snapshot exposes the engine state needed by the panes—graph nodes/edges, per-pane derived data, violation metadata, and selection markers. No mutable Maps/Sets leak outside the engine boundary.

See the linked documents for deep dives into each area. This file stays intentionally high-level and should only include information necessary to orient a contributor before diving into a dedicated spec.
