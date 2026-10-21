<script lang="ts">
    import Modal from "./Modal.svelte";
    import { createEventDispatcher } from "svelte";
    import type { RewriteRule } from "../../engine/types";
    import {
        parsePattern,
        stringifyPattern,
        validateRule,
    } from "../../engine/parser";

    export let rule: RewriteRule;
    export let isNew: boolean = false;
    /** Names of the other rules (a rule name must be unique). */
    export let takenNames: string[] = [];

    const dispatch = createEventDispatcher<{
        save: RewriteRule;
        cancel: void;
    }>();

    let name = rule.name;
    let lhs = stringifyPattern(rule.lhs);
    let rhs = stringifyPattern(rule.rhs);
    let enabled = rule.enabled;

    $: errors = validateRule(lhs, rhs);
    $: nameError = !name.trim()
        ? "Name is required"
        : takenNames.includes(name.trim())
          ? "Another rule already has this name"
          : "";
    $: valid = !errors.lhsError && !errors.rhsError && !nameError;

    function handleSave() {
        if (!valid) return;
        dispatch("save", {
            name: name.trim(),
            lhs: parsePattern(lhs),
            rhs: parsePattern(rhs),
            enabled,
        });
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
            handleSave();
        }
    }
</script>

<Modal labelledby="rule-editor-title" maxWidth="500px" on:close={() => dispatch("cancel")}>
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div on:keydown={handleKeydown}>
        <h3 id="rule-editor-title">{isNew ? "Add Rewrite Rule" : "Edit Rewrite Rule"}</h3>

        <div class="form-group">
            <label for="rule-name">Name</label>
            <input
                id="rule-name"
                type="text"
                bind:value={name}
                class:error={!!nameError}
                placeholder="rule-name"
            />
            {#if nameError}<div class="error-msg">{nameError}</div>{/if}
        </div>

        <div class="form-group">
            <label for="rule-lhs">LHS (pattern to match)</label>
            <input
                id="rule-lhs"
                type="text"
                bind:value={lhs}
                class:error={!!errors.lhsError}
                placeholder="*(?x, 2)"
                autocomplete="off"
                spellcheck="false"
            />
            {#if errors.lhsError}<div class="error-msg">{errors.lhsError}</div>{/if}
        </div>

        <div class="form-group">
            <label for="rule-rhs">RHS (replacement)</label>
            <input
                id="rule-rhs"
                type="text"
                bind:value={rhs}
                class:error={!!errors.rhsError}
                placeholder="<<(?x, 1)"
                autocomplete="off"
                spellcheck="false"
            />
            {#if errors.rhsError}<div class="error-msg">{errors.rhsError}</div>{/if}
        </div>

        <div class="help">
            <code>?x</code> is a variable (matches any e-class); everything else
            is an operator or constant, e.g. <code>+(?x, 0)</code>.
        </div>

        <div class="form-group checkbox">
            <input id="rule-enabled" type="checkbox" bind:checked={enabled} />
            <label for="rule-enabled">Enabled</label>
        </div>

        <div class="actions">
            <button class="btn-cancel" on:click={() => dispatch("cancel")}>Cancel</button>
            <button class="btn-save" disabled={!valid} on:click={handleSave}>
                {isNew ? "Add rule" : "Save"}
            </button>
        </div>
    </div>
</Modal>

<style>

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

    .btn-save:hover:not(:disabled) {
        background: #2563eb;
    }

    .btn-save:disabled {
        background: #93c5fd;
        border-color: #93c5fd;
        cursor: not-allowed;
    }

    .help {
        font-size: 0.8rem;
        color: #6b7280;
        margin: -4px 0 14px;
    }

    .help code {
        background: #f3f4f6;
        padding: 1px 4px;
        border-radius: 4px;
    }
</style>
