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

    // Check if this node is "non-canonical" (ghost)
    // A node is non-canonical if any of its arguments point to a non-canonical e-class ID
    // This is the congruence invariant: f(a) ~ f(b) if a ~ b
    $: isNonCanonicalNode = data.args.some((argId) => {
        const argClass = $currentState?.unionFind[argId];
        return argClass && !argClass.isCanonical;
    });

    // Helper to check if a specific port (argument) is non-canonical
    function isPortNonCanonical(argId: number): boolean {
        const argClass = $currentState?.unionFind[argId];
        return argClass ? !argClass.isCanonical : false;
    }

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

    // Compute state-based colors (more vibrant)
    $: borderColor = (() => {
        const phase = $currentState?.phase;

        // Read phase: LHS matched in yellow
        if (phase === "read" && isMatched) return "#facc15";

        // Write phase:
        if (phase === "write") {
            // LHS match tree stays yellow
            if (isMatched) return "#facc15";
            // All new nodes (plain add or RHS rewrite): red
            if (isPlainAdd || isRHSCreated) return "#ef4444";
        }

        // Compact phase: Non-canonical nodes use dashed border (handled separately)
        // Border color still red, but style is dashed

        // Repair phase: Highlight nodes that are parents of the active e-class
        // These are the nodes being "repaired" (re-canonicalized)
        if (phase === "repair") {
            const activeId = $currentState?.metadata.activeId;
            if (data.id === 3) {
                console.log(
                    `[Repair Border] Node ${data.id}: phase=${phase}, activeId=${activeId}, args=`,
                    data.args,
                    `includes=${data.args.includes(activeId!)}`,
                );
            }
            if (activeId !== undefined && data.args.includes(activeId)) {
                return "#3b82f6"; // Blue
            }
        }

        if (isSelected) return "#2563eb"; // Selected blue
        return "#000000"; // Black border by default
    })();

    $: backgroundColor = (() => {
        const phase = $currentState?.phase;

        // Read phase: LHS matched - same as border for solid appearance
        if (phase === "read" && isMatched) return "#facc15";

        // Write phase:
        if (phase === "write") {
            // LHS match tree stays yellow
            if (isMatched) return "#facc15";
            // All new nodes (plain add or RHS rewrite): red
            if (isPlainAdd || isRHSCreated) return "#ef4444";
        }

        // Compact phase: Keep background normal for non-canonical nodes
        // (red dashed border is enough to show non-canonicality)

        // Repair phase: Highlight nodes that are parents of the active e-class
        if (phase === "repair") {
            const activeId = $currentState?.metadata.activeId;
            if (activeId !== undefined && data.args.includes(activeId)) {
                return "#3b82f6"; // Blue
            }
        }

        if (isSelected) return "#3b82f6";
        return "white";
    })();

    // Border style: dashed for non-canonical nodes in compact phase
    $: borderStyle = (() => {
        const phase = $currentState?.phase;
        if (phase === "compact" && isNonCanonicalNode) {
            return "dashed";
        }
        return "solid";
    })();

    // Text color for contrast on vibrant backgrounds
    $: textColor = (() => {
        if (backgroundColor === "white") return "#374151";
        return "#ffffff"; // White text on vibrant colors
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

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick();
        }
    }
</script>

<div
    class="flow-enode-wrapper"
    class:ghost={isNonCanonicalNode}
    style:--border-color={borderColor}
    style:--border-style={borderStyle}
    style:--bg-color={backgroundColor}
    style:--text-color={textColor}
    style:--identity-color={data.enodeColor}
    on:click={handleClick}
    on:keydown={handleKeydown}
    role="button"
    tabindex="0"
>
    <!-- Identity Circle -->
    <div class="identity-circle"></div>

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
        {@const portIsNonCanonical = isPortNonCanonical(argId)}
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
                style="width: 100%; height: 100%; background: {portIsNonCanonical
                    ? '#ef4444'
                    : 'var(--color)'}; border: 1px solid white; top: 0; left: 0; transform: none; position: relative;"
            />
        </div>
    {/each}
</div>

<style>
    .flow-enode-wrapper {
        width: 100%;
        height: 100%;
        background: var(--bg-color);
        border: 2px var(--border-style, solid) var(--border-color);
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: relative;
        box-sizing: border-box;
        overflow: visible;
        cursor: pointer;
        transition: all 0.1s ease-out; /* Faster animation */
    }

    .identity-circle {
        position: absolute;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 2px solid #000000; /* Solid black border */
        background: var(--identity-color); /* Use the hash-based color */
        box-sizing: border-box;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 1; /* Above background, below text */
        pointer-events: none;
    }

    .symbol-container {
        width: 100%;
        height: 100%;
        padding: 2px;
        box-sizing: border-box;
        position: relative;
        z-index: 2; /* Above identity circle */
    }

    svg {
        width: 100%;
        height: 100%;
        position: relative;
        z-index: 3; /* Ensure text is above circle */
    }

    text {
        font-family: monospace;
        font-weight: bold;
        fill: var(--text-color, #374151);
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
