<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { isUserPreset } from "../../engine/presetStorage";
    import { getAllPresets } from "../../presets";

    export let defaultLabel: string;

    const dispatch = createEventDispatcher<{
        save: { id: string; label: string; description: string };
        cancel: void;
    }>();

    let label = defaultLabel;
    let showOverwriteWarning = false;

    // Check for overwrite when label changes (since label is now ID)
    $: {
        // We check if an ID exists that matches the label exactly
        // We also need to check if it matches a built-in ID if we were normalizing,
        // but since we are using label as ID, we just check for exact match.
        // However, we should check against ALL presets to warn about shadowing/overwriting.
        const all = getAllPresets();
        showOverwriteWarning = all.some((p) => p.id === label);
    }

    function handleSave() {
        if (!label.trim()) return;
        // Use label as ID, empty description
        dispatch("save", { id: label, label, description: "" });
    }
</script>

<div class="modal-backdrop" on:click={() => dispatch("cancel")}>
    <div class="modal-content" on:click|stopPropagation>
        <h3>Save Preset</h3>

        <div class="form-group">
            <label for="preset-label">Name</label>
            <input
                id="preset-label"
                type="text"
                bind:value={label}
                placeholder="My Awesome Preset"
                autoFocus
            />
            {#if showOverwriteWarning}
                <div class="warning">
                    ⚠️ A preset with this name already exists. Saving will
                    overwrite it.
                </div>
            {/if}
        </div>

        <div class="actions">
            <button class="btn-cancel" on:click={() => dispatch("cancel")}
                >Cancel</button
            >
            <button
                class="btn-save"
                class:warning={showOverwriteWarning}
                disabled={!label.trim()}
                on:click={handleSave}
            >
                {showOverwriteWarning ? "Overwrite" : "Save"}
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
        z-index: 1100; /* Higher than other modals */
        backdrop-filter: blur(2px);
    }

    .modal-content {
        background: white;
        padding: 24px;
        border-radius: 12px;
        width: 100%;
        max-width: 450px;
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

    label {
        display: block;
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
        margin-bottom: 6px;
    }

    input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 0.95rem;
        transition: all 0.2s;
        box-sizing: border-box;
    }

    input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .warning {
        margin-top: 6px;
        font-size: 0.85rem;
        color: #d97706;
        background: #fffbeb;
        padding: 6px 10px;
        border-radius: 4px;
        border: 1px solid #fcd34d;
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

    .btn-save.warning {
        background: #d97706;
        border-color: #d97706;
    }

    .btn-save.warning:hover {
        background: #b45309;
    }

    .btn-save:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>
