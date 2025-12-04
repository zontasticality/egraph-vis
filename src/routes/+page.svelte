<script lang="ts">
    import Controller from "$lib/components/Controller.svelte";
    import {
        loadPreset,
        timeline as timelineStore,
        currentPreset,
    } from "$lib/stores/timelineStore";
    import { onMount } from "svelte";
    import { PaneGroup, Pane, PaneResizer } from "paneforge";
    import GraphPane from "$lib/components/graph_pane/GraphPane.svelte";
    import StatePane from "$lib/components/state_pane/StatePane.svelte";
    import { getAllPresets, getPresetById } from "$lib/presets";
    import LayoutSettings from "$lib/components/LayoutSettings.svelte";
    import { layoutManager } from "$lib/engine/layout";
    import type { LayoutConfig } from "$lib/engine/layoutConfig";

    // Preset Editing Imports
    import {
        isEditing,
        draftPreset,
        isDirty,
        enterEditMode,
        exitEditMode,
        updateDraftRoot,
        saveAsPreset,
        revertChanges,
    } from "$lib/stores/presetEditorStore";
    import {
        exportPresets,
        importPresets,
        saveUserPreset,
        deleteUserPreset,
        isUserPreset,
    } from "$lib/engine/presetStorage";
    import { stringifyPattern } from "$lib/engine/parser";
    import InitialTermEditor from "$lib/components/editors/InitialTermEditor.svelte";
    import SaveAsDialog from "$lib/components/editors/SaveAsDialog.svelte";
    import ErrorModal from "$lib/components/editors/ErrorModal.svelte";

    let isDeferred = true;
    let parallelism = 2; // Default parallelism for deferred mode
    let showImplDropdown = false; // For custom dropdown
    let paneLayout = [60, 40]; // Default split
    let ready = false;
    let selectedPresetId = "paper-example";

    // Editor State
    let showTermEditor = false;
    let showSaveAsDialog = false;
    let showErrorModal = false;
    let errorModalTitle = "";
    let errorModalMessages: string[] = [];
    let showUnsavedChangesDialog = false;
    let pendingPresetId: string | null = null;

    // Reactive list of presets
    $: allPresets = getAllPresets();

    // Derived state for UI
    $: currentTermString =
        $isEditing && $draftPreset
            ? stringifyPattern($draftPreset.root)
            : $currentPreset
              ? stringifyPattern($currentPreset.root)
              : "";

    function reload() {
        const preset = getPresetById(selectedPresetId) || allPresets[0];
        // If we were editing, we should exit edit mode unless we are reloading the SAME preset we are editing
        // But usually reload implies a fresh start.
        // If we just saved, we want to reload with the new data.

        loadPreset(preset, {
            implementation: isDeferred ? "deferred" : "naive",
            parallelism: isDeferred ? parallelism : 1,
        });
    }

    function handlePresetChange(e: Event) {
        const target = e.target as HTMLSelectElement;
        const newId = target.value;

        if ($isEditing && $isDirty) {
            // Prevent immediate change, show confirmation
            e.preventDefault();
            // Reset select value visually until confirmed
            target.value = selectedPresetId;
            pendingPresetId = newId;
            showUnsavedChangesDialog = true;
        } else {
            selectedPresetId = newId;
            exitEditMode(); // Clean exit if no changes or not dirty
            reload();
        }
    }

    function confirmDiscardChanges() {
        if (pendingPresetId) {
            selectedPresetId = pendingPresetId;
            exitEditMode();
            reload();
        }
        showUnsavedChangesDialog = false;
        pendingPresetId = null;
    }

    function cancelDiscardChanges() {
        showUnsavedChangesDialog = false;
        pendingPresetId = null;
    }

    function onLayoutChange(sizes: number[]) {
        paneLayout = sizes;
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("egraph-vis-layout", JSON.stringify(sizes));
        }
    }

    function toggleImplementation() {
        isDeferred = !isDeferred;
        reload();
    }

    function handleParallelismSelect(value: number) {
        parallelism = value;
        showImplDropdown = false;
        reload();
    }

    function toggleParallelismDropdown(event: MouseEvent) {
        event.stopPropagation();
        showImplDropdown = !showImplDropdown;
    }

    // Close dropdown when clicking outside
    function handleOutsideClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest('.deferred-dropdown')) {
            showImplDropdown = false;
        }
    }

    async function handleLayoutConfigChange(e: CustomEvent<LayoutConfig>) {
        if (!$timelineStore) return;
        await layoutManager.updateConfig(e.detail, $timelineStore);
    }

    // --- Preset Actions ---

    function handleEditTerm() {
        if (!$currentPreset) return;
        if (!$isEditing) {
            enterEditMode($currentPreset);
        }
        showTermEditor = true;
    }

    function handleTermUpdate(e: CustomEvent<any>) {
        updateDraftRoot(e.detail);
        showTermEditor = false;
    }

    function handleRevert() {
        if ($currentPreset) {
            revertChanges($currentPreset);
        }
    }

    function handleSaveAs() {
        showSaveAsDialog = true;
    }

    function handleSaveConfirm(e: CustomEvent<any>) {
        const { id, label, description } = e.detail;
        const newPreset = saveAsPreset(id, label, description);

        if (newPreset) {
            // Force refresh of presets list
            allPresets = getAllPresets();
            selectedPresetId = newPreset.id;
            showSaveAsDialog = false;

            // Reload to reflect changes in the engine
            reload();

            // Re-enter edit mode for the new preset so user can continue editing if they want
            // Or maybe we should exit edit mode?
            // The plan said "No auto-reload when saving current preset", but we just switched IDs potentially.
            // Let's exit edit mode to be safe and clean.
            exitEditMode();
        }
    }

    function handleDownload() {
        const presetToDownload =
            $isEditing && $draftPreset ? $draftPreset : $currentPreset;
        if (!presetToDownload) return;

        const json = exportPresets([presetToDownload]);
        downloadJson(json, `${presetToDownload.id}.json`);
    }

    function handleDownloadAll() {
        const json = exportPresets(allPresets);
        downloadJson(json, "egraph-presets.json");
    }

    function downloadJson(json: string, filename: string) {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function handleUpload() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            const text = await file.text();
            const { presets, errors } = importPresets(text);

            if (errors.length > 0) {
                errorModalTitle = "Import Errors";
                errorModalMessages = errors;
                showErrorModal = true;
            }

            if (presets.length > 0) {
                presets.forEach(saveUserPreset);
                allPresets = getAllPresets(); // Refresh list

                // If single preset imported, switch to it
                if (presets.length === 1) {
                    selectedPresetId = presets[0].id;
                    reload();
                }
            }
        };
        input.click();
    }

    onMount(() => {
        const saved = localStorage.getItem("egraph-vis-layout");
        if (saved) {
            try {
                paneLayout = JSON.parse(saved);
            } catch (e) {
                console.error("Failed to parse saved layout", e);
            }
        }
        ready = true;
        reload();

        // Add global click listener for closing dropdown
        document.addEventListener('click', handleOutsideClick);
        return () => {
            document.removeEventListener('click', handleOutsideClick);
        };
    });

    // Live update when editing - WITH SAFEGUARDS
    // Iteration cap prevents infinite loops from recursive rules
    $: if ($isEditing && $draftPreset) {
        loadPreset($draftPreset, {
            implementation: isDeferred ? "deferred" : "naive",
            parallelism: isDeferred ? parallelism : 1,
            iterationCap: 100, // Safety limit to prevent freezing
        });
    }
