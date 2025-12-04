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
