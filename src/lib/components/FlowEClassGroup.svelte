<script lang="ts">
    import { Handle, Position } from "@xyflow/svelte";

    export let data: {
        label?: string;
        color?: string;
        lightColor?: string;
        width?: number;
        height?: number;
    };
</script>

<div
    class="flow-eclass-group"
    style:--color={data.color || "#999"}
    style:--bg={data.lightColor || "rgba(240, 240, 240, 0.5)"}
    style:width="{data.width}px"
    style:height="{data.height}px"
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
    }

    .group-label {
        position: absolute;
        top: -20px;
        left: 0;
        color: var(--color);
        font-weight: bold;
        font-size: 0.8rem;
        white-space: nowrap;
    }
</style>
