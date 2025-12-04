<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import {
        parsePattern,
        stringifyPattern,
        validatePattern,
    } from "../../engine/parser";
    import type { Pattern } from "../../engine/types";

    export let initialValue: Pattern;

    const dispatch = createEventDispatcher<{
        save: Pattern;
        cancel: void;
    }>();

    let inputValue = stringifyPattern(initialValue);
    let error: string | undefined;

    // Validate on input
    $: validation = validatePattern(inputValue);
    $: {
        error = validation.error;
    }

    function handleSave() {
        if (validation.valid) {
            try {
                const pattern = parsePattern(inputValue);
                dispatch("save", pattern);
            } catch (e: any) {
                error = e.message;
            }
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSave();
        } else if (e.key === "Escape") {
            dispatch("cancel");
        }
    }
</script>

<div class="modal-backdrop" on:click={() => dispatch("cancel")}>
    <div class="modal-content" on:click|stopPropagation>
        <h3>Edit Initial Term</h3>

        <div class="input-group">
            <label for="term-input">Term Expression</label>
            <input
                id="term-input"
                type="text"
                bind:value={inputValue}
                class:invalid={!validation.valid}
                on:keydown={handleKeydown}
                autoFocus
                autocomplete="off"
            />
            {#if error}
                <div class="error-message">{error}</div>
            {/if}
            <div class="help-text">
                Examples: <code>a</code>, <code>+(a, 0)</code>,
                <code>/(*(a, 2), 2)</code>
            </div>
        </div>

        <div class="actions">
            <button class="btn-cancel" on:click={() => dispatch("cancel")}
                >Cancel</button
            >
            <button
                class="btn-save"
                disabled={!validation.valid}
                on:click={handleSave}
            >
                Save
            </button>
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
        padding: 24px;
        border-radius: 12px;
        width: 100%;
        max-width: 500px;
        box-shadow:
            0 20px 25px -5px rgba(0, 0, 0, 0.1),
            0 10px 10px -5px rgba(0, 0, 0, 0.04);
    }

    h3 {
        margin: 0 0 20px 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #111827;
    }

    .input-group {
        margin-bottom: 24px;
    }

    label {
        display: block;
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
        margin-bottom: 8px;
    }

    input {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-family: "Monaco", "Menlo", monospace;
        font-size: 0.95rem;
        color: #111827;
        transition: all 0.2s;
        box-sizing: border-box;
    }

    input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    input.invalid {
        border-color: #ef4444;
    }

    input.invalid:focus {
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
    }

    .error-message {
        color: #ef4444;
        font-size: 0.875rem;
        margin-top: 6px;
    }

    .help-text {
        margin-top: 8px;
        font-size: 0.875rem;
        color: #6b7280;
    }

    code {
        background: #f3f4f6;
        padding: 2px 4px;
        border-radius: 4px;
        font-family: monospace;
        color: #4b5563;
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
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
        border-color: #9ca3af;
    }

    .btn-save {
        background: #3b82f6;
        border: 1px solid #3b82f6;
        color: white;
    }

    .btn-save:hover {
        background: #2563eb;
        border-color: #2563eb;
    }

    .btn-save:disabled {
        background: #93c5fd;
        border-color: #93c5fd;
        cursor: not-allowed;
    }
</style>
