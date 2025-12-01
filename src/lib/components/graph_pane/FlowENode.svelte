<script lang="ts">
    import { Handle, Position } from "@xyflow/svelte";
    import { interactionStore } from "../../stores/interactionStore";
    import { currentState } from "../../stores/timelineStore";
    import { getColorForId, getLightColorForId } from "../../utils/colors";

    export let data: {
        id: number;
        label?: string; // The operator symbol
        eclassId: number;
        color: string; // E-Class color (for group/handles)
        enodeColor: string; // E-Node identity color (hash-derived)
        args: number[]; // Argument IDs
    };

    // Calculate handle positions evenly along bottom (50px node width)
    $: handlePositions = data.args.map((_, i) => {
        const count = data.args.length;
        return ((i + 1) / (count + 1)) * 100;
    });

    // Selection state
    $: isSelected = $interactionStore.selection?.nodeIds.has(data.id) ?? false;

    // Ghost state: A node is canonical if all its arguments point to canonical e-class IDs
    // This implements the congruence invariant visualization
    $: isGhost = (() => {
        if (!$currentState) return false;

        // Check each argument: is it pointing to the canonical e-class?
        for (const argClassId of data.args) {
            const canonicalId =
                $currentState.unionFind[argClassId]?.canonical ?? argClassId;
            // If any argument is non-canonical, this node is non-canonical (ghost it)
            if (canonicalId !== argClassId) {
                return true;
            }
        }

        // All arguments are canonical, so this node is canonical
        return false;
    })();

    // Phase-based state detection
    $: isMatched =
        $currentState?.metadata.matches.some((m) =>
            m.nodes.includes(data.id),
        ) ?? false;

    // Check if this node is being added (any type)
    $: isInDiff =
        $currentState?.metadata.diffs.some(
            (d) =>
                (d.type === "add" && d.nodeId === data.id) ||
                (d.type === "rewrite" && d.createdId === data.id),
        ) ?? false;

    // Check if this is specifically a RHS node from a rewrite (should be yellow)
    $: isRHSCreated =
        $currentState?.metadata.diffs.some(
            (d) => d.type === "rewrite" && d.createdId === data.id,
        ) ?? false;

    // Check if this is a plain addition (not from rewrite, should be red)
    $: isPlainAdd =
        $currentState?.metadata.diffs.some(
            (d) => d.type === "add" && d.nodeId === data.id,
        ) ?? false;

    $: isInWorklist = $currentState?.worklist.includes(data.id) ?? false;

    // Compute state-based colors
    $: borderColor = (() => {
        const phase = $currentState?.phase;

        // Read phase: LHS matched in yellow
        if (phase === "read" && isMatched) return "#eab308";

        // Write phase:
        if (phase === "write") {
            // LHS match tree stays yellow
            if (isMatched) return "#eab308";
            // All new nodes (plain add or RHS rewrite): red
            if (isPlainAdd || isRHSCreated) return "#dc2626";
        }

        if (phase === "compact" && !isGhost) return "#f97316"; // Orange
        if (phase === "repair" && isInWorklist) return "#3b82f6"; // Blue
        if (isSelected) return "#2563eb"; // Selected blue
        return "#e5e7eb"; // Neutral gray
    })();

    $: backgroundColor = (() => {
        const phase = $currentState?.phase;

        // Read phase: LHS matched
        if (phase === "read" && isMatched) return "#fef3c7";

        // Write phase:
        if (phase === "write") {
            // LHS match tree stays yellow
            if (isMatched) return "#fef3c7";
            // All new nodes (plain add or RHS rewrite): red
            if (isPlainAdd || isRHSCreated) return "#fef2f2";
        }

        if (phase === "compact" && !isGhost) return "#fff7ed";
        if (phase === "repair" && isInWorklist) return "#eff6ff";
        if (isSelected) return "#eff6ff";
        return "white";
    })();

    function handleClick() {
        interactionStore.selectENode(data.id);
    }

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

<div
    class="flow-enode-wrapper"
    class:ghost={isGhost}
    style:--border-color={borderColor}
    style:--bg-color={backgroundColor}
    on:click={handleClick}
    role="button"
    tabindex="0"
>
    <!-- Identity Circle -->
    <div class="identity-circle" style:background={data.enodeColor}></div>

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
        background: var(--bg-color);
        border: 2px solid var(--border-color);
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: relative;
        box-sizing: border-box;
        overflow: visible;
        cursor: pointer;
        transition: all 0.15s ease-out;
    }

    .flow-enode-wrapper.ghost {
        opacity: 0.5;
        border-style: dashed;
    }

    .identity-circle {
        position: absolute;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        opacity: 0.25;
        z-index: 0;
        pointer-events: none;
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
