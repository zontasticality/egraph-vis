<script lang="ts">
	// Placeholder for worklist data
	// Shows e-classes that need congruence repair
	let worklist = $state<Set<number>>(new Set());
</script>

<div class="worklist-view">
	{#if worklist.size === 0}
		<p class="empty-state">Worklist is empty (invariants restored)</p>
	{:else}
		<div class="worklist-list">
			{#each [...worklist] as id}
				<div class="worklist-entry">
					<div class="eclass-id worklist-highlight">
						<span class="id-badge">{id}</span>
						<span class="star">★</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.worklist-view {
		min-height: 100px;
	}

	.empty-state {
		color: #4caf50;
		font-style: italic;
		text-align: center;
		padding: 2rem;
		background-color: #e8f5e9;
		border-radius: 4px;
	}

	.worklist-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.worklist-entry {
		padding: 0.25rem;
	}

	.eclass-id {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.worklist-highlight {
		animation: pulse 1.5s ease-in-out infinite;
	}

	.id-badge {
		background-color: #ffccbc;
		border: 2px solid #ff5722;
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-family: 'Courier New', monospace;
		font-weight: bold;
	}

	.star {
		color: #ff5722;
		font-size: 0.8rem;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.6;
		}
	}
</style>
