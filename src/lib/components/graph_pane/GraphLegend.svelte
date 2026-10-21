<script lang="ts">
    import {
        NODE_STYLES,
        ECLASS_STYLES,
        SET_STYLE,
        EDGE_COLORS,
    } from "../../engine/visualStyles";
    import { NodeStyleClass, EClassStyleClass } from "../../engine/types";
    import type { Implementation } from "../../engine/types";

    export let implementation: Implementation = "deferred";

    const STORAGE_KEY = "egraph-vis-legend-open";
    let open =
        typeof localStorage !== "undefined" &&
        localStorage.getItem(STORAGE_KEY) === "1";

    function toggle() {
        open = !open;
        try {
            localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
        } catch {
            // ignore storage failures
        }
    }

    const nodeEntries = [
        NodeStyleClass.Default,
        NodeStyleClass.MatchedLHS,
        NodeStyleClass.NewNode,
        NodeStyleClass.NonCanonical,
        NodeStyleClass.ParentNode,
    ].map((k) => NODE_STYLES[k]);

    $: classEntries = [
        EClassStyleClass.Default,
        EClassStyleClass.InWorklist,
        EClassStyleClass.Active,
        ...(implementation === "deferred" ? [EClassStyleClass.Merged] : []),
    ].map((k) => ECLASS_STYLES[k]);
</script>

<div class="legend" class:open>
    <button class="legend-toggle" on:click={toggle} aria-expanded={open}>
        {open ? "Hide legend" : "Legend"}
    </button>
    {#if open}
        <div class="legend-body">
            <div class="group-title">E-nodes</div>
            {#each nodeEntries as s}
                <div class="row" title={s.description}>
                    <svg width="26" height="16"
                        ><rect
                            x="1"
                            y="1"
                            width="24"
                            height="14"
                            rx="4"
                            fill={s.fill}
                            stroke={s.stroke}
                            stroke-width="1.5"
                            stroke-dasharray={s.dashed ? "3 2" : null}
                        /></svg
                    >
                    <span class="name">{s.label}</span>
                    <span class="desc">{s.description}</span>
                </div>
            {/each}

            <div class="group-title">E-classes</div>
            {#each classEntries as s}
                <div class="row" title={s.description}>
                    <svg width="26" height="16"
                        ><rect
                            x="1"
                            y="1"
                            width="24"
                            height="14"
                            rx="4"
                            fill={s.fill}
                            stroke={s.stroke}
                            stroke-width="1.5"
                            stroke-dasharray={s.dashed ? "4 2" : null}
                        /></svg
                    >
                    <span class="name">{s.label}</span>
                    <span class="desc">{s.description}</span>
                </div>
            {/each}
            {#if implementation === "deferred"}
                <div class="row">
                    <svg width="26" height="16"
                        ><rect
                            x="1"
                            y="1"
                            width="24"
                            height="14"
                            rx="6"
                            fill={SET_STYLE.fill}
                            stroke={SET_STYLE.stroke}
                            stroke-width="1.5"
                        /></svg
                    >
                    <span class="name">{SET_STYLE.label}</span>
                    <span class="desc">{SET_STYLE.description}</span>
                </div>
            {/if}

            <div class="group-title">Edges</div>
            <div class="row">
                <svg width="26" height="16"
                    ><line x1="2" y1="8" x2="24" y2="8" stroke={EDGE_COLORS.normal} stroke-width="1.6" /></svg
                >
                <span class="name">Child</span>
                <span class="desc">Argument port → child e-class</span>
            </div>
            <div class="row">
                <svg width="26" height="16"
                    ><line
                        x1="2"
                        y1="8"
                        x2="24"
                        y2="8"
                        stroke={EDGE_COLORS.stale}
                        stroke-width="1.6"
                        stroke-dasharray="4 3"
                    /></svg
                >
                <span class="name">Stale</span>
                <span class="desc">Child id is not canonical (pre-repair)</span>
            </div>
            <div class="hint">Scroll to zoom · drag to pan · click to select</div>
        </div>
    {/if}
</div>

<style>
    .legend {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        font-size: 0.75rem;
        color: #334155;
    }

    .legend-toggle {
        border: 1px solid #d1d5db;
        background: white;
        border-radius: 7px;
        padding: 5px 10px;
        font-size: 0.75rem;
        font-weight: 600;
        color: #475569;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
    }

    .legend-toggle:hover {
        background: #f3f4f6;
    }

    .legend-body {
        background: rgba(255, 255, 255, 0.97);
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 8px 10px 10px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
        width: 290px;
    }

    .group-title {
        font-weight: 700;
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #94a3b8;
        margin: 6px 0 3px;
    }

    .row {
        display: grid;
        grid-template-columns: 28px 70px 1fr;
        align-items: center;
        gap: 4px;
        padding: 1px 0;
    }

    .name {
        font-weight: 600;
    }

    .desc {
        color: #64748b;
    }

    .hint {
        margin-top: 8px;
        color: #94a3b8;
        font-size: 0.7rem;
        text-align: center;
    }
</style>
