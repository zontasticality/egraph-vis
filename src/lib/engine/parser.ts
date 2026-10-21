import type { Pattern } from './types';
import { isVariablePattern, isPatternObject } from '../utils/typeGuards';

/**
 * Parse an s-expression-like pattern: `op(arg, ...)`, constants (`a`, `0`)
 * and variables (`?x`).
 */
export function parsePattern(input: string): Pattern {
    const tokens = tokenize(input);
    if (tokens.length === 0) throw new Error('Empty input');

    const { pattern, remaining } = parseTokenList(tokens);
    if (remaining.length > 0) {
        throw new Error(`Unexpected '${remaining[0]}' after pattern`);
    }
    return pattern;
}

export function stringifyPattern(pattern: Pattern | number): string {
    if (typeof pattern === 'number') return String(pattern);
    if (typeof pattern === 'string') return pattern;

    const args = pattern.args.map(arg => stringifyPattern(arg)).join(', ');
    return `${pattern.op}(${args})`;
}

export function validatePattern(input: string): { valid: boolean; error?: string } {
    try {
        parsePattern(input);
        return { valid: true };
    } catch (e: any) {
        return { valid: false, error: e.message };
    }
}

/**
 * Recursively collect all variable names (e.g. "?x") from a pattern.
 */
export function collectVariables(pattern: Pattern | number): Set<string> {
    const vars = new Set<string>();
    function walk(p: Pattern | number) {
        if (isVariablePattern(p)) {
            vars.add(p);
        } else if (isPatternObject(p)) {
            for (const arg of p.args) {
                walk(arg);
            }
        }
    }
    walk(pattern);
    return vars;
}

/**
 * Validate a rewrite rule given as source text. Returns per-side errors.
 */
export function validateRule(lhs: string, rhs: string): { lhsError?: string; rhsError?: string } {
    const out: { lhsError?: string; rhsError?: string } = {};
    let lhsPattern: Pattern | undefined;
    let rhsPattern: Pattern | undefined;
    try {
        lhsPattern = parsePattern(lhs);
    } catch (e: any) {
        out.lhsError = e.message;
    }
    try {
        rhsPattern = parsePattern(rhs);
    } catch (e: any) {
        out.rhsError = e.message;
    }
    if (lhsPattern !== undefined && isVariablePattern(lhsPattern)) {
        out.lhsError = 'LHS cannot be a bare variable (it would match every e-class)';
    }
    if (lhsPattern !== undefined && rhsPattern !== undefined && !out.rhsError) {
        const bound = collectVariables(lhsPattern);
        for (const v of collectVariables(rhsPattern)) {
            if (!bound.has(v)) {
                out.rhsError = `Variable "${v}" in RHS not bound in LHS`;
                break;
            }
        }
    }
    return out;
}

// --- Internal Parser Logic ---

const DELIMITERS = new Set(['(', ')', ',']);

function tokenize(input: string): string[] {
    // Split by parens, commas, and whitespace, keeping delimiters
    return input
        .split(/([(),]|\s+)/)
        .map(t => t.trim())
        .filter(t => t.length > 0);
}

function parseTokenList(tokens: string[]): { pattern: Pattern; remaining: string[] } {
    if (tokens.length === 0) throw new Error('Unexpected end of input');

    const token = tokens[0];
    const rest = tokens.slice(1);

    if (DELIMITERS.has(token)) {
        throw new Error(token === ')' || token === ',' ? `Expected an argument but found '${token}'` : `Unexpected '('`);
    }
    if (token === '?') {
        throw new Error("Variable name missing after '?'");
    }

    // Case 1: Function application "op("
    if (rest.length > 0 && rest[0] === '(') {
        if (isVariablePattern(token)) {
            throw new Error(`Variable ${token} cannot be used as an operator`);
        }
        const op = token;
        let current = rest.slice(1); // Skip '('
        const args: Pattern[] = [];

        // Check for empty args "op()"
        if (current.length > 0 && current[0] === ')') {
            return {
                pattern: { op, args: [] },
                remaining: current.slice(1)
            };
        }

        while (true) {
            const result = parseTokenList(current);
            args.push(result.pattern);
            current = result.remaining;

            if (current.length === 0) throw new Error('Missing closing parenthesis');

            if (current[0] === ')') {
                return {
                    pattern: { op, args },
                    remaining: current.slice(1)
                };
            } else if (current[0] === ',') {
                current = current.slice(1); // Consume comma
            } else {
                throw new Error(`Expected ',' or ')' but found '${current[0]}'`);
            }
        }
    }

    // Case 2: Variable or Constant (just a string)
    return {
        pattern: token,
        remaining: rest
    };
}
