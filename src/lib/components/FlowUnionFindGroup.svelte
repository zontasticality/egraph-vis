<script lang="ts">
    import { Handle, Position, type NodeProps } from "@xyflow/svelte";

    type $$Props = NodeProps;

    export let data: $$Props["data"];
    export let width: number | undefined = undefined;
    export let height: number | undefined = undefined;
</script>

<div class="union-find-group" style="width: {width}px; height: {height}px;">
    <div class="label">Set {data.label}</div>
    <!-- Hidden handle for edges pointing to the set -->
    <Handle
        type="target"
        position={Position.Top}
        style="opacity: 0; pointer-events: none;"
    />
    <Handle
        type="source"
        position={Position.Bottom}
        style="opacity: 0; pointer-events: none;"
    />
</div>

<style>
    .union-find-group {
        border: 2px dashed #94a3b8; /* Slate 400 */
        border-radius: 12px;
        background-color: rgba(241, 245, 249, 0.5); /* Slate 100 with opacity */
        position: relative;
        box-sizing: border-box;
        padding: 32px 12px 12px 12px; /* Top padding for label */
        min-height: 100px;
        z-index: 0; /* Ensure parent is behind children */
    }

    .label {
        position: absolute;
        top: 8px;
        left: 8px;
        font-size: 12px;
        font-weight: bold;
        color: #64748b; /* Slate 500 */
        background: #f8fafc;
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid #cbd5e1;
        z-index: 1;
    }
</style>
