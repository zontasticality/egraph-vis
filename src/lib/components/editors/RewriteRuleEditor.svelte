<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import {
        parsePattern,
        stringifyPattern,
        validatePattern,
    } from "../../engine/parser";
    import type { RewriteRule } from "../../engine/types";
    import ErrorModal from "./ErrorModal.svelte";

    export let rules: RewriteRule[];

    const dispatch = createEventDispatcher<{
        update: RewriteRule[];
        close: void;
    }>();

    // Local state for editing
    interface EditingRule {
        id: number; // Stable ID for keys
        name: string;
        lhs: string;
        rhs: string;
        enabled: boolean;
        lhsError?: string;
        rhsError?: string;
    }

    let nextId = 0;
    let editingRules: EditingRule[] = rules.map((r) => ({
        id: nextId++,
        name: r.name,
        lhs: stringifyPattern(r.lhs),
        rhs: stringifyPattern(r.rhs),
        enabled: r.enabled,
        lhsError: undefined,
        rhsError: undefined,
    }));

    let showErrors = false;
    let errorMessages: string[] = [];

    function validateRule(rule: EditingRule): boolean {
        const lhsVal = validatePattern(rule.lhs);
        const rhsVal = validatePattern(rule.rhs);

        rule.lhsError = lhsVal.error;
        rule.rhsError = rhsVal.error;

        // Trigger reactivity
        editingRules = editingRules;

        return lhsVal.valid && rhsVal.valid && rule.name.trim().length > 0;
    }

    function addRule() {
        editingRules = [
            ...editingRules,
            {
                id: nextId++,
                name: `rule-${editingRules.length + 1}`,
                lhs: "?x",
                rhs: "?x",
                enabled: true,
            },
        ];
    }

    function removeRule(index: number) {
        editingRules = editingRules.filter((_, i) => i !== index);
    }

    function handleDone() {
        // Validate all
        const errors: string[] = [];
        const validRules: RewriteRule[] = [];

        for (const r of editingRules) {
            if (!validateRule(r)) {
                if (!r.name.trim()) errors.push(`Rule #${r.id}: Missing name`);
                if (r.lhsError)
                    errors.push(`Rule "${r.name}" LHS: ${r.lhsError}`);
                if (r.rhsError)
                    errors.push(`Rule "${r.name}" RHS: ${r.rhsError}`);
            } else {
                try {
                    validRules.push({
                        name: r.name,
                        lhs: parsePattern(r.lhs),
                        rhs: parsePattern(r.rhs),
                        enabled: r.enabled,
                    });
                } catch (e: any) {
                    errors.push(`Rule "${r.name}": ${e.message}`);
                }
            }
        }

        if (errors.length > 0) {
            errorMessages = errors;
            showErrors = true;
        } else {
            dispatch("update", validRules);
            dispatch("close");
        }
    }
</script>

{#if showErrors}
    <ErrorModal
        title="Validation Errors"
        errors={errorMessages}
        on:close={() => (showErrors = false)}
    />
{/if}

<div class="modal-backdrop" on:click={() => dispatch("close")}>
    <div class="modal-content" on:click|stopPropagation>
        <div class="header">
            <h3>Edit Rewrite Rules</h3>
            <button class="btn-done" on:click={handleDone}>Done</button>
        </div>

        <div class="rules-list">
            {#each editingRules as rule, i (rule.id)}
                <div class="rule-row">
                    <div class="rule-controls">
                        <input
                            type="checkbox"
                            bind:checked={rule.enabled}
                            title="Enable/Disable rule"
                        />
                    </div>

                    <div class="rule-inputs">
                        <div class="input-col name-col">
                            <input
                                type="text"
                                bind:value={rule.name}
                                placeholder="Name"
                                class:invalid={!rule.name.trim()}
                            />
                        </div>
                        <div class="input-col expr-col">
                            <input
                                type="text"
                                bind:value={rule.lhs}
                                placeholder="LHS Pattern"
                                class:invalid={!!rule.lhsError}
                                on:input={() => validateRule(rule)}
                            />
                        </div>
                        <div class="arrow">→</div>
                        <div class="input-col expr-col">
                            <input
                                type="text"
                                bind:value={rule.rhs}
                                placeholder="RHS Pattern"
                                class:invalid={!!rule.rhsError}
                                on:input={() => validateRule(rule)}
                            />
                        </div>
                    </div>

                    <button
                        class="btn-trash"
                        on:click={() => removeRule(i)}
                        title="Remove rule"
                    >
                        🗑️
                    </button>
                </div>
            {/each}
        </div>

        <div class="footer">
            <button class="btn-add" on:click={addRule}>+ Add Rule</button>
        </div>
    </div>
</div>

<style>
    .modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        backdrop-filter: blur(2px);
    }

    .modal-content {
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 800px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
    }

    .header {
        padding: 16px 24px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    h3 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
        color: #111827;
    }

    .rules-list {
        padding: 16px 24px;
        overflow-y: auto;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .rule-row {
        display: flex;
        align-items: center;
        gap: 12px;
        background: #f9fafb;
        padding: 8px 12px;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
    }

    .rule-inputs {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
    }

    .input-col {
        display: flex;
        flex-direction: column;
    }

    .name-col {
        width: 120px;
    }

    .expr-col {
        flex: 1;
    }

    input[type="text"] {
        width: 100%;
        padding: 6px 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 0.9rem;
        transition: all 0.2s;
        box-sizing: border-box;
    }

    .expr-col input {
        font-family: "Monaco", "Menlo", monospace;
    }

    input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
    }

    input.invalid {
        border-color: #ef4444;
        background: #fef2f2;
    }

    .arrow {
        color: #9ca3af;
        font-weight: bold;
    }

    .btn-trash {
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0.5;
        font-size: 1.1rem;
        padding: 4px;
        border-radius: 4px;
    }

    .btn-trash:hover {
        opacity: 1;
        background: #fee2e2;
    }

    .footer {
        padding: 16px 24px;
        border-top: 1px solid #e5e7eb;
        background: #f9fafb;
        border-bottom-left-radius: 12px;
        border-bottom-right-radius: 12px;
    }

    .btn-add {
        background: white;
        border: 1px solid #d1d5db;
        color: #374151;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
    }

    .btn-add:hover {
        background: #f3f4f6;
        border-color: #9ca3af;
    }

    .btn-done {
        background: #3b82f6;
        border: 1px solid #3b82f6;
        color: white;
        padding: 6px 16px;
        border-radius: 6px;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
    }

    .btn-done:hover {
        background: #2563eb;
    }
</style>
