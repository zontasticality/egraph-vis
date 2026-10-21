<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { tweened, prefersReducedMotion } from "svelte/motion";
    import { cubicInOut } from "svelte/easing";
    import type { EGraphState, Implementation } from "../engine/types";
    import type { WorkSegment } from "../engine/work";
    import { stepSpan } from "../engine/work";
    import { transitionSpans } from "../engine/benchmark";
    import { describeStep, PHASE_LABELS } from "../engine/describe";
    import {
        buildTrackModel,
        buildTimeScale,
        labeledIterations,
        laneRects,
        stepAt,
        timeTicks,
        formatDuration,
        utilization,
        workColor,
        MIN_STEP_PX,
    } from "./timelineTrack";

    export let states: EGraphState[] = [];
    export let position = 0;
    export let disabled = false;
    /** Measured work of every step (aligned with `states`), for the time scale. */
    export let timing: { steps: WorkSegment[][]; implementation: Implementation } | null = null;
    /** Show steps evenly ("steps") or as long as they take to execute ("time"). */
    export let mode: "steps" | "time" = "steps";

    const dispatch = createEventDispatcher<{ input: number; change: number }>();

    /** Half the thumb width: the thumb center travels between these insets. */
    const INSET = 9;
    const HEIGHT = 30;

    let width = 0;
    $: inner = Math.max(0, width - 2 * INSET);
    $: model = buildTrackModel(states);
    $: max = model.steps;
    $: px = max > 0 ? inner / max : 0;
    $: labeled = labeledIterations(model, px);

    // ─── Scale: steps ↔ execution time (animated) ──────────────────────
    $: timed = !!timing && timing.steps.length === states.length && states.length > 1;
    $: spans = timed ? transitionSpans(timing!) : null;
    const bias = tweened(0, { duration: 450, easing: cubicInOut });
    $: bias.set(mode === "time" && timed ? 1 : 0, prefersReducedMotion.current ? { duration: 0 } : undefined);
    $: scale = buildTimeScale(states.length, spans, $bias);
    $: x = (at: number) => scale.toX(at) * inner;

    // The bar grows to fit the worker lanes in time mode
    $: barH = 8 + 6 * $bias;
    $: barY = 8 - 3 * $bias;
    $: lanesShown = $bias > 0.001 && timed;

    $: stepWidth = (i: number) => (scale.xs[i] - scale.xs[i - 1]) * inner;
    $: separators = (() => {
        const out: number[] = [];
        for (let i = 1; i < max; i++) {
            if (Math.min(stepWidth(i), stepWidth(i + 1)) >= MIN_STEP_PX) out.push(i);
        }
        return out;
    })();

    $: ticks = $bias > 0.01 && spans ? timeTicks(scale.total, inner) : [];
    $: tickX = (ms: number) => scale.toX(scale.positionAtTime(ms)) * inner;
    $: totalLabel = scale.total > 0 ? formatDuration(scale.total) : "";

    // ─── Canvas: the bar body ───────────────────────────────────────────
    let canvas: HTMLCanvasElement;

    function paint(..._deps: unknown[]) {
        if (!canvas || width <= 0) return;
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
        if (canvas.height !== Math.round(HEIGHT * dpr)) canvas.height = Math.round(HEIGHT * dpr);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, HEIGHT);
        if (inner <= 0 || max <= 0) return;

        ctx.save();
        ctx.translate(INSET, barY);
        // The bar overhangs the first/last step by 4px so its rounded ends peek out from under the thumb
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-4, 0, inner + 8, barH, barH / 2);
        else ctx.rect(-4, 0, inner + 8, barH);
        ctx.clip();

        // Steps: one colored run per phase
        const blocks = 1 - (lanesShown ? $bias : 0);
        if (blocks > 0.001) {
            ctx.globalAlpha = blocks;
            model.runs.forEach((run, i) => {
                const x0 = i === 0 ? -4 : x(run.from) + (i > 0 && x(run.to) - x(run.from) >= 3 ? 1 : 0);
                const x1 = i === model.runs.length - 1 ? inner + 4 : x(run.to);
                ctx.fillStyle = run.color;
                ctx.fillRect(x0, 0, Math.max(0, x1 - x0), barH);
            });
        }

        // Time: what each worker did, to scale
        if (lanesShown && timing) {
            const first = model.runs[0];
            const last = model.runs[model.runs.length - 1];
            ctx.globalAlpha = $bias;
            ctx.fillStyle = first.color;
            ctx.fillRect(-4, 0, 4, barH);
            ctx.fillStyle = last.color;
            ctx.fillRect(inner, 0, 4, barH);
            for (const r of laneRects({ steps: timing.steps, scale, width: inner, height: barH, implementation: timing.implementation })) {
                ctx.globalAlpha = $bias * r.alpha;
                ctx.fillStyle = r.color;
                ctx.fillRect(r.x, r.y, r.width, r.height);
            }
        }

        // Step separators: each segment is one animation
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#ffffff";
        for (const at of separators) ctx.fillRect(x(at) - 0.5, 0, 1, barH);
        ctx.restore();
    }

    $: paint(canvas, width, inner, model, timing, scale, barH, barY, separators, lanesShown);

    // ─── Hover hint ─────────────────────────────────────────────────────
    let hover: { x: number; step: number } | null = null;

    function handlePointerMove(e: PointerEvent) {
        if (disabled || max <= 0 || inner <= 0) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const local = Math.min(inner, Math.max(0, e.clientX - rect.left - INSET));
        hover = { x: local + INSET, step: stepAt(scale.toPosition(local / inner), max) };
    }

    $: hoverState = hover ? states[hover.step] : null;
    $: hintLeft = hover ? Math.min(Math.max(hover.x, 140), Math.max(140, width - 140)) : 0;
    $: hoverTiming = (() => {
        if (!hover || !timed || mode !== "time" || !timing) return null;
        const segments = timing.steps[hover.step] ?? [];
        const busy = utilization(segments);
        const workers = Math.max(1, ...segments.map((s) => s.workers));
        const parts = segments.length > 1
            ? segments.map((s) => ({ kind: s.kind, ms: Math.max(...s.lanes, 0), color: workColor(s.kind, timing!.implementation) }))
            : [];
        return {
            span: stepSpan(segments),
            share: scale.total > 0 ? stepSpan(segments) / scale.total : 0,
            workers,
            busy,
            parts,
        };
    })();

    function value(e: Event) {
        return scale.toPosition(parseFloat((e.target as HTMLInputElement).value));
    }

    onDestroy(() => (hover = null));
