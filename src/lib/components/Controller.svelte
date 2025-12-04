<script lang="ts">
    import {
        isPlaying,
        togglePlay,
        nextStep,
        prevStep,
        goToStep,
        scrubTo,
        timelinePosition,
        currentIndex,
        timeline,
        progress,
        currentState,
    } from "../stores/timelineStore";

    $: current = $currentIndex; // Display integer value
    $: position = $timelinePosition; // Actual float position
    $: total = $timeline ? $timeline.states.length : 0;
    $: max = Math.max(0, total - 1);

    // Handle slider input (continuous scrubbing)
    function handleSliderInput(event: Event) {
        const value = parseFloat((event.target as HTMLInputElement).value);
        scrubTo(value);
    }

    // Handle slider change (snap to integer when released)
    function handleSliderChange(event: Event) {
        const value = parseFloat((event.target as HTMLInputElement).value);
        const snapped = Math.round(value);

        // Snap to integer if close enough (within 5%)
        if (Math.abs(value - snapped) < 0.05) {
            goToStep(snapped, true);
        }
    }

    // Phase descriptions for tooltips
    const phaseDescriptions: Record<
        string,
        { label: string; description: string }
    > = {
        init: {
            label: "Init",
            description:
                "Initial state: building the E-Graph from the root expression",
        },
        "read-batch": {
            label: "Read Batch",
            description:
                "Searching batch of E-Classes: processing matches in parallel groups",
        },
        read: {
            label: "Read",
            description:
                "Finding pattern matches: searching for applicable rewrite rules",
        },
        write: {
            label: "Write",
            description:
                "Applying rewrites: creating new E-Nodes and merging E-Classes",
        },
        compact: {
            label: "Compact",
            description:
                "Compacting E-Classes: moving nodes from non-canonical (red) classes to canonical classes",
        },
        repair: {
            label: "Repair",
            description:
                "Repairing congruence: processing worklist to restore E-Graph invariants",
        },
        done: {
            label: "Done",
            description: "Saturation complete: no more rewrites applicable",
        },
    };

    $: phaseInfo = $currentState
        ? phaseDescriptions[$currentState.phase]
        : null;

    // Phase colors (using border colors for vibrancy)
    const phaseColors: Record<string, string> = {
        init: "#d1d5db",
        "read-batch": "#fcd34d", // Slightly lighter yellow than read
        read: "#fbbf24",
        write: "#f87171",
        compact: "#fb923c",
        repair: "#60a5fa",
        done: "#10b981",
    };

    // Generate gradient for seekbar
    let trackGradient = "linear-gradient(to right, #e5e7eb 0%, #e5e7eb 100%)";

    $: if ($timeline && $timeline.states.length > 0) {
        const stops: string[] = [];
        const states = $timeline.states;
        const n = states.length;

        // Strategy: State-based coloring.
        // The slider goes from 0 to n-1.
        // The position p corresponds to state floor(p).
        // So the segment [i, i+1] corresponds to the duration where state i is active.
        // We color the segment [i, i+1] with the color of state i.

        // We iterate from 0 to n-2 to define the segments.
        for (let i = 0; i < n - 1; i++) {
            const state = states[i];
            const color = phaseColors[state.phase] || "#e5e7eb";
            const isReady = !!state.layout;
            const finalColor = isReady ? color : `${color}4D`; // 30% opacity

            const startPct = (i / (n - 1)) * 100;
            const endPct = ((i + 1) / (n - 1)) * 100;

            stops.push(`${finalColor} ${startPct}%`);
            stops.push(`${finalColor} ${endPct}%`);
        }

        // If there's only 1 state (n=1), the loop doesn't run, which is correct (0 length slider).
        // But we need at least one stop for valid CSS.
        if (stops.length === 0 && n > 0) {
            // Added n > 0 check for safety, though it should be covered by the outer if
            const color = phaseColors[states[0].phase] || "#e5e7eb";
            const isReady = !!states[0].layout;
            const finalColor = isReady ? color : `${color}4D`;
            stops.push(`${finalColor} 0%`);
            stops.push(`${finalColor} 100%`);
        }

        trackGradient = `linear-gradient(to right, ${stops.join(", ")})`;
    }
</script>

