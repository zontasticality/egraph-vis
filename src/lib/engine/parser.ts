import type { Pattern } from './types';

export function parsePattern(input: string): Pattern {
    const tokens = tokenize(input);
    if (tokens.length === 0) throw new Error('Empty input');

    const { pattern, remaining } = parseTokenList(tokens);
    if (remaining.length > 0) {
        throw new Error('Unexpected tokens after pattern');
    }
    return pattern;
}

export function stringifyPattern(pattern: Pattern): string {
    if (typeof pattern === 'string') return pattern;

    const args = pattern.args.map(arg => {
        if (typeof arg === 'number') return String(arg); // Should not happen in presets usually
        return stringifyPattern(arg);
    }).join(', ');

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

// --- Internal Parser Logic ---

function tokenize(input: string): string[] {
    // Split by parens, commas, and whitespace, keeping delimiters
    // Remove whitespace tokens
    const regex = /([(),]|\s+)/;
    return input
        .split(regex)
        .map(t => t.trim())
        .filter(t => t.length > 0);
}

function parseTokenList(tokens: string[]): { pattern: Pattern; remaining: string[] } {
    if (tokens.length === 0) throw new Error('Unexpected end of input');

    const token = tokens[0];
    const rest = tokens.slice(1);

    // Case 1: Function application "op("
    if (rest.length > 0 && rest[0] === '(') {
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
