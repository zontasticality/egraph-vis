# SPEC-PRESETS: Preset & Rewrite Schema

Defines how preset scenarios are stored under `static/presets/` so the TimelineEngine can preload them.

## 1. File Layout
```
static/presets/
  index.json            // array of preset summaries for dropdown
  <presetId>/
    config.json         // main preset definition (see schema below)
    notes.md            // optional background info
```

## 2. Schema
Using TypeScript/Zod for clarity:
```ts
const RewritePattern = z.object({
  op: z.string(),
  args: z.array(z.union([z.number(), z.string()])), // string args start with '?'
});

const RewriteRule = z.object({
  name: z.string(),
  lhs: RewritePattern,
  rhs: RewritePattern,
  enabled: z.boolean().default(true),
});

const PresetConfig = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  rootExpression: RewritePattern, // starting AST using numeric ids for constants/vars
  implementationHints: z.object({
    defaultImpl: z.enum(['naive', 'deferred']).default('deferred'),
    iterationCap: z.number().int().positive().default(250),
  }).default({}),
  rewrites: z.array(RewriteRule),
  visualization: z.object({
    highlightNodes: z.array(z.number()).default([]),
    autoPlay: z.boolean().default(true),
    hideWorklist: z.boolean().default(false),
  }).default({}),
});
```
- Pattern args referencing variables use `"?x"` syntax.
- Constants/variables introduced in `rootExpression` must have unique ids so the engine can seed the e-graph deterministically.

## 3. `index.json` Entries
```json
[
  {
    "id": "arith-add-sub",
    "label": "Arithmetic: Add/Sub",
    "description": "Shows distributivity rewrites",
    "tags": ["arithmetic", "demo"],
    "defaultImpl": "deferred"
  }
]
```

## 4. Versioning & Compatibility
- Each preset folder may include `version`: bump when rewrites or expression change.
- Timeline fixtures reference `<presetId>@<version>` to avoid cache collisions.
- When a preset is removed, also delete its fixtures/tests or mark them deprecated.

## 5. Authoring Workflow
1. Create new folder under `static/presets/<id>/`.
2. Write `config.json` adhering to the schema; run `pnpm preset:validate`.
3. Add entry to `index.json`.
4. Run `pnpm timeline:generate --preset <id>` to bake snapshots for testing.
5. Document scenario in `notes.md` if non-trivial (e.g., Outline what the viewer should learn).

## 6. Runtime Consumption
- App loads `index.json` at startup (cached fetch or import) to populate dropdown.
- Selecting a preset fetches `<presetId>/config.json`, validates it, then passes to `TimelineEngine`.
- Visualization metadata (e.g., `highlightNodes`) seeds initial selection state.

Keeping presets structured avoids ad-hoc JSON and ensures the controller + documentation stay in sync.
