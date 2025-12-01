<script lang="ts">
    import { Handle, Position } from "@xyflow/svelte";
    import { interactionStore } from "../../stores/interactionStore";
    import { getColorForId, getLightColorForId } from "../../utils/colors";

    export let data: {
        id: number;
        label?: string; // The operator symbol
        eclassId: number;
        color: string;
        args: number[]; // Argument IDs
    };

    // Calculate handle positions evenly along bottom (50px node width)
    $: handlePositions = data.args.map((_, i) => {
        const count = data.args.length;
        // e.g. if count is 1, pos is 50%
        // if count is 2, pos is 33%, 66%
        // if count is 3, pos is 25%, 50%, 75%
        return ((i + 1) / (count + 1)) * 100;
    });

    function handlePortEnter(argIndex: number, argId: number) {
        // We want to highlight the edge connected to this port.
        // The edge ID is likely `edge-{edgeId}` but we don't know the edge ID here easily.
        // However, we can highlight the target E-Class.
        interactionStore.hover({ type: "eclass", id: argId });
    }

    function handlePortLeave() {
        interactionStore.clearHover();
    }
</script>

<div class="flow-enode-wrapper" style:--color={data.color}>
    <!-- Incoming Handle (Top) -->
    <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style="opacity: 0; pointer-events: none;"
    />

    <!-- Operator Symbol (Scaled) -->
    <div class="symbol-container">
        <svg viewBox="0 0 100 50" preserveAspectRatio="xMidYMid meet">
            <text x="50" y="25" dominant-baseline="middle" text-anchor="middle">
                {data.label}
            </text>
        </svg>
    </div>

    <!-- Argument Ports (Bottom) -->
    {#each data.args as argId, i}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            class="port-handle-wrapper"
            style="left: {handlePositions[i]}%; bottom: -4px;"
            on:mouseenter={() => handlePortEnter(i, argId)}
            on:mouseleave={handlePortLeave}
        >
            <Handle
                id={`port-${data.id}-${i}`}
                type="source"
                position={Position.Bottom}
                style="width: 100%; height: 100%; background: var(--color); border: 1px solid white; top: 0; left: 0; transform: none; position: relative;"
            />
        </div>
    {/each}
</div>

<style>
    .flow-enode-wrapper {
        width: 100%;
        height: 100%;
        background: white;
        border: 2px solid var(--color);
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: relative;
        box-sizing: border-box;
        overflow: visible; /* Allow handles to poke out slightly */
    }

    .symbol-container {
        width: 100%;
        height: 100%;
        padding: 2px;
        box-sizing: border-box;
    }

    svg {
        width: 100%;
        height: 100%;
    }

    text {
        font-family: monospace;
        font-weight: bold;
        fill: #374151;
        font-size: 30px; /* Base size, will scale down */
    }

    .port-handle-wrapper {
        position: absolute;
        width: 8px;
        height: 8px;
        transform: translateX(-50%);
        z-index: 10;
        pointer-events: all;
    }
</style>
