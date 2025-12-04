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

    const STORAGE_KEY = "egraph-vis-layout-config";
    let config: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG };
    let isOpen = false;

    onMount(() => {
        // Get current config from layoutManager (which may have loaded from localStorage)
        config = { ...layoutManager.getConfig() };
    });

    function saveConfigToStorage(cfg: LayoutConfig) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
        } catch (e) {
            console.error("Failed to save layout config to storage:", e);
        }
    }

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
        saveConfigToStorage(config);
        dispatch("change", config);
    }

    function revertProperty(property: keyof LayoutConfig) {
        const defaultValue = DEFAULT_LAYOUT_CONFIG[property];
        if (defaultValue !== undefined) {
            (config as any)[property] =
                typeof defaultValue === 'object' && !Array.isArray(defaultValue)
                    ? { ...defaultValue }
                    : defaultValue;
            dispatchChange();
        }
    }

    function isAtDefault(property: keyof LayoutConfig): boolean {
        const currentValue = config[property];
        const defaultValue = DEFAULT_LAYOUT_CONFIG[property];

        // Handle nested objects like 'force'
        if (typeof currentValue === 'object' && currentValue !== null &&
            typeof defaultValue === 'object' && defaultValue !== null) {
            return JSON.stringify(currentValue) === JSON.stringify(defaultValue);
        }

        return currentValue === defaultValue;
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
                <label>Algorithm</label>
                <div class="input-row">
                    <select
                        value={config.algorithm}
                        on:change={handleAlgorithmChange}
                    >
                        <option value="layered">Layered (Hierarchical)</option>
                        <option value="mrtree">Mr. Tree (Tree)</option>
                        <option value="force">Force Directed</option>
                    </select>
                    <button
                        class="revert-btn"
                        on:click={() => revertProperty("algorithm")}
                        disabled={isAtDefault("algorithm")}
                        title="Reset to default"
                        aria-label="Reset algorithm to default"
                    >
                        ↺
                    </button>
                </div>
            </div>

            <div class="section">
                <label>Direction</label>
                <div class="input-row">
                    <select
                        bind:value={config.direction}
                        on:change={dispatchChange}
                    >
                        <option value="DOWN">Down</option>
                        <option value="UP">Up</option>
                        <option value="RIGHT">Right</option>
                        <option value="LEFT">Left</option>
                    </select>
                    <button
                        class="revert-btn"
                        on:click={() => revertProperty("direction")}
                        disabled={isAtDefault("direction")}
                        title="Reset to default"
                        aria-label="Reset direction to default"
                    >
                        ↺
                    </button>
                </div>
            </div>

            <div class="section">
                <label>Node Spacing ({config.nodeSpacing}px)</label>
                <div class="input-row">
                    <input
                        type="range"
                        min="10"
                        max="100"
                        step="5"
                        bind:value={config.nodeSpacing}
                        on:input={dispatchChange}
                    />
                    <button
                        class="revert-btn"
                        on:click={() => revertProperty("nodeSpacing")}
                        disabled={isAtDefault("nodeSpacing")}
                        title="Reset to default"
                        aria-label="Reset node spacing to default"
                    >
                        ↺
                    </button>
                </div>
            </div>

            <div class="section">
                <label>Edge Routing</label>
                <div class="input-row">
                    <select
                        bind:value={config.edgeRouting}
                        on:change={dispatchChange}
                    >
                        <option value="ORTHOGONAL">Orthogonal (Right Angles)</option>
                        <option value="POLYLINE">Polyline (Straight)</option>
                        <option value="SPLINES">Splines (Curved)</option>
                    </select>
                    <button
                        class="revert-btn"
                        on:click={() => revertProperty("edgeRouting")}
                        disabled={isAtDefault("edgeRouting")}
                        title="Reset to default"
                        aria-label="Reset edge routing to default"
                    >
                        ↺
                    </button>
                </div>
            </div>

            {#if config.algorithm === "layered"}
                <div class="section">
                    <label>Edge Spacing ({config.edgeEdgeSpacing}px)</label>
                    <div class="input-row">
                        <input
                            type="range"
                            min="0"
                            max="50"
                            step="1"
                            bind:value={config.edgeEdgeSpacing}
                            on:input={dispatchChange}
                        />
                        <button
                            class="revert-btn"
                            on:click={() => revertProperty("edgeEdgeSpacing")}
                            disabled={isAtDefault("edgeEdgeSpacing")}
                            title="Reset to default"
                            aria-label="Reset edge spacing to default"
                        >
                            ↺
                        </button>
                    </div>
                </div>
            {/if}

            {#if config.algorithm === "layered" || config.algorithm === "mrtree"}
                <div class="section">
                    <label>Layer Spacing ({config.layerSpacing}px)</label>
                    <div class="input-row">
                        <input
                            type="range"
                            min="10"
                            max="100"
                            step="5"
                            bind:value={config.layerSpacing}
                            on:input={dispatchChange}
                        />
                        <button
                            class="revert-btn"
                            on:click={() => revertProperty("layerSpacing")}
                            disabled={isAtDefault("layerSpacing")}
                            title="Reset to default"
                            aria-label="Reset layer spacing to default"
                        >
                            ↺
                        </button>
                    </div>
                </div>
            {/if}

            {#if config.algorithm === "force" && config.force}
                <div class="section">
                    <label>Iterations ({config.force.iterations})</label>
                    <div class="input-row">
                        <input
                            type="range"
                            min="50"
                            max="500"
                            step="50"
                            bind:value={config.force.iterations}
                            on:input={dispatchChange}
                        />
                        <button
                            class="revert-btn"
                            on:click={() => revertProperty("force")}
                            disabled={isAtDefault("force")}
                            title="Reset to default"
                            aria-label="Reset force settings to default"
                        >
                            ↺
                        </button>
                    </div>
                </div>
                <div class="section">
                    <label>Repulsion ({config.force.repulsion})</label>
                    <div class="input-row">
                        <input
                            type="range"
                            min="0.1"
                            max="5.0"
                            step="0.1"
                            bind:value={config.force.repulsion}
                            on:input={dispatchChange}
                        />
                        <button
                            class="revert-btn"
                            on:click={() => revertProperty("force")}
                            disabled={isAtDefault("force")}
                            title="Reset to default"
                            aria-label="Reset force settings to default"
                        >
                            ↺
                        </button>
                    </div>
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

    .input-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .revert-btn {
        background: none;
        border: none;
        border-radius: 4px;
        width: 24px;
        height: 24px;
        font-size: 1.1rem;
        color: #6b7280;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: all 0.15s;
        flex-shrink: 0;
    }

    .revert-btn:not(:disabled):hover {
        background-color: #f3f4f6;
        color: #374151;
    }

    .revert-btn:not(:disabled):active {
        background-color: #e5e7eb;
    }

    .revert-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    select {
        flex: 1;
        padding: 0.375rem;
        font-size: 0.85rem;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background-color: white;
    }

    input[type="range"] {
        flex: 1;
    }
</style>
