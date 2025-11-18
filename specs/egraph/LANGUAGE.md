# LANGUAGE

Specifies the term language that presets and rewrites operate on.

## 1. Term Structure
- **Operators (`op`)**: arbitrary ASCII strings without whitespace (examples: `+`, `*`, `pow`, `sin`). There is no built-in arity registry; presets must ensure consistent arity per operator.
- **Arguments (`args`)**: array of `ENodeId` references when stored in the e-graph, or nested pattern objects when authoring presets.
- **Literals**: represented as zero-arity operators (e.g., `"3"`, `"x"`). There is no separate literal type.
- **Variables in patterns**: limited support described below; engine currently disallows introduction of fresh variables in RHS expressions.

## 2. Pattern Syntax
Patterns mirror e-nodes but may use *pattern variables*:
```json
{
  "op": "+",
  "args": ["?a", 0]
}
```
Rules:
- Pattern variables must start with `?` followed by alphanumeric characters.
- A variable binding spans the whole pattern; repeated usage enforces equality (i.e., `?a` must match the same e-class each time).
- Numeric entries reference concrete `ENodeId`s, useful for matching specific literals produced during preset seeding.

## 3. Supported Language Features
| Feature | Status | Notes |
| --- | --- | --- |
| Lambda or binders | Not supported | Future work; would require scoped ids. |
| Fresh RHS variables | Not supported | RHS must consist solely of operators/variables seen in LHS. |
| Constant folding | Implemented via rewrites if desired. |
| Analysis data | Optional `data` blobs can store evaluation hints but are engine-agnostic. |

## 4. Serialization
Presets must express expressions/patterns in JSON following:
```json
{
  "op": "*",
  "args": [
    {
      "op": "+",
      "args": ["?x", "?y"]
    },
    "?x"
  ]
}
```
During preset ingestion, the engine assigns deterministic ids to each literal/variable occurrence to bootstrap the e-graph.

## 5. Future Extensions (Non-Goals for Now)
- Symbolic analyses (constant propagation) stored in `EClassRuntime.data`.
- Support for variadic operators with arity constraints enforced at runtime.
- Rich variable binding (e.g., let, lambda). These require additional spec updates before implementation.
