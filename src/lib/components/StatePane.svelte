<script lang="ts">
	import { currentState } from "../stores/timelineStore";

	// Simple tabs
	let activeTab = "eclasses";
</script>

<div class="state-pane">
	<div class="tabs">
		<button
			class:active={activeTab === "eclasses"}
			on:click={() => (activeTab = "eclasses")}>E-Classes</button
		>
		<button
			class:active={activeTab === "unionfind"}
			on:click={() => (activeTab = "unionfind")}>Union-Find</button
		>
		<button
			class:active={activeTab === "worklist"}
			on:click={() => (activeTab = "worklist")}>Worklist</button
		>
	</div>

	<div class="content">
		{#if !$currentState}
			<div class="empty">No state loaded</div>
		{:else}
			{#if activeTab === "eclasses"}
				<div class="section">
					<h3>E-Classes ({$currentState.eclasses.length})</h3>
					<div class="list">
						{#each $currentState.eclasses as eclass}
							<div class="item">
								<div class="header">
									<span class="id">ID: {eclass.id}</span>
									{#if eclass.inWorklist}
										<span class="badge">Dirty</span>
									{/if}
								</div>
								<div class="nodes">
									{#each eclass.nodes as node}
										<div class="node">
											<span class="op">{node.op}</span>
											<span class="args"
												>({node.args.join(", ")})</span
											>
										</div>
									{/each}
								</div>
								{#if eclass.parents.length > 0}
									<div class="parents">
										<span class="label">Parents:</span>
										{#each eclass.parents as parent}
											<span class="parent-ref"
												>{parent.op} (ID: {parent.parentId})</span
											>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if activeTab === "unionfind"}
				<div class="section">
					<h3>Union-Find</h3>
					<table class="data-table">
						<thead>
							<tr>
								<th>ID</th>
								<th>Canonical</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{#each $currentState.unionFind as entry}
								<tr class:canonical={entry.isCanonical}>
									<td>{entry.id}</td>
									<td>{entry.canonical}</td>
									<td
										>{entry.isCanonical
											? "Representative"
											: "Merged"}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if activeTab === "worklist"}
				<div class="section">
					<h3>Worklist ({$currentState.worklist.length})</h3>
					<div class="list">
						{#if $currentState.worklist.length === 0}
							<div class="empty-list">Empty</div>
						{:else}
							{#each $currentState.worklist as id}
								<div class="item simple">
									<span class="id">Class {id}</span>
								</div>
							{/each}
						{/if}
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.state-pane {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: white;
		border-left: 1px solid #e5e7eb;
	}

	.tabs {
		display: flex;
		border-bottom: 1px solid #e5e7eb;
		background: #f9fafb;
	}

	.tabs button {
		flex: 1;
		padding: 0.75rem;
		border: none;
		background: none;
		cursor: pointer;
		font-size: 0.9rem;
		color: #6b7280;
		border-bottom: 2px solid transparent;
	}

	.tabs button.active {
		color: #2563eb;
		border-bottom-color: #2563eb;
		background: white;
		font-weight: 500;
	}

	.content {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}

	.section h3 {
		margin-top: 0;
		font-size: 1rem;
		color: #374151;
		margin-bottom: 1rem;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.item {
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		padding: 0.75rem;
		background: #fff;
	}

	.item.simple {
		padding: 0.5rem;
	}

	.header {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.id {
		font-weight: bold;
		color: #1f2937;
	}

	.badge {
		background: #fee2e2;
		color: #991b1b;
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: 4px;
		text-transform: uppercase;
	}

	.node {
		font-family: monospace;
		background: #f3f4f6;
		padding: 2px 6px;
		border-radius: 4px;
		margin-bottom: 4px;
		display: inline-block;
		margin-right: 4px;
	}

	.parents {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: #6b7280;
	}

	.parent-ref {
		background: #f0fdf4;
		color: #166534;
		padding: 1px 4px;
		border-radius: 3px;
		margin-left: 4px;
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	.data-table th,
	.data-table td {
		text-align: left;
		padding: 0.5rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.data-table th {
		color: #6b7280;
		font-weight: 500;
	}

	.data-table tr.canonical {
		background: #f0fdfa;
	}

	.empty {
		text-align: center;
		color: #9ca3af;
		margin-top: 2rem;
	}
</style>
