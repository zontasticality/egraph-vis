<script lang="ts">
    import { displayState } from "../../stores/timelineStore";
    import { interactionStore } from "../../stores/interactionStore";
    import { getColorForId, getLightColorForId } from "../../utils/colors";
    import { NODE_STYLES } from "../../engine/visualStyles";
    import { NodeStyleClass } from "../../engine/types";

    /** E-class / e-node id. */
    export let id: number;
    /** `id`: a pill for an id. `symbol`: an e-node `op(args)` chip. */
    export let mode: "id" | "symbol" = "id";
    /** E-node structure (symbol mode). */
    export let node: { op: string; args: number[] } | undefined = undefined;
    /** Visual state of the e-node (symbol mode). */
    export let styleClass: NodeStyleClass = NodeStyleClass.Default;

    $: canonicalId = $displayState?.unionFind[id]?.canonical ?? id;
    $: isCanonical = canonicalId === id;
    $: isSelected = $interactionStore.selection?.nodeIds.has(id) ?? false;
    $: hover = $interactionStore.hover;
    $: isHovered =
        (hover?.type === "eclass" && hover.id === canonicalId) ||
        (hover?.type === "enode" && hover.id === id);
    $: style = NODE_STYLES[styleClass];

    function handleClick(e: MouseEvent) {
        e.stopPropagation();
        interactionStore.selectENode(id);
    }

    function handleEnter() {
        interactionStore.hover(
            mode === "symbol"
                ? { type: "enode", id }
                : { type: "eclass", id: canonicalId },
        );
    }

    function handleLeave() {
        interactionStore.clearHover();
    }
</script>

{#if mode === "id"}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <span
        class="pill"
        class:ghost={!isCanonical}
        class:selected={isSelected}
        class:hovered={isHovered}
        role="button"
        tabindex="-1"
        title={isCanonical ? `e-class ${id}` : `${id} → canonical ${canonicalId}`}
        style:--id-color={getColorForId(canonicalId)}
        style:--id-bg={getLightColorForId(canonicalId)}
        on:click={handleClick}
        on:mouseenter={handleEnter}
        on:mouseleave={handleLeave}>{id}</span
    >
{:else}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <span
        class="symbol"
        class:selected={isSelected}
        class:hovered={isHovered}
        class:dashed={style.dashed}
        role="button"
        tabindex="-1"
        title="e-node #{id}"
        style:--fill={style.fill}
        style:--stroke={styleClass === NodeStyleClass.Default
            ? "#cbd5e1"
            : style.stroke}
        style:--text={style.text}
        on:click={handleClick}
        on:mouseenter={handleEnter}
        on:mouseleave={handleLeave}
    >
        <span class="op">{node?.op ?? "?"}</span>{#if node && node.args.length > 0}<span
                class="paren">(</span
            >{#each node.args as argId, i}<svelte:self
                    id={argId}
                    mode="id"
                />{#if i < node.args.length - 1}<span class="comma">,</span
                    >{/if}{/each}<span class="paren">)</span>{/if}
    </span>
{/if}

<style>
    .pill,
    .symbol {
        display: inline-flex;
        align-items: center;
        cursor: pointer;
        font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
        transition:
            box-shadow 0.1s ease-out,
            background-color 0.15s ease-out;
        white-space: nowrap;
    }

    .pill {
        padding: 0 5px;
        min-width: 18px;
        justify-content: center;
        font-size: 11px;
        line-height: 16px;
        font-weight: 700;
        color: var(--id-color);
        background: var(--id-bg);
        border: 1px solid var(--id-color);
        border-radius: 999px;
    }

    .pill.ghost {
        border-style: dashed;
        background: white;
        opacity: 0.75;
    }

    .symbol {
        gap: 1px;
        padding: 1px 5px;
        font-size: 11.5px;
        line-height: 18px;
        color: var(--text);
        background: var(--fill);
        border: 1.5px solid var(--stroke);
        border-radius: 6px;
    }

    .symbol.dashed {
        border-style: dashed;
    }

    .op {
        font-weight: 700;
        margin-right: 1px;
    }

    .paren,
    .comma {
        color: #94a3b8;
    }

    .comma {
        margin-right: 1px;
    }

    .hovered {
        box-shadow: 0 0 0 2px #93c5fd;
    }

    .selected {
        box-shadow: 0 0 0 2px #2563eb;
    }
</style>
