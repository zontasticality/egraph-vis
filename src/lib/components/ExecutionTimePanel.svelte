<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { ExecutionTiming } from "../stores/benchmarkStore";
    import { stageTotals, STAGES, type Stage, type StageTotals } from "../engine/benchmark";
    import { formatDuration } from "./timelineTrack";
    import { PHASE_COLORS } from "../engine/visualStyles";

    export let timing: ExecutionTiming;

    const dispatch = createEventDispatcher<{ close: void }>();

    /** Stage colors (validated as a categorical set: read, write, rebuild). */
    const STAGE_COLORS: Record<Stage, string> = {
        read: PHASE_COLORS.read,
        write: PHASE_COLORS.write,
        rebuild: PHASE_COLORS.repair,
    };
    const STAGE_LABELS: Record<Stage, string> = { read: "Read", write: "Write", rebuild: "Rebuild" };
    const TABLE_ROWS = [...STAGES, "total"] as const;

    $: rows = timing.compare.map((slot, i) => ({
        ...slot,
        current: i === timing.currentIndex,
        totals: slot.result ? stageTotals(slot.result) : null,
    }));
    $: naive = rows[0]?.totals ?? null;
    $: scaleMax = Math.max(1e-12, ...rows.map((r) => r.totals?.total ?? 0));
    $: runs = rows.filter((r) => r.result).map((r) => r.result!.runs);
    $: resolution = timing.current.result?.resolution ?? rows.find((r) => r.result)?.result?.resolution ?? 0;
    $: coarse = resolution > 0.02;
    $: overhead = timing.current.result?.overhead ?? 0;

    const BAR_W = 170;
    const BAR_H = 12;
    const GAP = 2;

    function segments(t: StageTotals) {
        let x = 0;
        return STAGES.map((stage) => {
            const w = (t[stage] / scaleMax) * BAR_W;
            const seg = { stage, x, width: Math.max(0, w - (w > GAP * 2 ? GAP : 0)), value: t[stage] };
            x += w;
            return seg;
        }).filter((s) => s.value > 0);
    }

    /** "3.4× faster" / "1.2× slower" relative to naive. */
    function versus(value: number, base: number | undefined): string {
        if (!base || !value) return "";
        const r = base / value;
        if (Math.abs(r - 1) < 0.05) return "≈ naive";
        return r > 1 ? `${r.toFixed(r >= 10 ? 0 : 1)}× faster` : `${(1 / r).toFixed(1)}× slower`;
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") dispatch("close");
    }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="panel" role="dialog" aria-label="Execution time comparison">
    <header>
        <div>
            <h3>Execution time</h3>
            <p class="sub">
                Measured in your browser{runs.length ? ` · ${Math.min(...runs)}+ interleaved runs each` : ""} · parallel phases last as long as their slowest worker
            </p>
        </div>
        <button class="close" on:click={() => dispatch("close")} aria-label="Close">×</button>
    </header>

    <div class="legend" aria-hidden="true">
        {#each STAGES as stage}
            <span><i style:background={STAGE_COLORS[stage]}></i>{STAGE_LABELS[stage]}</span>
        {/each}
    </div>

    <div class="bars">
        {#each rows as row, i}
            <div class="bar-row" class:current={row.current}>
                <span class="row-label" title={row.current ? "The timeline shown" : undefined}>{#if row.current}<span class="here" aria-label="shown"></span>{/if}{row.label}</span>
                {#if row.totals}
                    <svg width={BAR_W + 112} height={BAR_H + 4} role="img" aria-label="{row.label}: {formatDuration(row.totals.total)}">
                        <defs>
                            <!-- Square at the baseline, rounded at the data end -->
                            <clipPath id="exec-bar-{i}">
                                <rect x="0" y="2" width={Math.max(0, (row.totals.total / scaleMax) * BAR_W - 4)} height={BAR_H} />
                                <rect x="0" y="2" width={(row.totals.total / scaleMax) * BAR_W} height={BAR_H} rx="4" />
                            </clipPath>
                        </defs>
                        <g clip-path="url(#exec-bar-{i})">
                            {#each segments(row.totals) as seg}
                                <rect x={seg.x} y="2" width={seg.width} height={BAR_H} fill={STAGE_COLORS[seg.stage]}>
                                    <title>{STAGE_LABELS[seg.stage]}: {formatDuration(seg.value)} ({Math.round((seg.value / row.totals.total) * 100)}%)</title>
                                </rect>
                            {/each}
                        </g>
                        <text class="tip" x={(row.totals.total / scaleMax) * BAR_W + 6} y={BAR_H / 2 + 2}>
                            <tspan class="value">{formatDuration(row.totals.total)}</tspan>
                            {#if i > 0}<tspan class="factor" dx="5">{versus(row.totals.total, naive?.total)}</tspan>{/if}
                        </text>
                    </svg>
                {:else if row.status === "error"}
                    <span class="status error" title={row.error}>could not measure</span>
                {:else}
                    <span class="status">measuring…</span>
                {/if}
            </div>
        {/each}
    </div>

    <table>
        <thead>
            <tr>
                <th scope="col">Stage</th>
                {#each rows as row}
                    <th scope="col" class:current={row.current}>{row.label}</th>
                {/each}
            </tr>
        </thead>
        <tbody>
            {#each TABLE_ROWS as stage}
                <tr class:total={stage === "total"}>
                    <th scope="row">
                        {#if stage !== "total"}<i style:background={STAGE_COLORS[stage]}></i>{/if}{stage === "total" ? "Total" : STAGE_LABELS[stage]}
                    </th>
                    {#each rows as row, i}
                        <td class:current={row.current}>
                            {#if row.totals}
                                {formatDuration(row.totals[stage])}
                                {#if i > 0 && naive}
                                    <span class="factor">{versus(row.totals[stage], naive[stage])}</span>
                                {/if}
                            {:else}
                                –
                            {/if}
                        </td>
                    {/each}
                </tr>
            {/each}
        </tbody>
    </table>

    <p class="note">
        Times of this TypeScript engine (not egg) without snapshotting{overhead > 0 ? `, minus the ${formatDuration(overhead)} each clock reading costs` : ""}. Deferred rounds are lock-step: idle workers wait for the slowest one.
        {#if coarse}
            Your browser's clock ticks every {formatDuration(resolution)}, so short steps are averaged over many runs.
        {/if}
    </p>
</div>

<style>
    .panel {
        width: 400px;
        padding: 12px 14px 10px;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
        font-size: 0.75rem;
        color: #334155;
    }

    header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
    }

    h3 {
        margin: 0;
        font-size: 0.85rem;
        color: #0f172a;
    }

    .sub {
        margin: 2px 0 0;
        color: #64748b;
        font-size: 0.7rem;
    }

    .close {
        border: none;
        background: none;
        font-size: 1.1rem;
        line-height: 1;
        color: #64748b;
        cursor: pointer;
        padding: 0 2px;
    }

    .close:hover {
        color: #0f172a;
    }

    .legend {
        display: flex;
        gap: 12px;
        margin: 8px 0 4px;
        color: #475569;
    }

    i {
        display: inline-block;
        width: 9px;
        height: 9px;
        border-radius: 2px;
        margin-right: 5px;
        vertical-align: -0.5px;
    }

    .bars {
        padding-left: 10px;
        display: flex;
        flex-direction: column;
        gap: 3px;
        margin-bottom: 8px;
    }

    .bar-row {
        display: grid;
        grid-template-columns: 86px 1fr;
        align-items: center;
        min-height: 18px;
    }

    .row-label {
        position: relative;
        color: #475569;
        white-space: nowrap;
    }

    .current .row-label {
        color: #0f172a;
        font-weight: 600;
    }

    .here {
        position: absolute;
        left: -10px;
        top: calc(50% - 3px);
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #1d4ed8;
    }

    .tip {
        font-size: 10.5px;
        dominant-baseline: central;
    }

    .tip .value {
        fill: #0f172a;
        font-weight: 600;
    }

    .tip .factor,
    .factor {
        fill: #64748b;
        color: #64748b;
    }

    .status {
        color: #94a3b8;
        font-style: italic;
    }

    .status.error {
        color: #b91c1c;
        font-style: normal;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        font-variant-numeric: tabular-nums;
    }

    th,
    td {
        text-align: right;
        padding: 3px 4px;
        border-top: 1px solid #f1f5f9;
        white-space: nowrap;
    }

    thead th {
        border-top: none;
        color: #64748b;
        font-weight: 600;
        font-size: 0.68rem;
    }

    th[scope="row"],
    thead th:first-child {
        text-align: left;
        font-weight: 500;
        color: #475569;
    }

    td.current,
    th.current {
        background: #f8fafc;
    }

    tr.total td,
    tr.total th {
        font-weight: 700;
        color: #0f172a;
        border-top: 1px solid #e2e8f0;
    }

    td .factor {
        display: block;
        font-size: 0.64rem;
        font-weight: 500;
        line-height: 1.1;
    }

    .note {
        margin: 8px 0 0;
        color: #94a3b8;
        font-size: 0.66rem;
        line-height: 1.35;
    }
</style>
