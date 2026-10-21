<script lang="ts">
    import Modal from "./Modal.svelte";
    import { createEventDispatcher } from "svelte";
        import { getAllPresets } from "../../presets";

    export let defaultLabel: string;

    const dispatch = createEventDispatcher<{
        save: { id: string; label: string; description: string };
        cancel: void;
    }>();

    let label = defaultLabel;

    // The (trimmed) name doubles as the preset id; warn before overwriting/shadowing one
    $: name = label.trim();
    $: showOverwriteWarning = getAllPresets().some((p) => p.id === name || p.label === name);

    function handleSave() {
        if (!name) return;
        const existing = getAllPresets().find((p) => p.label === name);
        dispatch("save", { id: existing?.id ?? name, label: name, description: "" });
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            e.preventDefault();
            handleSave();
        }
    }
</script>

<Modal labelledby="save-preset-title" maxWidth="450px" on:close={() => dispatch("cancel")}>
        <h3 id="save-preset-title">Save Preset</h3>

        <div class="form-group">
            <label for="preset-label">Name</label>
            <input
                id="preset-label"
                type="text"
                bind:value={label}
                placeholder="My Awesome Preset"
                on:keydown={handleKeydown}
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
                disabled={!name}
                on:click={handleSave}
            >
                {showOverwriteWarning ? "Overwrite" : "Save"}
            </button>
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
