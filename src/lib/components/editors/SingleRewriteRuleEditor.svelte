<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { RewriteRule } from "../../engine/types";
    import {
        parsePattern,
        stringifyPattern,
        validatePattern,
    } from "../../engine/parser";

    export let rule: RewriteRule;
    export let isNew: boolean = false;

    const dispatch = createEventDispatcher<{
        save: RewriteRule;
        cancel: void;
    }>();

    let name = rule.name;
    let lhs =
        typeof rule.lhs === "string" ? rule.lhs : stringifyPattern(rule.lhs);
    let rhs =
        typeof rule.rhs === "string" ? rule.rhs : stringifyPattern(rule.rhs);
    let enabled = rule.enabled;

    let lhsError = "";
    let rhsError = "";

    function validate() {
        lhsError = "";
        rhsError = "";
        let valid = true;

        const lhsValidation = validatePattern(lhs);
        if (!lhsValidation.valid) {
            lhsError = lhsValidation.error || "Invalid LHS pattern";
            valid = false;
        }

        const rhsValidation = validatePattern(rhs);
        if (!rhsValidation.valid) {
            rhsError = rhsValidation.error || "Invalid RHS pattern";
            valid = false;
        }

        if (!name.trim()) {
            valid = false; // Name required
        }
        return valid;
    }

    function handleSave() {
        if (!validate()) return;

        const updatedRule: RewriteRule = {
            name,
            lhs: parsePattern(lhs),
            rhs: parsePattern(rhs),
            enabled,
        };

        dispatch("save", updatedRule);
    }
</script>

<div class="modal-backdrop" on:click={() => dispatch("cancel")}>
    <div class="modal-content" on:click|stopPropagation>
        <h3>{isNew ? "Add Rewrite Rule" : "Edit Rewrite Rule"}</h3>

        <div class="form-group">
            <label for="rule-name">Name</label>
            <input
                id="rule-name"
                type="text"
                bind:value={name}
                placeholder="rule-name"
                autoFocus
            />
        </div>

        <div class="form-group">
            <label for="rule-lhs">LHS (Pattern)</label>
            <input
                id="rule-lhs"
                type="text"
                bind:value={lhs}
                class:error={!!lhsError}
                placeholder="*(?x, ?y)"
                on:input={validate}
            />
            {#if lhsError}<div class="error-msg">{lhsError}</div>{/if}
        </div>

        <div class="form-group">
            <label for="rule-rhs">RHS (Pattern)</label>
            <input
                id="rule-rhs"
                type="text"
                bind:value={rhs}
                class:error={!!rhsError}
                placeholder="*(?y, ?x)"
                on:input={validate}
            />
            {#if rhsError}<div class="error-msg">{rhsError}</div>{/if}
        </div>

        <div class="form-group checkbox">
            <input id="rule-enabled" type="checkbox" bind:checked={enabled} />
            <label for="rule-enabled">Enabled</label>
        </div>

        <div class="actions">
            <button class="btn-cancel" on:click={() => dispatch("cancel")}>
                {isNew ? "Delete" : "Cancel"}
            </button>
            <button class="btn-save" on:click={handleSave}>Save</button>
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
        z-index: 1200;
        backdrop-filter: blur(2px);
    }

    .modal-content {
        background: white;
        padding: 24px;
        border-radius: 12px;
        width: 100%;
        max-width: 500px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
    }

    h3 {
        margin: 0 0 20px 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #111827;
    }

    .form-group {
        margin-bottom: 16px;
    }

    .form-group.checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .form-group.checkbox label {
        margin-bottom: 0;
        cursor: pointer;
    }

    label {
        display: block;
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
        margin-bottom: 6px;
    }

    input[type="text"] {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 0.95rem;
        transition: all 0.2s;
        box-sizing: border-box;
        font-family: monospace;
    }

    input[type="text"]:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    input.error {
        border-color: #ef4444;
    }

    .error-msg {
        color: #ef4444;
        font-size: 0.8rem;
        margin-top: 4px;
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 24px;
    }

    button {
        padding: 8px 16px;
        border-radius: 6px;
        font-weight: 500;
        font-size: 0.875rem;
        cursor: pointer;
        transition: all 0.2s;
    }

    .btn-cancel {
        background: white;
        border: 1px solid #d1d5db;
        color: #374151;
    }

    .btn-cancel:hover {
        background: #f9fafb;
    }

    .btn-save {
        background: #3b82f6;
        border: 1px solid #3b82f6;
        color: white;
    }

    .btn-save:hover {
        background: #2563eb;
    }
</style>
