<div class="pane-group">
    <slot />
</div>

<style>
    .pane-group {
        display: grid;
        grid-template-columns: 1fr 400px; /* Graph takes remaining space, State takes fixed width */
        grid-template-rows: 1fr;
        height: 100%;
        width: 100%;
        overflow: hidden;
        background-color: #f9fafb; /* Light gray background */
    }

    /* Responsive: Stack on small screens */
    @media (max-width: 768px) {
        .pane-group {
            grid-template-columns: 1fr;
            grid-template-rows: 1fr 1fr;
        }
    }
</style>