</script>

<!-- Modals -->
{#if showTermEditor && ($draftPreset || $currentPreset)}
    <InitialTermEditor
        initialValue={$draftPreset?.root ?? $currentPreset?.root ?? ""}
        on:save={handleTermUpdate}
        on:cancel={() => (showTermEditor = false)}
    />
{/if}

{#if showSaveAsDialog && ($draftPreset || $currentPreset)}
    <SaveAsDialog
        defaultLabel={$draftPreset?.label ?? $currentPreset?.label ?? ""}
        on:save={handleSaveConfirm}
        on:cancel={() => (showSaveAsDialog = false)}
    />
{/if}

{#if showErrorModal}
    <ErrorModal
        title={errorModalTitle}
        errors={errorModalMessages}
        on:close={() => (showErrorModal = false)}
    />
{/if}

{#if showUnsavedChangesDialog}
    <div class="modal-backdrop" on:click={cancelDiscardChanges}>
        <div class="modal-content" on:click|stopPropagation>
            <h3>Unsaved Changes</h3>
            <p>You have unsaved changes. Do you want to discard them?</p>
            <div class="actions">
                <button class="btn-cancel" on:click={cancelDiscardChanges}
                    >Cancel</button
                >
                <button class="btn-danger" on:click={confirmDiscardChanges}
                    >Discard Changes</button
                >
            </div>
        </div>
    </div>
{/if}

<div class="app-container">
    <header class="global-header">
        <div class="header-section title-section">
            <h1>
                E-Graph Visualizer
                {#if currentTermString}
                    <span class="term-display"
                        >: <code>{currentTermString}</code></span
                    >
                    <button
                        class="icon-btn"
                        on:click={handleEditTerm}
                        title="Edit initial term">✎</button
                    >
                {/if}
            </h1>
        </div>

        <div class="header-section center-controls">
            <div class="preset-group">
                <select
                    class="preset-selector"
                    value={selectedPresetId}
                    on:change={handlePresetChange}
                >
                    {#each allPresets as preset}
                        <option value={preset.id}>
                            {preset.label}
                            {isUserPreset(preset.id) ? "(User)" : ""}
                        </option>
                    {/each}
                </select>

                <!-- Preset Actions -->
                <div class="preset-actions">
                    {#if $isEditing}
                        <button
                            class="action-btn"
                            title="Revert changes"
                            disabled={!$isDirty}
                            on:click={handleRevert}
                        >
                            ↩
                        </button>
                        <button
                            class="action-btn"
                            title="Save As..."
                            on:click={handleSaveAs}
                        >
                            💾
                        </button>
                    {/if}
                    <button
                        class="action-btn"
                        title="Download Preset"
                        on:click={handleDownload}
                    >
                        ⬇
                    </button>
                </div>
            </div>

            <div class="toggle-container">
                <span class="toggle-label {isDeferred ? '' : 'active'}"
                    >Naive</span
                >
                <button
                    class="toggle-switch {isDeferred ? 'checked' : ''}"
                    on:click={toggleImplementation}
                    aria-label="Toggle Implementation"
                >
                    <span class="toggle-thumb"></span>
                </button>
                <div class="deferred-dropdown">
                    <button
                        class="toggle-label {isDeferred ? 'active' : ''} deferred-button"
                        on:click={toggleParallelismDropdown}
                        aria-label="Select Deferred Parallelism"
                    >
                        Deferred x{parallelism}
                        <svg
                            class="parallelism-arrow"
                            xmlns="http://www.w3.org/2000/svg"
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>

                    {#if showImplDropdown && isDeferred}
                        <div class="parallelism-menu">
                            <button
                                class="parallelism-option {parallelism === 2 ? 'active' : ''}"
                                on:click={() => handleParallelismSelect(2)}
                            >
                                x2
                            </button>
                            <button
                                class="parallelism-option {parallelism === 4 ? 'active' : ''}"
                                on:click={() => handleParallelismSelect(4)}
                            >
                                x4
                            </button>
                            <button
                                class="parallelism-option {parallelism === 8 ? 'active' : ''}"
                                on:click={() => handleParallelismSelect(8)}
                            >
                                x8
                            </button>
                            <button
                                class="parallelism-option {parallelism === 16 ? 'active' : ''}"
                                on:click={() => handleParallelismSelect(16)}
                            >
                                x16
                            </button>
                            <button
                                class="parallelism-option {parallelism === 32 ? 'active' : ''}"
                                on:click={() => handleParallelismSelect(32)}
                            >
                                x32
                            </button>
                        </div>
                    {/if}
                </div>
            </div>
        </div>

        <div class="header-section right-controls">
            <div class="io-controls">
                <button
                    class="text-btn"
                    on:click={handleUpload}
                    title="Import Presets">Import</button
                >
                <button
                    class="text-btn"
                    on:click={handleDownloadAll}
                    title="Export All Presets">Export All</button
                >
            </div>
            <LayoutSettings on:change={handleLayoutConfigChange} />
        </div>
    </header>

    <div class="main-content">
        {#if ready}
            <PaneGroup direction="horizontal" {onLayoutChange}>
                <Pane defaultSize={paneLayout[0]}>
                    <div class="pane graph-pane">
                        <GraphPane />
                    </div>
                </Pane>
                <PaneResizer class="resizer" />
                <Pane defaultSize={paneLayout[1]}>
                    <div class="pane state-pane">
                        <StatePane />
                    </div>
                </Pane>
            </PaneGroup>
        {/if}
    </div>

    <Controller />
</div>

<style>
    /* Modal Styles (Inline for Unsaved Changes) */
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
        z-index: 2000;
        backdrop-filter: blur(2px);
    }

    .modal-content {
        background: white;
        padding: 24px;
        border-radius: 12px;
        width: 100%;
        max-width: 400px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
    }

    .modal-content h3 {
        margin: 0 0 12px 0;
        font-size: 1.1rem;
        font-weight: 600;
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 20px;
    }

    .btn-danger {
        background: #ef4444;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
    }

    .btn-danger:hover {
        background: #dc2626;
    }

    /* App Styles */
    .app-container {
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
        background: white;
    }

    .global-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 1.5rem;
        height: 64px;
        background: white;
        border-bottom: 1px solid #e5e7eb;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        z-index: 10;
    }

    .header-section {
        display: flex;
        align-items: center;
    }

    .title-section {
        flex: 1;
        min-width: 0; /* Allow shrinking */
    }

    .center-controls {
        flex: 2;
        justify-content: center;
        gap: 2rem;
    }

    .right-controls {
        flex: 1;
        justify-content: flex-end;
        gap: 1rem;
    }

    h1 {
        font-size: 1.25rem;
        font-weight: 700;
        color: #111827;
        margin: 0;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .term-display {
        font-weight: 400;
        color: #6b7280;
        font-size: 1rem;
        display: flex;
        align-items: center;
    }

    .term-display code {
        background: #f3f4f6;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: "Monaco", "Menlo", monospace;
        font-size: 0.9rem;
        color: #4b5563;
        max-width: 300px;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .icon-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 1rem;
        padding: 4px;
        border-radius: 4px;
        opacity: 0.5;
        transition: all 0.2s;
    }

    .icon-btn:hover {
        opacity: 1;
        background: #f3f4f6;
    }

    .preset-group {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .preset-selector {
        padding: 0.5rem 2rem 0.5rem 1rem;
        border-radius: 0.5rem;
        border: 1px solid #d1d5db;
        background-color: #f9fafb;
        font-size: 0.9rem;
        font-weight: 500;
        color: #374151;
        cursor: pointer;
        transition: all 0.2s;
        appearance: none;
        background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
        background-position: right 0.5rem center;
        background-repeat: no-repeat;
        background-size: 1.5em 1.5em;
        min-width: 200px;
    }

    .preset-selector:hover {
        border-color: #2563eb;
    }

    .preset-selector:focus {
        outline: none;
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    .preset-actions {
        display: flex;
        gap: 4px;
    }

    .action-btn {
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 1.1rem;
        transition: all 0.2s;
    }

    .action-btn:hover {
        background: #f3f4f6;
        border-color: #9ca3af;
    }

    .action-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .io-controls {
        display: flex;
        gap: 8px;
        margin-right: 12px;
        padding-right: 12px;
        border-right: 1px solid #e5e7eb;
    }

    .text-btn {
        background: none;
        border: none;
        font-size: 0.85rem;
        font-weight: 500;
        color: #6b7280;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s;
    }

    .text-btn:hover {
        color: #111827;
        background: #f3f4f6;
    }

    /* Toggle Switch */
    .toggle-container {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        font-weight: 500;
        color: #6b7280;
    }

    .toggle-label {
        transition: color 0.2s;
    }

    .toggle-label.active {
        color: #111827;
    }

    .toggle-switch {
        width: 44px;
        height: 24px;
        background: #e5e7eb;
        border-radius: 12px;
        border: none;
        position: relative;
        cursor: pointer;
        transition: background 0.2s;
        padding: 0;
    }

    .toggle-switch.checked {
        background: #2563eb;
    }

    .toggle-thumb {
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        position: absolute;
        top: 2px;
        left: 2px;
        transition: transform 0.2s;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .toggle-switch.checked .toggle-thumb {
        transform: translateX(20px);
    }

    .toggle-switch:focus {
        outline: none;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
    }

    /* Deferred Dropdown */
    .deferred-dropdown {
        position: relative;
    }

    .deferred-button {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        background: none;
        border: none;
        cursor: pointer;
        padding: 0.25rem 0.4rem;
        border-radius: 4px;
        transition: all 0.2s;
    }

    .deferred-button:hover {
        background: #f3f4f6;
    }

    .deferred-button:focus {
        outline: none;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
    }

    .parallelism-arrow {
        opacity: 0.5;
        transition: opacity 0.2s;
    }

    .deferred-button:hover .parallelism-arrow {
        opacity: 0.8;
    }

    .parallelism-menu {
        position: absolute;
        top: calc(100% + 0.5rem);
        left: 50%;
        transform: translateX(-50%);
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1),
            0 8px 10px -6px rgba(0, 0, 0, 0.1);
        padding: 0.5rem;
        min-width: 80px;
        z-index: 1000;
        animation: dropdown-fade-in 0.15s ease-out;
    }

    @keyframes dropdown-fade-in {
        from {
            opacity: 0;
            transform: translateX(-50%) translateY(-4px);
        }
        to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    }

    .parallelism-option {
        display: block;
        width: 100%;
        padding: 0.4rem 0.6rem;
        background: none;
        border: none;
        text-align: center;
        font-size: 0.85rem;
        font-weight: 500;
        color: #374151;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.15s;
    }

    .parallelism-option:hover {
        background: #f3f4f6;
        color: #111827;
    }

    .parallelism-option.active {
        background: #dbeafe;
        color: #2563eb;
    }

    .main-content {
        flex: 1;
        overflow: hidden;
        position: relative;
    }

    .pane {
        height: 100%;
        width: 100%;
        overflow: hidden; /* Panes handle their own overflow */
        position: relative;
    }

    .graph-pane {
        background: #f9fafb;
    }

    .state-pane {
        background: white;
        border-left: 1px solid #e5e7eb;
    }

    /* Resizer */
    :global(.resizer) {
        width: 10px;
        background: #f3f4f6;
        border-left: 1px solid #e5e7eb;
        border-right: 1px solid #e5e7eb;
        cursor: col-resize;
        transition: background 0.2s;
        z-index: 10;
    }

    :global(.resizer:hover),
    :global(.resizer[data-active]) {
        background: #dbeafe;
    }
</style>
