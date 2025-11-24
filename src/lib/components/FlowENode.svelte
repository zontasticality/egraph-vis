<script lang="ts">
    import { Handle, Position } from "@xyflow/svelte";
    import ENode from "./ENode.svelte";

    export let data: { id: number; mode: "id" | "symbol"; label?: string };
</script>

<div class="flow-enode-wrapper">
    <Handle type="target" position={Position.Top} style="opacity: 0;" />

    <!-- We pass the ID and Mode from data -->
    <ENode id={data.id} mode={data.mode} />

    <Handle type="source" position={Position.Bottom} style="opacity: 0;" />
</div>

<style>
    .flow-enode-wrapper {
        /* Svelte Flow nodes have absolute positioning, but the wrapper just needs to hold the ENode */
        /* We might want to ensure it doesn't interfere with ENode's styling */
        pointer-events: all;
    }
</style>
