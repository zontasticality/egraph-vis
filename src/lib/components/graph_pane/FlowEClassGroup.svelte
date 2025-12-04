<script lang="ts">
    import { Handle, Position } from "@xyflow/svelte";
    import {
        interactionStore,
        isEClassFullySelected,
    } from "../../stores/interactionStore";
    import { currentState } from "../../stores/timelineStore";

    export let data: {
        label?: string;
        color?: string;
        lightColor?: string;
        opacity?: number;
        width?: number;
        height?: number;
        eclassId: number;
        nodeIds: number[]; // IDs of nodes in this E-Class
    };

    // Check if all nodes in this E-Class are selected
    $: isSelected = isEClassFullySelected(
        data.nodeIds,
        $interactionStore.selection,
    );

    // Active state for compact/repair phases
    $: isActive = $currentState?.metadata.activeId === data.eclassId;
    $: phase = $currentState?.phase;

    $: borderColor = (() => {
        if (isSelected) return "#2563eb";
        if (isActive) {
            if (phase === "compact") return "#fb923c"; // Orange
            // Repair is now shown on the parent nodes, not the e-class
        }
        return data.color || "#999";
    })();

    $: backgroundColor = (() => {
        if (isSelected) return "rgba(37, 99, 235, 0.05)";
        if (isActive) {
            if (phase === "compact") return "rgba(251, 146, 60, 0.1)"; // Orange tint
        }
        return data.lightColor || "rgba(240, 240, 240, 0.5)";
    })();

    $: borderWidth = isSelected || isActive ? "3px" : "2px";
    $: borderStyle = isActive ? "solid" : "dashed";

    function handleClick(e: MouseEvent) {
        // Only handle clicks on the background, not child nodes
        if (e.target === e.currentTarget) {
            interactionStore.selectEClass(data.nodeIds);
        }
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    class="flow-eclass-group"
    class:selected={isSelected}
    class:active={isActive}
    style:--border-color={borderColor}
    style:--bg-color={backgroundColor}
    style:--border-width={borderWidth}
    style:--border-style={borderStyle}
    style:--opacity={data.opacity ?? 1.0}
    on:click={handleClick}
>
    <!-- Target Handles in 8 directions for organic edge connections -->
    <!-- North (Top Center) -->
    <Handle
        id="n"
        type="target"
        position={Position.Top}
        isConnectable={false}
        style="opacity: 0; pointer-events: none; left: 50%;"
    />
    <!-- North-East (Top Right) -->
    <Handle
        id="ne"
        type="target"
        position={Position.Top}
        isConnectable={false}
        style="opacity: 0; pointer-events: none; left: 85%;"
    />
    <!-- East (Right Center) -->
    <Handle
        id="e"
        type="target"
        position={Position.Right}
        isConnectable={false}
        style="opacity: 0; pointer-events: none; top: 50%;"
    />
    <!-- South-East (Bottom Right) -->
    <Handle
        id="se"
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        style="opacity: 0; pointer-events: none; left: 85%;"
    />
    <!-- South (Bottom Center) -->
    <Handle
        id="s"
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        style="opacity: 0; pointer-events: none; left: 50%;"
    />
    <!-- South-West (Bottom Left) -->
    <Handle
        id="sw"
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        style="opacity: 0; pointer-events: none; left: 15%;"
    />
    <!-- West (Left Center) -->
    <Handle
        id="w"
        type="target"
        position={Position.Left}
        isConnectable={false}
        style="opacity: 0; pointer-events: none; top: 50%;"
    />
    <!-- North-West (Top Left) -->
    <Handle
        id="nw"
        type="target"
        position={Position.Top}
        isConnectable={false}
        style="opacity: 0; pointer-events: none; left: 15%;"
    />

    <div class="group-label">{data.label}</div>

    <!-- Content is rendered by Svelte Flow via parentId, but we provide the visual container -->
</div>

<style>
    .flow-eclass-group {
        width: 100%;
        height: 100%;
        background: var(--bg-color);
        border: var(--border-width) var(--border-style) var(--border-color);
        border-radius: 8px;
        position: relative;
        box-sizing: border-box;
        overflow: visible;
        cursor: pointer;
        opacity: var(--opacity, 1);
        transition: all 0.15s ease-out;
    }

    .flow-eclass-group.selected {
        /* Styles handled by reactive variables now, but keeping class for specificity if needed */
        box-shadow: 0 0 0 2px #2563eb inset;
    }

    .group-label {
        position: absolute;
        top: -1.5em;
        left: 0;
        color: var(--border-color);
        font-weight: bold;
        font-size: 0.8rem;
        white-space: nowrap;
    }

    .flow-eclass-group.selected .group-label {
        color: #2563eb;
    }
</style>
