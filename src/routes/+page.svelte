<script lang="ts">
    import PaneGroup from "$lib/components/PaneGroup.svelte";
    import Controller from "$lib/components/Controller.svelte";
    import { loadPreset } from "$lib/stores/timelineStore";
    import { onMount } from "svelte";

    import GraphPane from "$lib/components/GraphPane.svelte";
    import StatePane from "$lib/components/StatePane.svelte";

    // Temporary preset for testing
    const demoPreset = {
        id: "demo",
        label: "Demo",
        description: "Demo preset",
        root: { op: "*", args: ["a", "2"] },
        rewrites: [
            {
                name: "shift",
                lhs: { op: "*", args: ["?x", "2"] },
                rhs: { op: "<<", args: ["?x", "1"] },
                enabled: true,
            },
        ],
    };

    onMount(() => {
        loadPreset(demoPreset);
    });
</script>

<div class="app-container">
    <header class="global-header">
        <div class="header-section">
            <h1>E-Graph Visualizer</h1>
        </div>
        <div class="header-section">
            <span class="pane-label">Graph View</span>
        </div>
        <div class="header-section">
            <span class="pane-label">State View</span>
        </div>
    </header>

    <div class="main-content">
        <PaneGroup>
            <div class="pane graph-pane">
                <GraphPane />
            </div>
            <div class="pane state-pane">
                <StatePane />
            </div>
        </PaneGroup>
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
        gap: 1rem;
        padding: 0.75rem 1rem;
        background-color: #fff;
        border-bottom: 1px solid #e0e0e0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    .global-header h1 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #333;
    }

    .header-section {
        flex: 1;
    }

    .header-section:first-child {
        flex: 0 0 auto;
        margin-right: 2rem;
    }

    .pane-label {
        font-size: 0.9rem;
        font-weight: 500;
        color: #666;
    }

    .main-content {
        flex: 1;
        overflow: hidden;
        position: relative;
    }

    .pane {
        height: 100%;
        width: 100%;
        overflow: auto;
        position: relative;
    }

    .graph-pane {
        background: #f9fafb;
        border-right: 1px solid #e5e7eb;
    }

    .state-pane {
        background: white;
    }
</style>
