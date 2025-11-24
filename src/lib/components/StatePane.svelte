<script lang="ts">
	import { currentState } from "../stores/timelineStore";
	import { interactionStore } from "../stores/interactionStore";
	import { getColorForId, getLightColorForId } from "../utils/colors";

	// Simple tabs
	let activeTab = "eclasses";

	// Interaction helpers
	function selectEClass(id: number | string) {
		interactionStore.select({ type: "eclass", id });
	}

	function hoverEClass(id: number | string) {
		interactionStore.hover({ type: "eclass", id });
	}

	function clearHover() {
		interactionStore.clearHover();
	}

	// Helper to check if an item is selected or hovered
	$: isSelected = (id: number | string) =>
		$interactionStore.selection?.type === "eclass" &&
		$interactionStore.selection.id === id;

	$: isHovered = (id: number | string) =>
		$interactionStore.hover?.type === "eclass" &&
		$interactionStore.hover.id === id;
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
							<!-- svelte-ignore a11y-click-events-have-key-events -->
							<div
								class="item"
								class:selected={isSelected(eclass.id)}
								class:hovered={isHovered(eclass.id)}
								on:click={() => selectEClass(eclass.id)}
								on:mouseenter={() => hoverEClass(eclass.id)}
								on:mouseleave={clearHover}
								role="button"
								tabindex="0"
								style="border-left-color: {getColorForId(
									eclass.id,
								)}; border-left-width: 4px;"
							>
								<div class="header">
									<div class="id-group">
										<div
											class="diamond-indicator"
											style="background-color: {getColorForId(
												eclass.id,
											)}"
										></div>
										<span class="id">ID: {eclass.id}</span>
									</div>
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
								<tr
									class:canonical={entry.isCanonical}
									class:selected={isSelected(entry.id)}
									class:hovered={isHovered(entry.id)}
									on:click={() => selectEClass(entry.id)}
									on:mouseenter={() => hoverEClass(entry.id)}
									on:mouseleave={clearHover}
									style="cursor: pointer;"
								>
									<td>
										<span
											class="id-pill"
											style="background-color: {getLightColorForId(
												entry.id,
											)}; color: {getColorForId(
												entry.id,
											)}"
										>
											{entry.id}
										</span>
									</td>
									<td>
										<span
											class="id-pill"
											style="background-color: {getLightColorForId(
												entry.canonical,
											)}; color: {getColorForId(
												entry.canonical,
											)}"
										>
											{entry.canonical}
										</span>
									</td>
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
								<!-- svelte-ignore a11y-click-events-have-key-events -->
								<div
									class="item simple"
									class:selected={isSelected(id)}
									class:hovered={isHovered(id)}
									on:click={() => selectEClass(id)}
									on:mouseenter={() => hoverEClass(id)}
									on:mouseleave={clearHover}
									role="button"
									tabindex="0"
									style="border-left-color: {getColorForId(
										id,
									)}; border-left-width: 4px;"
								>
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
		cursor: pointer;
		transition: all 0.2s;
	}

	.item:hover {
		border-color: #93c5fd;
	}

	.item.selected {
		border-color: #2563eb;
		background: #eff6ff;
		box-shadow: 0 0 0 1px #2563eb;
	}

	.item.hovered {
		border-color: #60a5fa;
		background: #f0f9ff;
	}

	.item.simple {
		padding: 0.5rem;
	}

	.header {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.5rem;
		align-items: center;
	}

	.id-group {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.diamond-indicator {
		width: 10px;
		height: 10px;
		transform: rotate(45deg);
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

	.data-table tr.selected {
		background: #eff6ff;
	}

	.data-table tr.hovered {
		background: #f0f9ff;
	}

	.id-pill {
		padding: 2px 6px;
		border-radius: 999px;
		font-weight: 600;
		font-size: 0.85rem;
	}

	.empty {
		text-align: center;
		color: #9ca3af;
		margin-top: 2rem;
	}
</style>
