<script lang="ts">
	// Placeholder for hashcons data
	// This will map canonical e-nodes to their e-node IDs
	let hashcons = $state<Map<string, number>>(new Map());
</script>

<div class="hashcons-view">
	{#if hashcons.size === 0}
		<p class="empty-state">No hashcons entries yet</p>
	{:else}
		<div class="hashcons-list">
			{#each [...hashcons.entries()] as [enode, id]}
				<div class="hashcons-entry">
					<div class="enode">{enode}</div>
					<div class="arrow">→</div>
					<div class="enode-id">{id}</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.hashcons-view {
		min-height: 100px;
	}

	.empty-state {
		color: #999;
		font-style: italic;
		text-align: center;
		padding: 2rem;
	}

	.hashcons-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.hashcons-entry {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border-radius: 4px;
		background-color: #f9f9f9;
	}

	.enode {
		background-color: white;
		border: 1px solid #ddd;
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-family: 'Courier New', monospace;
	}

	.arrow {
		color: #666;
	}

	.enode-id {
		background-color: #e3f2fd;
		border: 1px solid #90caf9;
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-family: 'Courier New', monospace;
		font-weight: bold;
	}
</style>
