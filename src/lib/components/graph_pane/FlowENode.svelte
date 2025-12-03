<script lang="ts">
    import { Handle, Position } from "@xyflow/svelte";
    import { interactionStore } from "../../stores/interactionStore";
    import { currentState } from "../../stores/timelineStore";
    import { getColorForId, getLightColorForId } from "../../utils/colors";
    import { NODE_STYLES } from "../../engine/visualStyles";
    import type { NodeVisualState, NodeStyleClass } from "../../engine/types";

    export let data: {
        id: number;
        label?: string; // The operator symbol
        eclassId: number;
        color: string; // E-Class color (for group/handles)
        enodeColor: string; // E-Node identity color (hash-derived)
        args: number[]; // Argument IDs
        visualState?: NodeVisualState; // Precomputed current visual state
        nextVisualState?: NodeVisualState; // Precomputed next visual state (for interpolation)
        progress?: number; // Interpolation progress (0-1)
    };

    // Helper function to interpolate colors using CSS color-mix
    function interpolateColor(color1: string, color2: string, progress: number): string {
        if (progress <= 0.01) return color1;
        if (progress >= 0.99) return color2;

        // Convert progress to percentage
        const p1 = Math.round((1 - progress) * 100);
        const p2 = Math.round(progress * 100);

        // Use CSS color-mix for GPU-accelerated blending
        return `color-mix(in srgb, ${color1} ${p1}%, ${color2} ${p2}%)`;
    }

    // Calculate handle positions evenly along bottom (50px node width)
    $: handlePositions = data.args.map((_, i) => {
        const count = data.args.length;
        return ((i + 1) / (count + 1)) * 100;
    });

    // Selection state
    $: isSelected = $interactionStore.selection?.nodeIds.has(data.id) ?? false;

    // Get base style from visual state (fallback to Default if not provided)
    $: baseStyle = data.visualState
        ? NODE_STYLES[data.visualState.styleClass]
        : NODE_STYLES[0]; // Default style

    // Get next style if available
    $: nextStyle = data.nextVisualState
        ? NODE_STYLES[data.nextVisualState.styleClass]
        : null;

    // Check if this is a non-canonical node (for ghost styling)
    $: isNonCanonicalNode = data.visualState?.styleClass === 3; // NodeStyleClass.NonCanonical

    // Determine if we should interpolate
    $: shouldInterpolate = !isSelected &&
                           nextStyle &&
                           data.progress !== undefined &&
                           data.progress > 0.01 &&
                           data.progress < 0.99;

    // Apply selection override (blue) or interpolate/use base style
    $: borderColor = isSelected
        ? "#2563eb"
        : (shouldInterpolate
            ? interpolateColor(baseStyle.borderColor, nextStyle!.borderColor, data.progress!)
            : baseStyle.borderColor);

    $: backgroundColor = isSelected
        ? "#3b82f6"
        : (shouldInterpolate
            ? interpolateColor(baseStyle.backgroundColor, nextStyle!.backgroundColor, data.progress!)
            : baseStyle.backgroundColor);

    $: textColor = isSelected
        ? "#ffffff"
        : (shouldInterpolate
            ? interpolateColor(baseStyle.textColor, nextStyle!.textColor, data.progress!)
            : baseStyle.textColor);

    // Interpolate border style: use "dashed" if either state is dashed
    $: borderStyle = shouldInterpolate && (baseStyle.borderStyle === "dashed" || nextStyle!.borderStyle === "dashed")
        ? "dashed"
        : baseStyle.borderStyle;

    // Handle opacity for appearing/disappearing nodes
    $: nodeOpacity = (() => {
        // If node doesn't exist in next state, fade out
        if (shouldInterpolate && !data.nextVisualState) {
            return 1 - data.progress!; // Fade from 1 to 0
        }
        // If node didn't exist in current state (new node), fade in
        if (shouldInterpolate && !data.visualState) {
            return data.progress!; // Fade from 0 to 1
        }
        return 1; // Fully visible
    })();

    // Helper to check if a specific port (argument) is non-canonical
    // Use the portTargets from visual state for accurate port coloring
    function isPortNonCanonical(argIndex: number): boolean {
        if (!data.visualState?.portTargets) return false;
        const targetId = data.visualState.portTargets[argIndex];
        const argId = data.args[argIndex];
        // Port is non-canonical if target differs from original arg
        return targetId !== argId;
    }

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
    style:--opacity={nodeOpacity}
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
        {@const portIsNonCanonical = isPortNonCanonical(i)}
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
        opacity: var(--opacity, 1);
        transition: opacity 0.05s ease-out; /* Smooth opacity transitions */
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
