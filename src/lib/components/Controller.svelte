<script lang="ts">
    import {
        isPlaying,
        togglePlay,
        nextStep,
        prevStep,
        nextPhase,
        prevPhase,
        goToStep,
        scrubTo,
        timelinePosition,
        currentIndex,
        displayIndex,
        displayState,
        timeline,
        playbackSpeed,
        setSpeed,
        layoutVersion,
        timeScaleMode,
        executionSpans,
    } from "../stores/timelineStore";
    import { executionTiming } from "../stores/benchmarkStore";
    import { stageTotals } from "../engine/benchmark";
    import { layoutManager } from "../engine/layout";
    import {
        describeStep,
        PHASE_LABELS,
        PHASE_DESCRIPTIONS,
    } from "../engine/describe";
    import { PHASE_COLORS } from "../engine/visualStyles";
    import TimelineTrack from "./TimelineTrack.svelte";
    import ExecutionTimePanel from "./ExecutionTimePanel.svelte";
    import { buildTimeScale, formatDuration } from "./timelineTrack";

    $: current = $currentIndex;
    $: total = $timeline ? $timeline.states.length : 0;
    $: max = Math.max(0, total - 1);

    const SPEEDS = [
        { label: "0.25×", ms: 3200 },
        { label: "0.5×", ms: 1800 },
        { label: "1×", ms: 900 },
        { label: "2×", ms: 450 },
        { label: "4×", ms: 220 },
        { label: "8×", ms: 110 },
    ];

    // Snap to the nearest step when released close to one
    function handleSliderChange(value: number) {
        const snapped = Math.round(value);
        if (Math.abs(value - snapped) < 0.12) goToStep(snapped, true);
    }

    // Text describes the step being animated (see displayIndex)
    $: description = $displayState ? describeStep($displayState) : "";
    $: phase = $displayState?.phase;
    $: iteration = $displayState?.metadata.iteration ?? 0;

    // ─── Execution time ──────────────────────────────────────────────────
    $: timeMode = $timeScaleMode === "time";
    $: measured = $executionTiming?.current.result ?? null;
    $: trackTiming = measured ? { steps: measured.steps, implementation: measured.implementation } : null;
    $: execScale = $executionSpans && $timeline ? buildTimeScale($timeline.states.length, $executionSpans, 1) : null;
    $: elapsed = execScale ? execScale.timeAt($timelinePosition) : 0;
    $: measuring = timeMode && (!$executionTiming || $executionTiming.current.status === "running");
    $: measureError = $executionTiming?.current.status === "error" ? $executionTiming.current.error : null;

    /** How the timeline shown compares with naive (or, when naive, with the deferred workers). */
    $: verdict = (() => {
        const t = $executionTiming;
        if (!t) return null;
        const totals = t.compare.map((c) => (c.result ? stageTotals(c.result).total : null));
        const naive = totals[0];
        const otherIndex = t.currentIndex === 0 ? t.compare.length - 1 : 0;
        const mine = totals[t.currentIndex];
        const other = totals[otherIndex];
        if (mine === null || other === null || naive === null || otherIndex === t.currentIndex) return null;
        const ratio = t.currentIndex === 0 ? naive / other : naive / mine;
        const text = `${ratio.toFixed(ratio >= 10 ? 0 : 1)}× ${ratio >= 1 ? "faster" : "slower"}`;
        return t.currentIndex === 0 ? `${t.compare[otherIndex].label} is ${text}` : `${text} than naive`;
    })();

    let showComparison = false;
    let comparisonEl: HTMLElement | undefined;
    let chipEl: HTMLElement | undefined;
    $: if (!timeMode) showComparison = false;

    function handleWindowClick(e: MouseEvent) {
        if (!showComparison) return;
        const t = e.target as Node;
        if (comparisonEl?.contains(t) || chipEl?.contains(t)) return;
        showComparison = false;
    }

    function setScale(mode: "steps" | "time") {
        timeScaleMode.set(mode);
    }

    const readLayoutProgress = (_v: number, _t: unknown) => layoutManager.progress();
    $: layoutProgress = readLayoutProgress($layoutVersion, $timeline);

    // ─── Keyboard shortcuts ──────────────────────────────────────────────
    function handleKeydown(e: KeyboardEvent) {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e.target as HTMLElement | null;
        if (
            t &&
            (t.isContentEditable ||
                ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(t.tagName))
        ) {
            if (!(t.tagName === "INPUT" && (t as HTMLInputElement).type === "range")) return;
        }
        if (document.querySelector(".modal-backdrop")) return;

        switch (e.key) {
            case " ":
                togglePlay();
                break;
            case "ArrowRight":
                e.shiftKey ? nextPhase() : nextStep();
                break;
            case "ArrowLeft":
                e.shiftKey ? prevPhase() : prevStep();
                break;
            case "Home":
                goToStep(0, true);
                break;
            case "End":
                goToStep(max, true);
                break;
            case "t":
            case "T":
                setScale($timeScaleMode === "time" ? "steps" : "time");
                break;
            default:
                return;
        }
        e.preventDefault();
    }
