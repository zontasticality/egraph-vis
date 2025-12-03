<script lang="ts">
    import Controller from "$lib/components/Controller.svelte";
    import {
        loadPreset,
        timeline as timelineStore,
    } from "$lib/stores/timelineStore";
    import { onMount } from "svelte";
    import { PaneGroup, Pane, PaneResizer } from "paneforge";
    import { PRESETS } from "$lib/presets";

    import GraphPane from "$lib/components/graph_pane/GraphPane.svelte";
    import StatePane from "$lib/components/state_pane/StatePane.svelte";
    import LayoutSettings from "$lib/components/LayoutSettings.svelte";
    import { layoutManager } from "$lib/engine/layout";
    import type { LayoutConfig } from "$lib/engine/layoutConfig";

    // Full example from the paper
    const demoPreset = {
        id: "paper-example",
        label: "Paper Example",
        description: "Standard example from the egg paper: (a * 2) / 2",
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
    };

    let isDeferred = true;
    let paneLayout = [60, 40]; // Default split
    let ready = false;
    let selectedPresetId = "paper-example";

    function reload() {
        const preset =
            PRESETS.find((p) => p.id === selectedPresetId) || PRESETS[0];
        loadPreset(preset, {
            implementation: isDeferred ? "deferred" : "naive",
        });
    }

    function handlePresetChange(e: Event) {
        const target = e.target as HTMLSelectElement;
        selectedPresetId = target.value;
        reload();
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

    async function handleLayoutConfigChange(e: CustomEvent<LayoutConfig>) {
        if (!$timelineStore) return;
        await layoutManager.updateConfig(e.detail, $timelineStore);
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
    });
</script>

<div class="app-container">
    <header class="global-header">
        <div class="header-section">
            <h1>E-Graph Visualizer</h1>
        </div>

        <div class="header-section center-controls">
            <select
                class="preset-selector"
                value={selectedPresetId}
                on:change={handlePresetChange}
            >
                {#each PRESETS as preset}
                    <option value={preset.id}>{preset.label}</option>
                {/each}
            </select>

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
                <span class="toggle-label {isDeferred ? 'active' : ''}"
                    >Deferred</span
                >
            </div>
        </div>

        <div class="header-section right-controls">
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
        padding: 0.75rem 1rem;
        background-color: #fff;
        border-bottom: 1px solid #e0e0e0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        z-index: 10;
    }

    .global-header h1 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #333;
    }

    .header-section {
        display: flex;
        align-items: center;
    }

    .center-controls {
        flex: 1;
        justify-content: center;
    }

    .right-controls {
        justify-content: flex-end;
    }

    /* Preset Selector */
    .preset-selector {
        padding: 0.375rem 0.75rem;
        font-size: 0.9rem;
        font-weight: 500;
        color: #374151;
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
        margin-right: 1.5rem;
    }

    .preset-selector:hover {
        border-color: #2563eb;
    }

    .preset-selector:focus {
        outline: none;
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
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

    .toggle-label.active {
        color: #111827;
        font-weight: 600;
    }

    .toggle-switch {
        position: relative;
        width: 44px;
        height: 24px;
        background: #e5e7eb;
        border-radius: 999px;
        border: none;
        cursor: pointer;
        transition: background 0.2s;
        padding: 2px;
    }

    .toggle-switch.checked {
        background: #2563eb;
    }

    .toggle-thumb {
        display: block;
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        transition: transform 0.2s;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .toggle-switch.checked .toggle-thumb {
        transform: translateX(20px);
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