</script>

<div
    class="track"
    bind:clientWidth={width}
    on:pointermove={handlePointerMove}
    on:pointerleave={() => (hover = null)}
>
    <canvas bind:this={canvas} style:width="{width}px" style:height="{HEIGHT}px" aria-hidden="true"></canvas>
    {#if inner > 0 && max > 0}
        <svg {width} height={HEIGHT} aria-hidden="true">
            <defs>
                <clipPath id="track-bar-clip">
                    <rect x="-4" y={barY} width={inner + 8} height={barH} rx={barH / 2} />
                </clipPath>
            </defs>
            <g transform="translate({INSET} 0)">
                <!-- Not played yet -->
                <rect
                    clip-path="url(#track-bar-clip)"
                    x={x(position)}
                    y={barY}
                    width={Math.max(0, inner + 4 - x(position))}
                    height={barH}
                    fill="white"
                    opacity="0.5"
                />

                <!-- Phase boundaries (step scale) -->
                <g opacity={1 - $bias}>
                    {#each model.phaseTicks as at}
                        <line class="phase-tick" x1={x(at)} x2={x(at)} y1={barY + barH + 1.5} y2={barY + barH + 5} />
                    {/each}
                </g>

                <!-- Iteration starts -->
                {#each model.iterationTicks as tick}
                    <line class="iteration-tick" x1={x(tick.at)} x2={x(tick.at)} y1={barY - 3} y2={barY + barH + 6 - 2 * $bias} />
                    {#if labeled.has(tick.at) && $bias < 0.99}
                        <text class="iteration-label" opacity={1 - $bias} x={x(tick.at) + 2.5} y={barY + barH + 12}>{tick.iteration}</text>
                    {/if}
                {/each}

                <!-- Execution time axis (time scale) -->
                {#if ticks.length > 0}
                    <g class="time-axis" opacity={$bias}>
                        {#each ticks as ms}
                            {@const tx = tickX(ms)}
                            <line class="time-tick" x1={tx} x2={tx} y1={barY + barH + 1} y2={barY + barH + 4} />
                            {#if tx < inner - 46}
                                <text class="time-label" x={tx} y={HEIGHT - 1} text-anchor={ms === 0 ? "start" : "middle"}>{ms === 0 ? "0" : formatDuration(ms)}</text>
                            {/if}
                        {/each}
                        <text class="time-label total" x={inner} y={HEIGHT - 1} text-anchor="end">{totalLabel}</text>
                    </g>
                {/if}

                {#if hover}
                    <line class="hover-line" x1={hover.x - INSET} x2={hover.x - INSET} y1={barY - 2} y2={barY + barH + 2} />
                {/if}
            </g>
        </svg>
    {/if}

    <input
        type="range"
        min="0"
        max="1"
        step="any"
        value={scale.toX(position)}
        {disabled}
        aria-label="Timeline position"
        aria-valuetext="Step {Math.round(position)} of {max}"
        on:input={(e) => dispatch("input", value(e))}
        on:change={(e) => dispatch("change", value(e))}
    />

    {#if hover && hoverState}
        <div class="hint" style:left="{hintLeft}px">
            <div class="hint-head">
                <span class="hint-phase">{PHASE_LABELS[hoverState.phase]}</span>
                step {hover.step} · it. {hoverState.metadata.iteration}
            </div>
            {#if hoverTiming}
                <div class="hint-time">
                    <strong>{formatDuration(hoverTiming.span)}</strong>
                    <span class="muted">({Math.round(hoverTiming.share * 1000) / 10}% of the run)</span>
                    {#if hoverTiming.busy !== null}
                        · {hoverTiming.workers} workers, {Math.round(hoverTiming.busy * 100)}% busy
                    {/if}
                </div>
                {#if hoverTiming.parts.length > 0}
                    <div class="hint-parts">
                        {#each hoverTiming.parts as part}
                            <span><i style:background={part.color}></i>{part.kind} {formatDuration(part.ms)}</span>
                        {/each}
                    </div>
                {/if}
            {/if}
            <div class="hint-text">{describeStep(hoverState)}</div>
        </div>
    {/if}
</div>

<style>
    .track {
        position: relative;
        flex: 1;
        min-width: 0;
        height: 30px;
    }

    canvas,
    svg {
        position: absolute;
        left: 0;
        top: 0;
        pointer-events: none;
    }

    svg {
        overflow: visible;
    }

    .phase-tick {
        stroke: #94a3b8;
        stroke-width: 1;
    }

    .iteration-tick {
        stroke: #475569;
        stroke-width: 1.4;
    }

    .iteration-label,
    .time-label {
        font: 600 8.5px ui-sans-serif, system-ui, sans-serif;
        fill: #64748b;
        font-variant-numeric: tabular-nums;
    }

    .time-label.total {
        fill: #334155;
        font-weight: 700;
    }

    .time-tick {
        stroke: #cbd5e1;
        stroke-width: 1;
    }

    .hover-line {
        stroke: #0f172a;
        stroke-width: 1.5;
        opacity: 0.5;
    }

    input[type="range"] {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        width: 100%;
        height: 24px;
        margin: 0;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
    }

    input[type="range"]:disabled {
        cursor: default;
    }

    input[type="range"]::-webkit-slider-runnable-track {
        height: 24px;
        background: transparent;
    }

    input[type="range"]::-moz-range-track {
        height: 24px;
        background: transparent;
    }

    input[type="range"]::-webkit-slider-thumb {
        box-sizing: border-box;
        height: 18px;
        width: 18px;
        margin-top: 3px;
        border-radius: 50%;
        background: #ffffff;
        border: 2px solid #1d4ed8;
        -webkit-appearance: none;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }

    input[type="range"]::-moz-range-thumb {
        box-sizing: border-box;
        height: 18px;
        width: 18px;
        border: 2px solid #1d4ed8;
        border-radius: 50%;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }

    input[type="range"]:focus {
        outline: none;
    }

    input[type="range"]:focus-visible::-webkit-slider-thumb {
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3);
    }

    input[type="range"]:focus-visible::-moz-range-thumb {
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3);
    }

    .hint {
        position: absolute;
        bottom: 34px;
        transform: translateX(-50%);
        width: max-content;
        max-width: 300px;
        padding: 6px 9px;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 7px;
        font-size: 0.72rem;
        line-height: 1.4;
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.25);
        pointer-events: none;
        z-index: 20;
    }

    .hint-head {
        color: #94a3b8;
        font-variant-numeric: tabular-nums;
    }

    .hint-phase {
        color: white;
        font-weight: 700;
        margin-right: 4px;
    }

    .hint-time {
        color: #e2e8f0;
        font-variant-numeric: tabular-nums;
    }

    .hint-time strong {
        color: white;
    }

    .muted {
        color: #94a3b8;
    }

    .hint-parts {
        display: flex;
        flex-wrap: wrap;
        gap: 2px 10px;
        color: #cbd5e1;
        font-variant-numeric: tabular-nums;
    }

    .hint-parts i {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 2px;
        margin-right: 4px;
        vertical-align: -0.5px;
    }

    .hint-text {
        color: #e2e8f0;
    }
</style>
