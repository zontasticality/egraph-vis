<script lang="ts">
    import { currentState } from "../stores/timelineStore";
    import { interactionStore } from "../stores/interactionStore";
    import { getColorForId, getLightColorForId } from "../utils/colors";

    export let id: number;
    export let mode: "id" | "symbol" = "id";
    export let variant: "default" | "ghost" | "active" | undefined = undefined;

    // --- Data Fetching ---
    // Look up node structure from chunked registry
    $: node = $currentState?.nodeChunks
        ? $currentState.nodeChunks[Math.floor(id / 1024)]?.[id % 1024]
        : undefined;

    // --- Derived State ---
    $: isCanonical = $currentState?.unionFind[id]?.isCanonical ?? true; // Default to true if not found (e.g. init)
    $: canonicalId = $currentState?.unionFind[id]?.canonical ?? id;

    $: isSelected =
        $interactionStore.selection?.type === "eclass" &&
        $interactionStore.selection.id === canonicalId; // Select by canonical ID

    $: isHovered =
        $interactionStore.hover?.type === "eclass" &&
        $interactionStore.hover.id === canonicalId;

    // Active State Logic
    $: isActive = (() => {
        if (!$currentState?.metadata) return false;
        const { diffs, matches } = $currentState.metadata;
        const phase = $currentState.phase;

        // Read Phase: Highlight matches
        if (phase === "read" && matches) {
            return matches.some((m) => m.nodes.includes(id));
        }

        // Write Phase: Highlight diffs
        if (phase === "write") {
            return diffs.some(
                (d) =>
                    (d.type === "add" && d.nodeId === id) ||
                    (d.type === "merge" &&
                        (d.winner === id || d.losers.includes(id))),
            );
        }

        // Rebuild Phase: Highlight worklist
        if (phase === "rebuild") {
            return $currentState.worklist.includes(id);
        }

        return false;
    })();

    // Ghost State: If not canonical and not explicitly active
    $: isGhost = !isCanonical && !isActive;

    // Final Variant Resolution
    $: effectiveVariant =
        variant || (isActive ? "active" : isGhost ? "ghost" : "default");

    // --- Interaction ---
    function handleClick(e: MouseEvent) {
        e.stopPropagation();
        interactionStore.select({ type: "eclass", id: canonicalId });
    }

    function handleMouseEnter(e: MouseEvent) {
        e.stopPropagation();
        interactionStore.hover({ type: "eclass", id: canonicalId });
    }

    function handleMouseLeave() {
        interactionStore.clearHover();
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    class="enode mode-{mode} variant-{effectiveVariant}"
    class:selected={isSelected}
    class:hovered={isHovered}
    on:click={handleClick}
    on:mouseenter={handleMouseEnter}
    on:mouseleave={handleMouseLeave}
    style:--id-color={getColorForId(canonicalId)}
    style:--id-bg={getLightColorForId(canonicalId)}
>
    {#if mode === "id"}
        <span class="diamond">{id}</span>
    {:else if node}
        <span class="op">{node.op}</span>
        <span class="args">
            {#if node.args.length > 0}
                <span class="paren">(</span>
                {#each node.args as argId, i}
                    <svelte:self id={argId} mode="id" />
                    {#if i < node.args.length - 1}<span class="comma">,</span
                        >{/if}
                {/each}
                <span class="paren">)</span>
            {/if}
        </span>
    {:else}
        <!-- Fallback if node not found -->
        <span class="error">?{id}?</span>
    {/if}
</div>

<style>
    .enode {
        display: inline-flex;
        align-items: center;
        cursor: pointer;
        transition: all 0.1s ease-out;
        border-radius: 4px;
        font-family: monospace;
    }

    /* --- ID Mode --- */
    .mode-id {
        padding: 1px 4px;
        font-size: 0.85rem;
        font-weight: 600;
        background-color: var(--id-bg);
        color: var(--id-color);
        border: 1px solid transparent;
        border-radius: 999px; /* Pill shape */
    }

    /* --- Symbol Mode --- */
    .mode-symbol {
        padding: 2px 6px;
        background: white;
        border: 2px solid var(--id-color);
        color: #374151;
        gap: 2px;
    }

    /* --- Variants --- */
    .variant-active {
        border-color: #000;
        background: #fff;
        color: #000;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        transform: translateY(-1px);
        z-index: 10;
    }

    .variant-ghost {
        opacity: 0.6;
        border-style: dashed;
        background: #f9fafb;
        color: #9ca3af;
    }

    /* --- Interaction States --- */
    .hovered {
        box-shadow: 0 0 0 2px #93c5fd; /* Ring-2 blue-300 */
        z-index: 5;
    }

    .selected {
        box-shadow: 0 0 0 2px #2563eb; /* Ring-2 blue-600 */
        background-color: #eff6ff;
        z-index: 20;
    }

    /* --- Children --- */
    .op {
        font-weight: bold;
    }

    .args {
        display: inline-flex;
        align-items: center;
        gap: 2px;
    }

    .paren,
    .comma {
        color: #9ca3af;
    }

    .error {
        color: red;
        font-weight: bold;
    }
</style>
