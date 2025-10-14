<script lang="ts">
	// Placeholder for e-class map data
	// Maps canonical e-node IDs to their e-classes
	let eclassMap = $state<Map<number, any>>(new Map());
</script>

<div class="eclass-map-view">
	{#if eclassMap.size === 0}
		<p class="empty-state">No e-classes yet</p>
	{:else}
		<div class="eclass-list">
			{#each [...eclassMap.entries()] as [id, eclass]}
				<div class="eclass-entry">
					<div class="canonical-id">
						<span class="id-badge">{id}</span>
						<span class="star">★</span>
					</div>
					<div class="eclass-nodes">
						{#each eclass.nodes as node}
							<div class="enode">{node.op}{node.args.length > 0 ? `(${node.args.join(', ')})` : ''}</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.eclass-map-view {
		min-height: 100px;
	}

	.empty-state {
		color: #999;
		font-style: italic;
		text-align: center;
		padding: 2rem;
	}

	.eclass-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.eclass-entry {
		border: 2px dashed #999;
		border-radius: 6px;
		padding: 0.75rem;
		background-color: #fafafa;
	}

	.canonical-id {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
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

	.eclass-nodes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.enode {
		background-color: white;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-family: 'Courier New', monospace;
	}
</style>
