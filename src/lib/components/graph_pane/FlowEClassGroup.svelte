<script lang="ts">
    import { Handle, Position } from "@xyflow/svelte";
    import {
        interactionStore,
        isEClassFullySelected,
    } from "../../stores/interactionStore";

    export let data: {
        label?: string;
        color?: string;
        lightColor?: string;
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
    style:--color={data.color || "#999"}
    style:--bg={data.lightColor || "rgba(240, 240, 240, 0.5)"}
    on:click={handleClick}
>
    <!-- Target Handle for incoming edges from arguments -->
    <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style="opacity: 0; pointer-events: none;"
    />

    <div class="group-label">{data.label}</div>

    <!-- Content is rendered by Svelte Flow via parentId, but we provide the visual container -->
</div>

<style>
    .flow-eclass-group {
        width: 100%;
        height: 100%;
        background: var(--bg);
        border: 2px dashed var(--color);
        border-radius: 8px;
        position: relative;
        box-sizing: border-box;
        overflow: visible;
        cursor: pointer;
        transition: all 0.15s ease-out;
    }

    .flow-eclass-group.selected {
        border-color: #2563eb;
        border-width: 3px;
        background: rgba(37, 99, 235, 0.05);
        box-shadow: 0 0 0 2px #2563eb inset;
    }

    .group-label {
        position: absolute;
        top: -1.5em;
        left: 0;
        color: var(--color);
        font-weight: bold;
        font-size: 0.8rem;
        white-space: nowrap;
    }

    .flow-eclass-group.selected .group-label {
        color: #2563eb;
    }
</style>
