<script lang="ts">
    import { createEventDispatcher, onMount, tick } from "svelte";

    /** id of the element that labels the dialog (usually its heading). */
    export let labelledby: string;
    export let maxWidth = "480px";

    const dispatch = createEventDispatcher<{ close: void }>();
    let panel: HTMLDivElement;

    const FOCUSABLE =
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

    onMount(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        tick().then(() => {
            const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
            (first ?? panel)?.focus();
        });
        return () => previouslyFocused?.focus?.();
    });

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            dispatch("close");
        } else if (e.key === "Tab") {
            // Keep focus inside the dialog
            const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }
</script>

<div class="modal-backdrop">
    <button
        class="backdrop-hit"
        tabindex="-1"
        aria-label="Close dialog"
        on:click={() => dispatch("close")}
    ></button>
    <div
        class="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledby}
        tabindex="-1"
        style:max-width={maxWidth}
        bind:this={panel}
        on:keydown={handleKeydown}
    >
        <slot />
    </div>
</div>

<style>
    .modal-backdrop {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1200;
        padding: 16px;
    }

    .backdrop-hit {
        position: absolute;
        inset: 0;
        border: none;
        padding: 0;
        margin: 0;
        background: rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(2px);
        cursor: default;
    }

    .modal-panel {
        position: relative;
        width: 100%;
        background: white;
        padding: 24px;
        border-radius: 12px;
        box-shadow:
            0 20px 25px -5px rgba(0, 0, 0, 0.15),
            0 10px 10px -5px rgba(0, 0, 0, 0.05);
        outline: none;
        animation: pop 0.14s ease-out;
    }

    @keyframes pop {
        from {
            transform: translateY(4px) scale(0.98);
            opacity: 0;
        }
    }
</style>
