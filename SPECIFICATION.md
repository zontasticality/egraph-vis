# Specification

An interactive visualization of the equality-saturation algorithm from [egg: Fast and Extensible Equality Saturation](./egraphs-good.pdf), implemented with Svelte 5 runes.

This repo now splits the specification into focused documents so each concern can evolve independently:

| Spec | Purpose |
| --- | --- |
| [specs/app/ARCHITECTURE.md](./specs/app/ARCHITECTURE.md) | Application state flow, controller & playback model, immutable timeline pipeline. |
| [specs/app/UI.md](./specs/app/UI.md) | Pane layouts, interaction details, animation & highlighting rules. |
| [specs/app/TESTING.md](./specs/app/TESTING.md) | App-level regression coverage (stores, panes, integration). |
| [specs/egraph/MAIN.md](./specs/egraph/MAIN.md) | Canonical e-graph specification suite (data model, operations, rewrites, presets, engine tests). |

## Core Experience

- **Multi-pane layout**: Graph pane (visual topology), State pane (Hashcons, E-class Map, Union-Find, Worklist), and a Controller & Preset selector. Pane-specific requirements live in `SPEC-UI.md`.
- **Immutable timeline**: The equality-saturation engine runs through the preset once, using persistent data structures (via mutative) so every step yields a new structural snapshot that shares memory with predecessors (`specs/app/ARCHITECTURE.md`). The playback bar simply switches the referenced snapshot for high-speed scrubbing.
- **Controller contract**: Users can play, pause, step (Read/Write/Rebuild), jump to phase markers, or scrub through the cached snapshots. Controller enable/disable logic is defined alongside the timeline rules.
- **Data transparency**: Each snapshot exposes the engine state needed by the panes—graph nodes/edges, per-pane derived data, violation metadata, and selection markers. No mutable Maps/Sets leak outside the engine boundary.

See the linked documents for deep dives into each area. This file stays intentionally high-level and should only include information necessary to orient a contributor before diving into a dedicated spec.
