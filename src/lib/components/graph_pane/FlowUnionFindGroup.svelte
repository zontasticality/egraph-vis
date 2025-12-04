<script lang="ts">
    import { Handle, Position, type NodeProps } from "@xyflow/svelte";
    import { currentState } from "../../stores/timelineStore";

    type $$Props = NodeProps;

    export let data: $$Props["data"];

    // Check if thisunion-find group contains a merged e-class during write phase
    $: isWriteMerge = (() => {
        const phase = $currentState?.phase;
        if (phase !== "write") return false;

        // Check if any merge diff involves e-classes in this group
        const merges = $currentState?.metadata.diffs.filter(
            (d) => d.type === "merge",
        );
        if (!merges || merges.length === 0) return false;

        // We need to check if this group's canonical ID matches any merge participants
        // The data.label contains "Set: {canonicalId}"
        const canonicalId = parseInt((data.label as string).split(": ")[1]);
        if (isNaN(canonicalId)) return false;

        for (const merge of merges) {
            // Check if the winner matches this set's canonical ID
            if (merge.winner === canonicalId) {
                return true;
            }
        }
        return false;
    })();

    $: borderColor = isWriteMerge ? "#ef4444" : "#94a3b8";
    $: borderStyle = isWriteMerge ? "solid" : "dashed";
    $: backgroundColor = isWriteMerge
        ? "rgba(239, 68, 68, 0.1)"
        : "rgba(241, 245, 249, 0.5)";
</script>

<div
    class="union-find-group"
    style:--border-color={borderColor}
    style:--border-style={borderStyle}
    style:--bg-color={backgroundColor}
>
    <div class="label">{data.label}</div>
    <!-- Hidden handles on all sides for edges -->
    <Handle
        id="top"
        type="target"
        position={Position.Top}
        style="opacity: 0; pointer-events: none;"
    />
    <Handle
        id="bottom"
        type="target"
        position={Position.Bottom}
        style="opacity: 0; pointer-events: none;"
    />
    <Handle
        id="left"
        type="target"
        position={Position.Left}
        style="opacity: 0; pointer-events: none;"
    />
    <Handle
        id="right"
        type="target"
        position={Position.Right}
        style="opacity: 0; pointer-events: none;"
    />
</div>

<style>
    .union-find-group {
        width: 100%;
        height: 100%;
        border: 2px var(--border-style, dashed) var(--border-color, #94a3b8); /* Slate 400 */
        border-radius: 12px;
        background-color: var(
            --bg-color,
            rgba(241, 245, 249, 0.5)
        ); /* Slate 100 with opacity */
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
