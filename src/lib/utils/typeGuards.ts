/**
 * Type guards and validation utilities.
 * 
 * Centralizes runtime type checking and validation logic used across the codebase.
 */

import type {
    Pattern,
    ENode,
    NodeVisualState,
    EClassVisualState,
    NodeStyleClass,
    EClassStyleClass,
    DiffEvent,
    MatchEvent,
} from '../engine/types';

// --- Pattern Type Guards ---

/**
 * Check if a value is a Pattern object (vs. string or number).
 */
export function isPatternObject(pattern: Pattern | string | number): pattern is { op: string; args: (string | Pattern | number)[] } {
    return typeof pattern === 'object' && pattern !== null && 'op' in pattern && 'args' in pattern;
}

/**
 * Check if a value is a variable pattern (starts with '?').
 */
export function isVariablePattern(pattern: Pattern | string | number): pattern is string {
    return typeof pattern === 'string' && pattern.startsWith('?');
}

/**
 * Check if a value is a literal (number reference).
 */
export function isLiteralPattern(pattern: Pattern | string | number): pattern is number {
    return typeof pattern === 'number';
}

// --- Visual State Type Guards ---

/**
 * Check if a value is a valid NodeStyleClass enum value.
 */
export function isNodeStyleClass(value: unknown): value is NodeStyleClass {
    return (
        typeof value === 'number' &&
        value >= 0 &&
        value <= 4 // NodeStyleClass has 5 values (0-4)
    );
}

/**
 * Check if a value is a valid EClassStyleClass enum value.
 */
export function isEClassStyleClass(value: unknown): value is EClassStyleClass {
    return (
        typeof value === 'number' &&
        value >= 0 &&
        value <= 3 // EClassStyleClass has 4 values (0-3)
    );
}

/**
 * Check if a value is a valid NodeVisualState.
 */
export function isNodeVisualState(value: unknown): value is NodeVisualState {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as any;
    return (
        isNodeStyleClass(obj.styleClass) &&
        Array.isArray(obj.portTargets) &&
        obj.portTargets.every((t: unknown) => typeof t === 'number')
    );
}

/**
 * Check if a value is a valid EClassVisualState.
 */
export function isEClassVisualState(value: unknown): value is EClassVisualState {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as any;
    return (
        isEClassStyleClass(obj.styleClass) &&
        typeof obj.isCanonical === 'boolean'
    );
}

// --- Diff Event Type Guards ---

/**
 * Check if a diff event is an 'add' event.
 */
export function isAddDiffEvent(event: DiffEvent): event is { type: 'add'; nodeId: number; enode: ENode } {
    return event.type === 'add';
}

/**
 * Check if a diff event is a 'merge' event.
 */
export function isMergeDiffEvent(event: DiffEvent): event is { type: 'merge'; winner: number; losers: number[] } {
    return event.type === 'merge';
}

/**
 * Check if a diff event is a 'rewrite' event.
 */
export function isRewriteDiffEvent(
    event: DiffEvent
): event is { type: 'rewrite'; rule: string; targetClass: number; createdId: number; mergedInto: number } {
    return event.type === 'rewrite';
}

// --- ENode Validation ---

/**
 * Validate that an ENode has the expected structure.
 */
export function isValidENode(value: unknown): value is ENode {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as any;
    return (
        typeof obj.op === 'string' &&
        Array.isArray(obj.args) &&
        obj.args.every((arg: unknown) => typeof arg === 'number')
    );
}

// --- Utility Functions ---

/**
 * Assert that a value is defined (not null or undefined).
 * Throws an error if the value is null or undefined.
 */
export function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
    if (value === null || value === undefined) {
        throw new Error(message ?? 'Expected value to be defined, but got null or undefined');
    }
}

/**
 * Safely get a value from a Map with assertion.
 */
export function assertMapGet<K, V>(map: Map<K, V>, key: K, context?: string): V {
    const value = map.get(key);
    assertDefined(value, `Map does not contain key: ${key}${context ? ` (${context})` : ''}`);
    return value;
}

/**
 * Check if a value is within a numeric range (inclusive).
 */
export function isInRange(value: number, min: number, max: number): boolean {
    return value >= min && value <= max;
}

/**
 * Validate that an array has a specific length.
 */
export function hasLength<T>(arr: T[], expectedLength: number): boolean {
    return arr.length === expectedLength;
}
