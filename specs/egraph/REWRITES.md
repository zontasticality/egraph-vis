# REWRITES & SATURATION

Defines the rewrite rule format and the equality-saturation workflow.

## 1. Rewrite Rule Schema
```ts
interface RewriteRule {
  name: string;                 // unique identifier
  lhs: Pattern;                 // pattern syntax per LANGUAGE.md
  rhs: Pattern;
  enabled: boolean;             // toggled per preset or controller
  priority?: number;            // optional ordering hint (lower first)
}
```
- `rhs` may only reference pattern variables present in `lhs`. Attempting to use undefined variables is a validation error.
- Rules are evaluated in the provided order; use `priority` to override natural order if required.

## 2. Matching
- `collectMatches(rewrites, runtime)` iterates through every enabled rule, scanning all e-classes and nodes.
- Matching returns tuples `{ rule, eclassId, substitution }` where substitution maps pattern vars to canonical ids.
- Duplicate matches (same rule + substitution + target class) may be deduped to reduce churn.

## 3. Applying Rewrites
- For each match, instantiate `rhs` by replacing pattern vars with canonical ids from the substitution, producing a concrete `ENode`.
- Call `addEnode` and merge with the target e-class.
- Record metadata diff referencing `rule.name` for UI display.
- In deferred mode, newly merged classes must be added to the worklist.

## 4. Equality-Saturation Loop
```
while (iteration < iterationCap) {
  emitSnapshot('read');
  matches = collectMatches(...);
  if matches.empty(): break;
  emitSnapshot('write');
  applyMatches(matches);
  if impl === 'deferred': {
    emitSnapshot('rebuild');
    rebuild();
  } else {
    emitSnapshot('rebuild'); // noop but keeps parity
  }
  iteration++;
}
emitSnapshot('done');
```
- The engine may batch `collectMatches`/`applyMatches` to reduce snapshot count (e.g., only emit after both phases). Whatever schedule is chosen must be documented in `StepMetadata.phase`.
- If `iterationCap` is reached, throw `IterationCapExceededError` after emitting a final snapshot flagged with `metadata.haltedReason = 'iteration-cap'`.

## 5. Halt Detection Enhancements
Optional heuristics to avoid infinite states:
- **Worklist exhaustion**: after rebuild, if worklist empty and no matches remain → halt.
- **E-graph size cap**: `options.maxNodes` stops execution once `nextId` exceeds a threshold, flagging metadata accordingly.

## 6. Validation Rules
- During preset loading, validate each rewrite (variables, JSON schema) before constructing the engine.
- When running in debug mode, log rejected matches (e.g., referencing unknown ids) for developer insight.

## 7. Instrumentation
`metadata.diffs` entries referencing rewrites should include:
```ts
{
  type: 'rewrite',
  rule: string,
  targetClass: number,
  createdId: number,
  mergedInto: number
}
```
This allows the UI to highlight which rewrite fired at each step.
