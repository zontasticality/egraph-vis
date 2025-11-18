# PRESETS

Defines how preset scenarios (initial expressions + rewrite sets) are authored for the e-graph engine.

## 1. Directory Layout
```
static/presets/
  index.json                // summarized list for UI
  <presetId>/
    config.json             // full preset per schema below
    notes.md (optional)
```

## 2. Schema
Using Zod-style notation:
```ts
const Pattern = z.object({
  op: z.string(),
  args: z.array(z.union([z.string(), Pattern])),
});

const PresetConfig = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  root: Pattern,                     // initial expression tree
  rewrites: z.array(RewriteRule),    // see REWRITES.md
  implementationHints: z.object({
    defaultImpl: z.enum(['naive', 'deferred']).default('deferred'),
    iterationCap: z.number().int().positive().default(250),
  }).default({}),
  visualization: z.object({
    autoPlay: z.boolean().default(true),
    highlightNodes: z.array(z.number()).default([]),
  }).default({}),
});
```
Notes:
- `root` may include pattern variables for convenience; during ingestion the engine replaces them with deterministic ids.
- `config.json` must not contain comments; keep metadata in `notes.md` if needed.

## 3. `index.json`
Each entry includes enough info for dropdowns without loading the entire preset:
```json
{
  "id": "arith:add-sub",
  "label": "Arithmetic: Add/Sub",
  "description": "Showcases distributivity",
  "tags": ["demo", "algebra"],
  "defaultImpl": "deferred"
}
```

## 4. Validation Workflow
1. Run `pnpm preset:validate` (CLI to be implemented) to ensure schema compliance.
2. Generate/update timeline fixtures via `pnpm timeline:generate --preset <id>`.
3. Commit both `config.json` and fixtures to keep contract tests reproducible.

## 5. Versioning Guidance
- Add optional `version` field to `config.json`; timeline fixtures should reference `<id>@<version>`.
- When breaking changes occur (new rewrites, different root), bump `version` and regenerate fixtures.

## 6. Non-Goals
- Presets do not describe UI layout, controller defaults, or styling. Those belong to higher-level specs.
