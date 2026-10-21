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
        timeline,
        currentState,
        playbackSpeed,
        setSpeed,
        layoutVersion,
    } from "../stores/timelineStore";
    import { layoutManager } from "../engine/layout";
    import {
        describeStep,
        PHASE_LABELS,
        PHASE_DESCRIPTIONS,
    } from "../engine/describe";
    import { PHASE_COLORS } from "../engine/visualStyles";
    import type { EGraphState } from "../engine/types";

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

    function handleSliderInput(event: Event) {
        scrubTo(parseFloat((event.target as HTMLInputElement).value));
    }

    // Snap to the nearest step when released close to one
    function handleSliderChange(event: Event) {
        const value = parseFloat((event.target as HTMLInputElement).value);
        const snapped = Math.round(value);
        if (Math.abs(value - snapped) < 0.12) goToStep(snapped, true);
    }

    $: description = $currentState ? describeStep($currentState) : "";
    $: phase = $currentState?.phase;
    $: iteration = $currentState?.metadata.iteration ?? 0;

    // Track gradient: one colored segment per run of equal phases
    function trackGradient(states: EGraphState[]): string {
        const n = states.length;
        if (n <= 1) {
            const c = n === 1 ? PHASE_COLORS[states[0].phase] : "#e5e7eb";
            return `linear-gradient(to right, ${c} 0%, ${c} 100%)`;
        }
        const stops: string[] = [];
        let runStart = 0;
        for (let i = 1; i <= n - 1; i++) {
            if (i === n - 1 || states[i].phase !== states[runStart].phase) {
                const color = PHASE_COLORS[states[runStart].phase];
                const a = (runStart / (n - 1)) * 100;
                const b = (i / (n - 1)) * 100;
                stops.push(`${color} ${a}%`, `${color} ${b}%`);
                runStart = i;
            }
        }
        return `linear-gradient(to right, ${stops.join(", ")})`;
    }

    $: gradient = trackGradient($timeline?.states ?? []);
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
            default:
                return;
        }
        e.preventDefault();
    }
</script>

<svelte:window on:keydown={handleKeydown} />

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
        <div class="description" aria-live="polite">
            {#if $currentState}
                <span class="iteration" title="Equality saturation iteration">it. {iteration}</span>
                <span class="text" title={description}>{description}</span>
            {/if}
        </div>
        <div class="slider-row">
            <span class="step-count" title="Step / last step">{current} / {max}</span>
            <input
                type="range"
                min="0"
                {max}
                step="0.01"
                value={$timelinePosition}
                on:input={handleSliderInput}
                on:change={handleSliderChange}
                disabled={total === 0}
                aria-label="Timeline position"
                style="--track-gradient: {gradient}"
            />
        </div>
    </div>

    <div class="info">
        {#if layoutProgress.total > 0 && layoutProgress.done < layoutProgress.total}
            <span class="layout-progress" title="Layouts computed in the background">
                layout {layoutProgress.done}/{layoutProgress.total}
            </span>
        {/if}
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
</div>

<style>
    .controller {
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

    input[type="range"] {
        flex: 1;
        min-width: 0;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
        height: 22px;
    }

    input[type="range"]::-webkit-slider-runnable-track {
        height: 8px;
        background: var(--track-gradient);
        border-radius: 4px;
    }

    input[type="range"]::-moz-range-track {
        height: 8px;
        background: var(--track-gradient);
        border-radius: 4px;
    }

    input[type="range"]::-webkit-slider-thumb {
        height: 18px;
        width: 18px;
        border-radius: 50%;
        background: #ffffff;
        border: 2px solid #1d4ed8;
        -webkit-appearance: none;
        margin-top: -5px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    input[type="range"]::-moz-range-thumb {
        height: 16px;
        width: 16px;
        border: 2px solid #1d4ed8;
        border-radius: 50%;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    input[type="range"]:focus {
        outline: none;
    }

    input[type="range"]:focus-visible::-webkit-slider-thumb {
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.25);
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