<div class="controller">
    <div class="controls-left">
        <button
            class="btn"
            on:click={prevStep}
            disabled={current === 0 || total === 0}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><polygon points="19 20 9 12 19 4 19 20"></polygon><line
                    x1="5"
                    y1="19"
                    x2="5"
                    y2="5"
                ></line></svg
            >
        </button>

        <button
            class="btn primary"
            on:click={togglePlay}
            disabled={total === 0}
        >
            {#if $isPlaying}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><rect x="6" y="4" width="4" height="16"></rect><rect
                        x="14"
                        y="4"
                        width="4"
                        height="16"
                    ></rect></svg
                >
            {:else}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><polygon points="5 3 19 12 5 21 5 3"></polygon></svg
                >
            {/if}
        </button>

        <button
            class="btn"
            on:click={nextStep}
            disabled={current >= max || total === 0}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><polygon points="5 4 15 12 5 20 5 4"></polygon><line
                    x1="19"
                    y1="5"
                    x2="19"
                    y2="19"
                ></line></svg
            >
        </button>
    </div>

    <span class="step-count">{current} / {max}</span>

    <div class="slider-container">
        <input
            type="range"
            min="0"
            {max}
            step="0.01"
            value={position}
            on:input={handleSliderInput}
            on:change={handleSliderChange}
            disabled={total === 0}
            style="--track-gradient: {trackGradient}"
        />
    </div>

    <div class="info">
        {#if phaseInfo}
            <span
                class="phase-badge phase-{$currentState?.phase}"
                title={phaseInfo.description}
            >
                {phaseInfo.label}
            </span>
        {/if}
    </div>
</div>

<style>
    .controller {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.75rem 1.5rem;
        background: white;
        border-top: 1px solid #e5e7eb;
        box-shadow: 0 -4px 6px -1px rgba(0, 0, 0, 0.05);
    }

    .controls-left {
        display: flex;
        gap: 0.5rem;
    }

    .btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 6px;
        border: 1px solid #d1d5db;
        background: white;
        color: #374151;
        cursor: pointer;
        align-items: center;
    }

    .slider-container {
        flex: 1;
        display: flex;
        align-items: center;
    }

    input[type="range"] {
        width: 100%;
        cursor: pointer;
        -webkit-appearance: none; /* Remove default styling */
        appearance: none;
        background: transparent; /* Transparent so we can style the track */
        height: 24px; /* Height of the touch area */
    }

    /* Track Styles */
    input[type="range"]::-webkit-slider-runnable-track {
        width: 100%;
        height: 8px;
        cursor: pointer;
        background: var(--track-gradient);
        border-radius: 4px;
        border: 1px solid #e5e7eb;
    }

    input[type="range"]::-moz-range-track {
        width: 100%;
        height: 8px;
        cursor: pointer;
        background: var(--track-gradient);
        border-radius: 4px;
        border: 1px solid #e5e7eb;
    }

    /* Thumb Styles */
    input[type="range"]::-webkit-slider-thumb {
        height: 20px;
        width: 20px;
        border-radius: 50%;
        background: #ffffff;
        border: 2px solid #3b82f6;
        cursor: pointer;
        -webkit-appearance: none;
        margin-top: -7px; /* Center on track (8px track, 20px thumb -> -6px offset, adjusted to -7) */
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        transition: transform 0.1s;
    }

    input[type="range"]::-moz-range-thumb {
        height: 20px;
        width: 20px;
        border: 2px solid #3b82f6;
        border-radius: 50%;
        background: #ffffff;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        transition: transform 0.1s;
    }

    input[type="range"]:focus::-webkit-slider-thumb {
        transform: scale(1.1);
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2);
    }

    input[type="range"]:focus::-moz-range-thumb {
        transform: scale(1.1);
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2);
    }

    input[type="range"]:focus {
        outline: none;
    }

    .step-count {
        font-family: monospace;
        font-size: 0.9rem;
        color: #4b5563;
        min-width: 70px;
        text-align: right;
    }

    .info {
        display: flex;
        align-items: center;
        min-width: 100px;
        justify-content: flex-end;
    }

    .phase-badge {
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 0.75rem;
        text-transform: uppercase;
        font-weight: 600;
        cursor: help;
        transition: all 0.2s;
    }

    .phase-badge:hover {
        transform: scale(1.05);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    /* Phase-specific colors */
    .phase-badge.phase-init {
        background: #e5e7eb;
        color: #374151;
        border: 1px solid #d1d5db;
    }

    .phase-badge.phase-read-batch {
        background: #fef9e7;
        color: #92400e;
        border: 1px solid #fcd34d;
    }

    .phase-badge.phase-read {
        background: #fef3c7;
        color: #854d0e;
        border: 1px solid #fbbf24;
    }

    .phase-badge.phase-write {
        background: #fecaca;
        color: #991b1b;
        border: 1px solid #f87171;
    }

    .phase-badge.phase-compact {
        background: #fed7aa;
        color: #c2410c;
        border: 1px solid #fb923c;
    }

    .phase-badge.phase-repair {
        background: #dbeafe;
        color: #1e40af;
        border: 1px solid #60a5fa;
    }

    .phase-badge.phase-done {
        background: #d1fae5;
        color: #065f46;
        border: 1px solid #10b981;
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
        background: #3b82f6;
        border-color: #3b82f6;
        color: white;
    }

    .btn.primary:hover:not(:disabled) {
        background: #2563eb;
        border-color: #2563eb;
    }
</style>
