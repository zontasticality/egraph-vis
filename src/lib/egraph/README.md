# E-graph Implementation

Complete TypeScript implementation of e-graphs for equality saturation, based on the [egg paper](https://arxiv.org/abs/2004.03082).

## Features

- ✅ **Two implementations**: Naive (immediate) and Deferred (bulk) rebuilding
- ✅ **Svelte 5 reactive**: Uses `$state` runes for fine-grained reactivity
- ✅ **Event tracking**: Full history for animation and debugging
- ✅ **Comprehensive tests**: 100+ tests covering all functionality
- ✅ **Type-safe**: Full TypeScript with strict typing
- ✅ **Paper-accurate**: Directly implements algorithms from egg paper

## Core Components

### Union-Find (`union-find.svelte.ts`)

Efficient disjoint set union data structure with:
- Path compression
- Union by rank
- O(α(n)) amortized time complexity

```typescript
const uf = new UnionFind();
uf.makeSet(0);
uf.makeSet(1);
uf.union(0, 1);
console.log(uf.find(0) === uf.find(1)); // true
```

### Base E-graph (`base-egraph.svelte.ts`)

Abstract base class providing:
- Core data structures (union-find, e-class map, hashcons)
- Invariant checking for debugging
- Reactive getters for UI integration

### Naive E-graph (`naive-egraph.svelte.ts`)

Traditional e-graph with **immediate rebuilding**:
- Maintains invariants after every operation
- Uses upward merging for congruence
- Based on Nelson (1980)

```typescript
const eg = new NaiveEGraph();

const a = eg.add({ op: 'a', args: [] });
const b = eg.add({ op: 'b', args: [] });
const fa = eg.add({ op: 'f', args: [a] });
const fb = eg.add({ op: 'f', args: [b] });

eg.merge(a, b);
// f(a) and f(b) are IMMEDIATELY merged (congruence)
console.log(eg.find(fa) === eg.find(fb)); // true
```

### Deferred E-graph (`deferred-egraph.svelte.ts`)

egg-style e-graph with **deferred rebuilding**:
- Defers invariant maintenance until `rebuild()` is called
- Uses worklist with deduplication
- Asymptotically faster for batch operations

```typescript
const eg = new DeferredEGraph();

const a = eg.add({ op: 'a', args: [] });
const b = eg.add({ op: 'b', args: [] });
const fa = eg.add({ op: 'f', args: [a] });
const fb = eg.add({ op: 'f', args: [b] });

eg.merge(a, b);
// Invariants are BROKEN until rebuild
console.log(eg.invariantsValid); // false
console.log(eg.find(fa) === eg.find(fb)); // false

eg.rebuild();
// Now invariants are restored
console.log(eg.invariantsValid); // true
console.log(eg.find(fa) === eg.find(fb)); // true
```

### E-graph with History (`egraph-with-history.svelte.ts`)

Wrapper that records all operations:
- Event log for animation
- Snapshots for time-travel
- Timeline export

```typescript
const eg = new EGraphWithHistory();

eg.add({ op: 'a', args: [] });
eg.add({ op: 'b', args: [] });

console.log(eg.eventCount); // 2
console.log(eg.latestEvent.type); // 'add'

const timeline = eg.getEventTimeline();
console.log(timeline.adds.length); // 2
```

## Example: Equality Saturation

```typescript
import { DeferredEGraph } from '$lib/egraph';

const eg = new DeferredEGraph();

// Build: (a × 2) / 2
const a = eg.add({ op: 'a', args: [] });
const two = eg.add({ op: '2', args: [] });
const mul = eg.add({ op: '*', args: [a, two] });
const div = eg.add({ op: '/', args: [mul, two] });

// Apply rewrites (batch multiple before rebuilding)
const one = eg.add({ op: '1', args: [] });
const shl = eg.add({ op: '<<', args: [a, one] });
eg.merge(mul, shl); // x * 2 -> x << 1

const add = eg.add({ op: '+', args: [a, a] });
eg.merge(shl, add); // x << 1 -> x + x

// Single rebuild handles all congruences
eg.rebuild();

// Now all three are equivalent
console.log(eg.find(mul) === eg.find(shl)); // true
console.log(eg.find(shl) === eg.find(add)); // true
```

## Reactive Integration with Svelte 5

All e-graph classes use `$state` runes, making them directly reactive:

```svelte
<script lang="ts">
  import { DeferredEGraph } from '$lib/egraph';

  const egraph = new DeferredEGraph();

  // Derived values auto-update
  let eclasses = $derived(egraph.allEClasses);
  let worklist = $derived(Array.from(egraph.worklist));
  let isValid = $derived(egraph.invariantsValid);

  function addExample() {
    const a = egraph.add({ op: 'a', args: [] });
    const b = egraph.add({ op: 'b', args: [] });
    egraph.merge(a, b);
    egraph.rebuild();
  }
</script>

<!-- UI automatically updates when egraph changes -->
<div>
  <p>E-classes: {eclasses.length}</p>
  <p>Worklist: {worklist.length}</p>
  <p>Valid: {isValid ? '✓' : '⚠️'}</p>

  <button onclick={addExample}>Run Example</button>
</div>
```

## Testing

Run tests with Vitest:

```bash
npm test
```

Test coverage:
- `union-find.test.ts`: Union-find data structure (50+ tests)
- `naive-egraph.test.ts`: Naive implementation (30+ tests)
- `deferred-egraph.test.ts`: Deferred implementation (40+ tests)
- `egraph-with-history.test.ts`: History tracking (20+ tests)
- `comparison.test.ts`: Equivalence between implementations (15+ tests)

## Performance Characteristics

### Naive E-graph
- **Add**: O(1) amortized (with hashcons)
- **Merge**: O(n×α(n)) worst case (upward merging)
- **Find**: O(α(n)) amortized

### Deferred E-graph
- **Add**: O(1) amortized
- **Merge**: O(1) + adds to worklist
- **Rebuild**: O(n×α(n)) but with better constants due to deduplication
- **Overall**: Asymptotically faster for batch operations

The key insight: Deferred rebuilding deduplicates work when many merges affect overlapping parts of the e-graph.

## Invariants

Both implementations maintain:

1. **Congruence Invariant**: If `f(a₁, ..., aₙ)` and `f(b₁, ..., bₙ)` exist and `aᵢ ≡ bᵢ` for all i, then both are in the same e-class.

2. **Hashcons Invariant**: Every canonical e-node in the e-graph is in the hashcons, mapping to its canonical e-class id.

3. **Uniqueness**: Each distinct e-node appears in exactly one e-class.

Naive maintains these **after every operation**.
Deferred maintains these **only after rebuild()**.

## References

- [egg: Fast and Extensible Equality Saturation](https://arxiv.org/abs/2004.03082) - Original paper
- [Nelson (1980)](https://www.cs.cornell.edu/~ross/publications/eqsat/) - Original e-graph design
- [Tarjan (1975)](https://doi.org/10.1145/321879.321884) - Union-find algorithm

## License

MIT