</script>

<svelte:window on:keydown={handleKeydown} on:click={handleWindowClick} />

<div class="controller">
    <div class="controls-left">
        <button
            class="btn"
            on:click={prevPhase}
            disabled={current === 0 || total === 0}
            title="Previous phase (Shift+←)"
            aria-label="Previous phase"
        >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 19 2 12 11 5 11 19"></polygon><polygon points="22 19 13 12 22 5 22 19"></polygon></svg>
        </button>
        <button
            class="btn"
            on:click={prevStep}
            disabled={current === 0 || total === 0}
            title="Previous step (←)"
            aria-label="Previous step"
        >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>
        </button>
        <button
            class="btn primary"
            on:click={togglePlay}
            disabled={total === 0}
            title={$isPlaying ? "Pause (Space)" : "Play (Space)"}
            aria-label={$isPlaying ? "Pause" : "Play"}
        >
            {#if $isPlaying}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
            {:else}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
            {/if}
        </button>
        <button
            class="btn"
            on:click={nextStep}
            disabled={current >= max || total === 0}
            title="Next step (→)"
            aria-label="Next step"
        >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>
        </button>
        <button
            class="btn"
            on:click={nextPhase}
            disabled={current >= max || total === 0}
            title="Next phase (Shift+→)"
            aria-label="Next phase"
        >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 19 22 12 13 5 13 19"></polygon><polygon points="2 19 11 12 2 5 2 19"></polygon></svg>
        </button>
    </div>

    <div class="timeline-col">
        <div class="description">
            {#if $displayState}
                <span class="iteration" title="Equality saturation iteration">it. {iteration}</span>
                <span class="text" title={description} aria-live="polite">{description}</span>
            {/if}
            {#if timeMode}
                <span class="exec">
                    {#if measureError}
                        <span class="exec-status error" title={measureError}>could not measure</span>
                    {:else if measuring || !execScale}
                        <span class="exec-status">measuring…</span>
                    {:else}
                        <span class="exec-clock" title="Execution time at the playhead / total (measured)">
                            {formatDuration(elapsed)} <span class="of">/ {formatDuration(execScale.total)}</span>
                        </span>
                        <button
                            class="exec-chip"
                            class:open={showComparison}
                            bind:this={chipEl}
                            on:click={() => (showComparison = !showComparison)}
                            title="Compare the stages with naive and deferred mode"
                            aria-expanded={showComparison}
                        >
                            {verdict ?? "Compare"}
                            <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true"><path d="M2 6.5 L5 3.5 L8 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                        </button>
                    {/if}
                </span>
            {/if}
        </div>
        <div class="slider-row">
            <span class="step-count" title="Step being shown / last step">{$displayIndex} / {max}</span>
            <TimelineTrack
                states={$timeline?.states ?? []}
                position={$timelinePosition}
                disabled={total === 0}
                timing={trackTiming}
                mode={$timeScaleMode}
                on:input={(e) => scrubTo(e.detail)}
                on:change={(e) => handleSliderChange(e.detail)}
            />
        </div>
    </div>

    <div class="info">
        {#if layoutProgress.total > 0 && layoutProgress.done < layoutProgress.total}
            <span class="layout-progress" title="Layouts computed in the background">
                layout {layoutProgress.done}/{layoutProgress.total}
            </span>
        {/if}
        <div class="scale-toggle" role="radiogroup" aria-label="Scrub bar scale">
            <button
                role="radio"
                aria-checked={!timeMode}
                class:active={!timeMode}
                on:click={() => setScale("steps")}
                title="One slot per step (T)"
            >Steps</button>
            <button
                role="radio"
                aria-checked={timeMode}
                class:active={timeMode}
                class:busy={measuring}
                on:click={() => setScale("time")}
                title="Each step as long as it takes to execute, measured in your browser; playback runs in scaled real time (T)"
            >
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M8 4.6 V8 L10.4 9.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                Time
            </button>
        </div>
        <select
            class="speed"
            value={$playbackSpeed}
            on:change={(e) => setSpeed(Number(e.currentTarget.value))}
            title="Playback speed"
            aria-label="Playback speed"
        >
            {#each SPEEDS as s}
                <option value={s.ms}>{s.label}</option>
            {/each}
        </select>
        {#if phase}
            <span
                class="phase-badge"
                style:--phase-color={PHASE_COLORS[phase]}
                title={PHASE_DESCRIPTIONS[phase]}
            >
                {PHASE_LABELS[phase]}
            </span>
        {/if}
    </div>

    {#if showComparison && $executionTiming}
        <div class="exec-popover" bind:this={comparisonEl}>
            <ExecutionTimePanel timing={$executionTiming} on:close={() => (showComparison = false)} />
        </div>
    {/if}
</div>

<style>
    .controller {
        position: relative;
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.45rem 1.25rem 0.55rem;
        background: white;
        border-top: 1px solid #e5e7eb;
        box-shadow: 0 -4px 6px -1px rgba(0, 0, 0, 0.04);
    }

    .controls-left {
        display: flex;
        gap: 0.35rem;
    }

    .btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 7px;
        border: 1px solid #d1d5db;
        background: white;
        color: #374151;
        cursor: pointer;
    }

    .btn:hover:not(:disabled) {
        background: #f9fafb;
        border-color: #9ca3af;
        color: #111827;
    }

    .btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .btn.primary {
        width: 40px;
        background: #3b82f6;
        border-color: #3b82f6;
        color: white;
    }

    .btn.primary:hover:not(:disabled) {
        background: #2563eb;
        border-color: #2563eb;
        color: white;
    }

    .timeline-col {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .description {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 18px;
        font-size: 0.8rem;
        color: #374151;
        padding-left: 76px;
    }

    .description .text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
    }

    .exec {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums;
    }

    .exec-clock {
        font-weight: 600;
        color: #0f172a;
    }

    .exec-clock .of {
        font-weight: 500;
        color: #64748b;
    }

    .exec-status {
        color: #94a3b8;
        font-style: italic;
    }

    .exec-status.error {
        color: #b91c1c;
        font-style: normal;
    }

    .exec-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 1px 8px;
        border-radius: 999px;
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
    }

    .exec-chip:hover,
    .exec-chip.open {
        background: #dbeafe;
        border-color: #93c5fd;
    }

    .exec-chip.open svg {
        transform: rotate(180deg);
    }

    .exec-popover {
        position: absolute;
        right: 1.25rem;
        bottom: calc(100% + 8px);
        z-index: 40;
    }

    .scale-toggle {
        display: flex;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        overflow: hidden;
    }

    .scale-toggle button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border: none;
        background: white;
        color: #4b5563;
        font-size: 0.75rem;
        font-weight: 500;
        cursor: pointer;
    }

    .scale-toggle button + button {
        border-left: 1px solid #d1d5db;
    }

    .scale-toggle button:hover:not(.active) {
        background: #f9fafb;
        color: #111827;
    }

    .scale-toggle button.active {
        background: #eff6ff;
        color: #1d4ed8;
        font-weight: 600;
    }

    .scale-toggle button.busy svg {
        animation: spin 1.2s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .iteration {
        flex-shrink: 0;
        font-size: 0.7rem;
        font-weight: 600;
        color: #6b7280;
        background: #f3f4f6;
        border-radius: 4px;
        padding: 0 5px;
        font-variant-numeric: tabular-nums;
    }

    .slider-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .step-count {
        font-family: ui-monospace, Menlo, monospace;
        font-size: 0.85rem;
        color: #4b5563;
        min-width: 66px;
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    .info {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: flex-end;
    }

    .layout-progress {
        font-size: 0.7rem;
        color: #9ca3af;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }

    .speed {
        font-size: 0.8rem;
        padding: 4px 6px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: white;
        color: #374151;
        cursor: pointer;
    }

    .phase-badge {
        min-width: 70px;
        text-align: center;
        padding: 3px 8px;
        border-radius: 5px;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        font-weight: 700;
        cursor: help;
        color: #1f2937;
        background: color-mix(in srgb, var(--phase-color) 22%, white);
        border: 1px solid var(--phase-color);
    }
</style>
