<script lang="ts">
    import { Handle, Position, type NodeProps } from "@xyflow/svelte";

    type $$Props = NodeProps;

    export let data: $$Props["data"];
    export let width: number | undefined = undefined;
    export let height: number | undefined = undefined;
</script>

<div class="union-find-group">
    <div class="label">{data.label}</div>
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
        width: 100%;
        height: 100%;
        border: 2px dashed #94a3b8; /* Slate 400 */
        border-radius: 12px;
        background-color: rgba(241, 245, 249, 0.5); /* Slate 100 with opacity */
        position: relative;
        box-sizing: border-box;
        min-height: 100px;
        z-index: 0; /* Ensure parent is behind children */
        overflow: visible;
    }

    .label {
        position: absolute;
        top: 50%;
        left: 0;
        transform: translateY(-50%) rotate(-90deg);
        transform-origin: left center;
        font-size: 12px;
        font-weight: bold;
        color: #64748b; /* Slate 500 */
        background: #f8fafc;
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid #cbd5e1;
        z-index: 1;
        white-space: nowrap;
    }
</style>
