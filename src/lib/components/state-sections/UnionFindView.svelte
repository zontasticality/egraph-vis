<script lang="ts">
	// Placeholder for union-find data
	// Shows which e-node IDs point to canonical IDs
	let unionFindData = $state<Map<number, number>>(new Map());
</script>

<div class="union-find-view">
	{#if unionFindData.size === 0}
		<p class="empty-state">No union-find entries yet</p>
	{:else}
		<div class="union-find-list">
			{#each [...unionFindData.entries()] as [id, canonicalId]}
				<div class="union-find-entry">
					<div class="enode-id">{id}</div>
					<div class="arrow">→</div>
					<div class="canonical-id">
						<span class="id-badge">{canonicalId}</span>
						<span class="star">★</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.union-find-view {
		min-height: 100px;
	}

	.empty-state {
		color: #999;
		font-style: italic;
		text-align: center;
		padding: 2rem;
	}

	.union-find-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.union-find-entry {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border-radius: 4px;
		background-color: #f9f9f9;
	}

	.enode-id {
		background-color: #e3f2fd;
		border: 1px solid #90caf9;
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-family: 'Courier New', monospace;
		font-weight: bold;
	}

	.arrow {
		color: #666;
	}

	.canonical-id {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.id-badge {
		background-color: #ffd54f;
		border: 2px solid #ffb300;
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-family: 'Courier New', monospace;
		font-weight: bold;
	}

	.star {
		color: #ffb300;
		font-size: 0.8rem;
	}
</style>
