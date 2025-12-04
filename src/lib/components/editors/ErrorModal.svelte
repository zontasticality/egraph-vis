<script lang="ts">
    import { createEventDispatcher } from "svelte";

    export let title: string = "Error";
    export let errors: string[] = [];

    const dispatch = createEventDispatcher<{
        close: void;
    }>();
</script>

<div class="modal-backdrop" on:click={() => dispatch("close")}>
    <div class="modal-content" on:click|stopPropagation>
        <div class="icon-header">
            <div class="icon-bg">⚠️</div>
            <h3>{title}</h3>
        </div>

        <div class="error-list">
            {#each errors as error}
                <div class="error-item">{error}</div>
            {/each}
        </div>

        <div class="actions">
            <button class="btn-ok" on:click={() => dispatch("close")}>OK</button
            >
        </div>
    </div>
</div>

<style>
    .modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1200;
        backdrop-filter: blur(2px);
    }

    .modal-content {
        background: white;
        padding: 24px;
        border-radius: 12px;
        width: 100%;
        max-width: 400px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        text-align: center;
    }

    .icon-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-bottom: 16px;
    }

    .icon-bg {
        width: 48px;
        height: 48px;
        background: #fee2e2;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        margin-bottom: 12px;
    }

    h3 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
        color: #111827;
    }

    .error-list {
        text-align: left;
        background: #f9fafb;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        max-height: 200px;
        overflow-y: auto;
        margin-bottom: 20px;
    }

    .error-item {
        color: #ef4444;
        font-size: 0.9rem;
        margin-bottom: 4px;
        padding-left: 12px;
        position: relative;
    }

    .error-item::before {
        content: "•";
        position: absolute;
        left: 0;
        color: #ef4444;
    }

    .actions {
        display: flex;
        justify-content: center;
    }

    button {
        padding: 8px 24px;
        border-radius: 6px;
        font-weight: 500;
        font-size: 0.9rem;
        cursor: pointer;
        background: #3b82f6;
        border: 1px solid #3b82f6;
        color: white;
        transition: all 0.2s;
    }

    button:hover {
        background: #2563eb;
    }
</style>
