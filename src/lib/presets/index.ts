import type { PresetConfig } from "../engine/types";
import { loadUserPresets } from "../engine/presetStorage";

export const PRESETS: PresetConfig[] = [
    {
        id: "paper-example",
        label: "Paper Example",
        description: "(a * 2) / 2",
        root: { op: "/", args: [{ op: "*", args: ["a", "2"] }, "2"] },
        rewrites: [
            {
                name: "mul-to-shift",
                lhs: { op: "*", args: ["?x", "2"] },
                rhs: { op: "<<", args: ["?x", "1"] },
                enabled: true,
            },
            {
                name: "shift-to-mul",
                lhs: { op: "<<", args: ["?x", "1"] },
                rhs: { op: "*", args: ["?x", "2"] },
                enabled: true,
            },
            {
                name: "cancel-div",
                lhs: { op: "/", args: ["?x", "?x"] },
                rhs: "1",
                enabled: true,
            },
            {
                name: "mul-one",
                lhs: { op: "*", args: ["?x", "1"] },
                rhs: "?x",
                enabled: true,
            },
            {
                name: "factor-out-div",
                lhs: { op: "/", args: [{ op: "*", args: ["?x", "?y"] }, "?z"] },
                rhs: { op: "*", args: ["?x", { op: "/", args: ["?y", "?z"] }] },
                enabled: true,
            },
        ],
    },
    {
        id: "simple-add",
        label: "Simple Addition",
        description: "a + 0",
        root: { op: "+", args: ["a", "0"] },
        rewrites: [
            {
                name: "add-zero",
                lhs: { op: "+", args: ["?x", "0"] },
                rhs: "?x",
                enabled: true,
            },
            {
                name: "add-comm",
                lhs: { op: "+", args: ["?x", "?y"] },
                rhs: { op: "+", args: ["?y", "?x"] },
                enabled: true,
            },
        ],
    },
    {
        id: "associativity",
        label: "Associativity",
        description: "(a + b) + c",
        root: { op: "+", args: [{ op: "+", args: ["a", "b"] }, "c"] },
        rewrites: [
            {
                name: "add-assoc-left",
                lhs: { op: "+", args: [{ op: "+", args: ["?x", "?y"] }, "?z"] },
                rhs: { op: "+", args: ["?x", { op: "+", args: ["?y", "?z"] }] },
                enabled: true,
            },
            {
                name: "add-assoc-right",
                lhs: { op: "+", args: ["?x", { op: "+", args: ["?y", "?z"] }] },
                rhs: { op: "+", args: [{ op: "+", args: ["?x", "?y"] }, "?z"] },
                enabled: true,
            },
        ],
    },
    {
        id: "nested-functions",
        label: "Nested Functions",
        description: "x(f(g(h(i(a)))), f(g(h(i(b)))), f(g(h(i(c)))), f(g(h(i(d)))), f(g(h(i(e)))))",
        root: {
            op: "x",
            args: [
                { op: "f", args: [{ op: "g", args: [{ op: "h", args: [{ op: "i", args: ["a"] }] }] }] },
                { op: "f", args: [{ op: "g", args: [{ op: "h", args: [{ op: "i", args: ["b"] }] }] }] },
                { op: "f", args: [{ op: "g", args: [{ op: "h", args: [{ op: "i", args: ["c"] }] }] }] },
                { op: "f", args: [{ op: "g", args: [{ op: "h", args: [{ op: "i", args: ["d"] }] }] }] },
                { op: "f", args: [{ op: "g", args: [{ op: "h", args: [{ op: "i", args: ["e"] }] }] }] },
            ],
        },
        rewrites: [
            {
                name: "a-to-c",
                lhs: "a",
                rhs: "c",
                enabled: true,
            },
            {
                name: "b-to-c",
                lhs: "b",
                rhs: "c",
                enabled: true,
            },
            {
                name: "d-to-c",
                lhs: "d",
                rhs: "c",
                enabled: true,
            },
            {
                name: "e-to-c",
                lhs: "e",
                rhs: "c",
                enabled: true,
            },
        ],
    },
    {
        id: "distributivity",
        label: "Distributivity (Deferred Demo)",
        description: "(a + b) * (c + d)",
        root: { op: "*", args: [{ op: "+", args: ["a", "b"] }, { op: "+", args: ["c", "d"] }] },
        rewrites: [
            {
                name: "distrib-left",
                lhs: { op: "*", args: ["?x", { op: "+", args: ["?y", "?z"] }] },
                rhs: { op: "+", args: [{ op: "*", args: ["?x", "?y"] }, { op: "*", args: ["?x", "?z"] }] },
                enabled: true,
            },
            {
                name: "distrib-right",
                lhs: { op: "*", args: [{ op: "+", args: ["?x", "?y"] }, "?z"] },
                rhs: { op: "+", args: [{ op: "*", args: ["?x", "?z"] }, { op: "*", args: ["?y", "?z"] }] },
                enabled: true,
            },
            {
                name: "add-comm",
                lhs: { op: "+", args: ["?x", "?y"] },
                rhs: { op: "+", args: ["?y", "?x"] },
                enabled: true,
            },
            {
                name: "mul-comm",
                lhs: { op: "*", args: ["?x", "?y"] },
                rhs: { op: "*", args: ["?y", "?x"] },
                enabled: true,
            },
            {
                name: "add-assoc-left",
                lhs: { op: "+", args: [{ op: "+", args: ["?x", "?y"] }, "?z"] },
                rhs: { op: "+", args: ["?x", { op: "+", args: ["?y", "?z"] }] },
                enabled: true,
            },
            {
                name: "add-assoc-right",
                lhs: { op: "+", args: ["?x", { op: "+", args: ["?y", "?z"] }] },
                rhs: { op: "+", args: [{ op: "+", args: ["?x", "?y"] }, "?z"] },
                enabled: true,
            },
        ],
    },
    {
        id: "double-distributivity",
        label: "Double Distributivity (Deferred Demo)",
        description: "(a + b) * (c + d) + (e + f) * (g + h)",
        root: {
            op: "+",
            args: [
                { op: "*", args: [{ op: "+", args: ["a", "b"] }, { op: "+", args: ["c", "d"] }] },
                { op: "*", args: [{ op: "+", args: ["e", "f"] }, { op: "+", args: ["g", "h"] }] },
            ],
        },
        rewrites: [
            {
                name: "distrib-left",
                lhs: { op: "*", args: ["?x", { op: "+", args: ["?y", "?z"] }] },
                rhs: { op: "+", args: [{ op: "*", args: ["?x", "?y"] }, { op: "*", args: ["?x", "?z"] }] },
                enabled: true,
            },
            {
                name: "distrib-right",
                lhs: { op: "*", args: [{ op: "+", args: ["?x", "?y"] }, "?z"] },
                rhs: { op: "+", args: [{ op: "*", args: ["?x", "?z"] }, { op: "*", args: ["?y", "?z"] }] },
                enabled: true,
            },
            {
                name: "add-comm",
                lhs: { op: "+", args: ["?x", "?y"] },
                rhs: { op: "+", args: ["?y", "?x"] },
                enabled: true,
            },
            {
                name: "mul-comm",
                lhs: { op: "*", args: ["?x", "?y"] },
                rhs: { op: "*", args: ["?y", "?x"] },
                enabled: true,
            },
            {
                name: "add-assoc-left",
                lhs: { op: "+", args: [{ op: "+", args: ["?x", "?y"] }, "?z"] },
                rhs: { op: "+", args: ["?x", { op: "+", args: ["?y", "?z"] }] },
                enabled: true,
            },
            {
                name: "add-assoc-right",
                lhs: { op: "+", args: ["?x", { op: "+", args: ["?y", "?z"] }] },
                rhs: { op: "+", args: [{ op: "+", args: ["?x", "?y"] }, "?z"] },
                enabled: true,
            },
        ],
    },
    {
        id: "assoc-explosion",
        label: "Associativity Explosion (Limitation Demo)",
        description: "a + b + c + d + e + f",
        root: {
            op: "+",
            args: [
                { op: "+", args: [{ op: "+", args: [{ op: "+", args: [{ op: "+", args: ["a", "b"] }, "c"] }, "d"] }, "e"] },
                "f",
            ],
        },
        rewrites: [
            {
                name: "add-assoc-left",
                lhs: { op: "+", args: [{ op: "+", args: ["?x", "?y"] }, "?z"] },
                rhs: { op: "+", args: ["?x", { op: "+", args: ["?y", "?z"] }] },
                enabled: true,
            },
            {
                name: "add-assoc-right",
                lhs: { op: "+", args: ["?x", { op: "+", args: ["?y", "?z"] }] },
                rhs: { op: "+", args: [{ op: "+", args: ["?x", "?y"] }, "?z"] },
                enabled: true,
            },
        ],
    },
    {
        id: "non-terminating",
        label: "Non-terminating Growth (Limitation Demo)",
        description: "f(a)",
        root: { op: "f", args: ["a"] },
        rewrites: [
            {
                name: "expand-f",
                lhs: { op: "f", args: ["?x"] },
                rhs: { op: "f", args: [{ op: "f", args: ["?x"] }] },
                enabled: true,
            },
        ],
    },
    {
        id: "transitive-chain",
        label: "Transitive Saturation (Limitation Demo)",
        description: "x(a, b, c, d, e)",
        root: { op: "x", args: ["a", "b", "c", "d", "e"] },
        rewrites: [
            {
                name: "a-to-b",
                lhs: "a",
                rhs: "b",
                enabled: true,
            },
            {
                name: "b-to-c",
                lhs: "b",
                rhs: "c",
                enabled: true,
            },
            {
                name: "c-to-d",
                lhs: "c",
                rhs: "d",
                enabled: true,
            },
            {
                name: "d-to-e",
                lhs: "d",
                rhs: "e",
                enabled: true,
            },
        ],
    },
];

export function getAllPresets(): PresetConfig[] {
    const userPresets = loadUserPresets();
    // User presets shadow built-in ones if IDs match
    // We'll create a map to handle shadowing
    const presetMap = new Map<string, PresetConfig>();

    // Add built-ins first
    PRESETS.forEach(p => presetMap.set(p.id, p));

    // Add user presets (overwriting built-ins)
    userPresets.forEach(p => presetMap.set(p.id, p));

    return Array.from(presetMap.values());
}

export function isBuiltInPreset(id: string): boolean {
    return PRESETS.some(p => p.id === id);
}

export function getPresetById(id: string): PresetConfig | undefined {
    return getAllPresets().find((p) => p.id === id);
}
