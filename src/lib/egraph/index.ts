/**
 * E-graph implementation for equality saturation visualization
 *
 * This module provides both naive (immediate rebuilding) and deferred
 * (bulk rebuilding) e-graph implementations based on the egg paper.
 *
 * Key exports:
 * - NaiveEGraph: Traditional e-graph with immediate congruence maintenance
 * - DeferredEGraph: egg-style e-graph with deferred rebuilding
 * - EGraphWithHistory: Wrapper that tracks operations for animation
 * - UnionFind: Disjoint set union data structure
 * - Types: ENode, EClass, etc.
 *
 * @module egraph
 */

// Core types
export type { ENode, ENodeId, EClass, ParentInfo, EGraphEvent, EGraphSnapshot } from './types';
export { canonicalKey, enodesEqual, parentKey } from './types';

// Union-Find
export { UnionFind } from './union-find.svelte';

// Base class
export { ReactiveEGraph } from './base-egraph.svelte';

// Implementations
export { NaiveEGraph } from './naive-egraph.svelte';
export { DeferredEGraph } from './deferred-egraph.svelte';
export { EGraphWithHistory } from './egraph-with-history.svelte';
