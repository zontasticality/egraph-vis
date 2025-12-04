<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import {
        type LayoutConfig,
        type LayoutAlgorithm,
        DEFAULT_LAYOUT_CONFIG,
        FORCE_LAYOUT_CONFIG,
        MRTREE_LAYOUT_CONFIG,
        COMPACT_LAYOUT_CONFIG,
        WIDE_LAYOUT_CONFIG,
    } from "../engine/layoutConfig";
    import { layoutManager } from "../engine/layout";

    const dispatch = createEventDispatcher<{
        change: LayoutConfig;
    }>();

    let config: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG };
    let isOpen = false;

    onMount(() => {
        config = { ...layoutManager.getConfig() };
    });

    function handleAlgorithmChange(e: Event) {
        const algo = (e.target as HTMLSelectElement).value as LayoutAlgorithm;

        // Only change the algorithm and algorithm-specific properties
        // Preserve user's edge routing and spacing choices
        config.algorithm = algo;

        // Set algorithm-specific defaults only for the force-specific properties
        if (algo === "force") {
            if (!config.force) {
                config.force = {
                    iterations: 100,
                    repulsion: 1.0
                };
            }
        }

        dispatchChange();
    }

    function dispatchChange() {
        dispatch("change", config);
    }

    function toggleOpen() {
        isOpen = !isOpen;
    }
</script>

<div class="layout-settings">
    <button class="settings-btn" on:click={toggleOpen} class:active={isOpen}>
        Layout Settings
    </button>

    {#if isOpen}
        <div class="popover">
            <div class="section">
                <label>
                    Algorithm
                    <select
                        value={config.algorithm}
                        on:change={handleAlgorithmChange}
                    >
                        <option value="layered">Layered (Hierarchical)</option>
                        <option value="mrtree">Mr. Tree (Tree)</option>
                        <option value="force">Force Directed</option>
                    </select>
                </label>
            </div>

            <div class="section">
                <label>
                    Direction
                    <select
                        bind:value={config.direction}
                        on:change={dispatchChange}
                    >
                        <option value="DOWN">Down</option>
                        <option value="UP">Up</option>
                        <option value="RIGHT">Right</option>
                        <option value="LEFT">Left</option>
                    </select>
                </label>
            </div>

            <div class="section">
                <label>
                    Node Spacing ({config.nodeSpacing}px)
                    <input
                        type="range"
                        min="10"
                        max="100"
                        step="5"
                        bind:value={config.nodeSpacing}
                        on:change={dispatchChange}
                    />
                </label>
            </div>

            <div class="section">
                <label>
                    Edge Routing
                    <select
                        bind:value={config.edgeRouting}
                        on:change={dispatchChange}
                    >
                        <option value="ORTHOGONAL"
                            >Orthogonal (Right Angles)</option
                        >
                        <option value="POLYLINE">Polyline (Straight)</option>
                        <option value="SPLINES">Splines (Curved)</option>
                    </select>
                </label>
            </div>

            <div class="section">
                <label>
                    Edge-Node Spacing ({config.edgeNodeSpacing}px)
                    <input
                        type="range"
                        min="0"
                        max="50"
                        step="1"
                        bind:value={config.edgeNodeSpacing}
                        on:change={dispatchChange}
                    />
                </label>
            </div>

            <div class="section">
                <label>
                    Edge-Edge Spacing ({config.edgeEdgeSpacing}px)
                    <input
                        type="range"
                        min="0"
                        max="50"
                        step="1"
                        bind:value={config.edgeEdgeSpacing}
                        on:change={dispatchChange}
                    />
                </label>
            </div>

            {#if config.algorithm === "layered" || config.algorithm === "mrtree"}
                <div class="section">
                    <label>
                        Layer Spacing ({config.layerSpacing}px)
                        <input
                            type="range"
                            min="10"
                            max="100"
                            step="5"
                            bind:value={config.layerSpacing}
                            on:change={dispatchChange}
                        />
                    </label>
                </div>
            {/if}

            {#if config.algorithm === "force" && config.force}
                <div class="section">
                    <label>
                        Iterations ({config.force.iterations})
                        <input
                            type="range"
                            min="50"
                            max="500"
                            step="50"
                            bind:value={config.force.iterations}
                            on:change={dispatchChange}
                        />
                    </label>
                </div>
                <div class="section">
                    <label>
                        Repulsion ({config.force.repulsion})
                        <input
                            type="range"
                            min="0.1"
                            max="5.0"
                            step="0.1"
                            bind:value={config.force.repulsion}
                            on:change={dispatchChange}
                        />
                    </label>
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .layout-settings {
        position: relative;
        display: inline-block;
    }

    .settings-btn {
        padding: 0.375rem 0.75rem;
        font-size: 0.9rem;
        font-weight: 500;
        color: #374151;
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
    }

    .settings-btn:hover,
    .settings-btn.active {
        border-color: #2563eb;
        color: #2563eb;
    }

    .popover {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 0.5rem;
        width: 250px;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        box-shadow:
            0 4px 6px -1px rgba(0, 0, 0, 0.1),
            0 2px 4px -1px rgba(0, 0, 0, 0.06);
        padding: 1rem;
        z-index: 1000;
    }

    .section {
        margin-bottom: 1rem;
    }

    .section:last-child {
        margin-bottom: 0;
    }

    label {
        display: block;
        font-size: 0.85rem;
        font-weight: 500;
        color: #374151;
        margin-bottom: 0.25rem;
    }

    select {
        width: 100%;
        padding: 0.375rem;
        font-size: 0.85rem;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background-color: white;
    }

    input[type="range"] {
        width: 100%;
        margin-top: 0.25rem;
    }
</style>
