<script lang="ts">
    import { isPlaying, togglePlay, nextStep, prevStep, goToStep, currentIndex, timeline, progress } from '../stores/timelineStore';
    
    $: current = $currentIndex;
    $: total = $timeline ? $timeline.states.length : 0;
    $: max = Math.max(0, total - 1);
</script>

<div class="controller">
    <div class="controls-left">
        <button class="btn" on:click={prevStep} disabled={current === 0 || total === 0}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>
        </button>
        
        <button class="btn primary" on:click={togglePlay} disabled={total === 0}>
            {#if $isPlaying}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
            {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            {/if}
        </button>

        <button class="btn" on:click={nextStep} disabled={current >= max || total === 0}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>
        </button>
    </div>

    <div class="slider-container">
        <input 
            type="range" 
            min="0" 
            max={max} 
            value={current} 
            on:input={(e) => goToStep(parseInt(e.currentTarget.value))}
            disabled={total === 0}
        />
    </div>

    <div class="info">
        <span class="step-count">{current} / {max}</span>
        {#if $timeline}
            <span class="phase-badge {$timeline.states[current]?.phase}">
                {$timeline.states[current]?.phase}
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
        transition: all 0.2s;
    }

    .btn:hover:not(:disabled) {
        background: #f3f4f6;
        border-color: #9ca3af;
    }

    .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .btn.primary {
        background: #2563eb;
        border-color: #2563eb;
        color: white;
    }

    .btn.primary:hover:not(:disabled) {
        background: #1d4ed8;
    }

    .slider-container {
        flex: 1;
        display: flex;
        align-items: center;
    }

    input[type="range"] {
        width: 100%;
        cursor: pointer;
    }

    .info {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-family: monospace;
        font-size: 0.9rem;
        color: #4b5563;
        min-width: 120px;
        justify-content: flex-end;
    }

    .phase-badge {
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.75rem;
        text-transform: uppercase;
        font-weight: bold;
    }

    .phase-badge.init { background: #e5e7eb; color: #374151; }
    .phase-badge.read { background: #dbeafe; color: #1e40af; }
    .phase-badge.write { background: #fce7f3; color: #9d174d; }
    .phase-badge.rebuild { background: #fef3c7; color: #92400e; }
    .phase-badge.done { background: #d1fae5; color: #065f46; }
</style>
