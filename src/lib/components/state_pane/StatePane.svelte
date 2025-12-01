<script lang="ts">
	import { currentState } from "../../stores/timelineStore";
	import ENode from "./ENode.svelte";
	import type { EClassViewModel } from "../../engine/types";

	// Group E-Classes by Canonical ID for the view
	$: sets = (() => {
		const map = new Map<number, EClassViewModel[]>();
		if (!$currentState) return map;

		for (const eclass of $currentState.eclasses) {
			const canonicalId =
				$currentState.unionFind[eclass.id]?.canonical ?? eclass.id;
			if (!map.has(canonicalId)) {
				map.set(canonicalId, []);
			}
			map.get(canonicalId)!.push(eclass);
		}
		return map;
	})();
</script>

<div class="state-pane">
	{#if !$currentState}
		<div class="empty">No state loaded</div>
	{:else}
		<!-- 3-Panel Layout -->
		<div class="panel-grid">
			<!-- Panel 1: Hashcons -->
			<div class="panel">
				<div class="panel-header">
					<h3>
						Hashcons ({$currentState.nodeChunks.reduce(
							(acc, c) => acc + c.length,
							0,
						)})
					</h3>
				</div>
				<div class="panel-body">
					{#each $currentState.nodeChunks as chunk, chunkIndex}
						{#each chunk as node, nodeIndex}
							{@const id = chunkIndex * 1024 + nodeIndex}
							<div class="list-item">
								<ENode {id} mode="symbol" />
								<span class="arrow">→</span>
								<ENode {id} mode="id" />
							</div>
						{/each}
					{/each}
				</div>
			</div>

			<!-- Panel 2: E-Classes -->
			<div class="panel">
				<div class="panel-header">
					<h3>E-Classes ({$currentState.eclasses.length})</h3>
				</div>
				<div class="panel-body">
					{#if $currentState.implementation === "deferred"}
						<!-- Deferred mode: Group by sets -->
						{#each [...sets.entries()] as [canonicalId, eclasses]}
							<div class="set-block">
								<div class="set-title">
									Set <ENode id={canonicalId} mode="id" />
								</div>
								{#each eclasses as eclass}
									{@const isCanonical =
										eclass.id === canonicalId}
									<div
										class="eclass-row"
										class:merged={!isCanonical}
									>
										<div class="eclass-id">
											<ENode id={eclass.id} mode="id" />
											{#if !isCanonical}
												<span class="badge">M</span>
											{/if}
										</div>
										<div class="eclass-nodes">
											→ [
											{#each eclass.nodes as node, idx}
												<ENode
													id={node.id}
													mode="symbol"
												/>{#if idx < eclass.nodes.length - 1},{/if}
											{/each}
											]
										</div>
									</div>
								{/each}
							</div>
						{/each}
					{:else}
						<!-- Naive mode: Flat list -->
						{#each $currentState.eclasses as eclass}
							<div class="eclass-row">
								<div class="eclass-id">
									<ENode id={eclass.id} mode="id" />
								</div>
								<div class="eclass-nodes">
									→ [
									{#each eclass.nodes as node, idx}
										<ENode
											id={node.id}
											mode="symbol"
										/>{#if idx < eclass.nodes.length - 1},{/if}
									{/each}
									]
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</div>

			<!-- Panel 3: Worklist -->
			<div class="panel">
				<div class="panel-header">
					<h3>Worklist ({$currentState.worklist.length})</h3>
				</div>
				<div class="panel-body">
					{#if $currentState.worklist.length === 0}
						<div class="empty-message">No items in worklist</div>
					{:else}
						{#each $currentState.worklist as eclassId}
							<div class="worklist-item">
								<ENode id={eclassId} mode="id" />
							</div>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.state-pane {
		height: 100%;
		width: 100%;
		background: var(--surface-color, #ffffff);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--text-muted, #666);
		font-size: 14px;
	}

	/* 3-Panel Grid Layout */
	.panel-grid {
		display: grid;
		grid-template-rows: 1fr 1fr 1fr;
		height: 100%;
		gap: 0;
		border-top: 1px solid var(--border-color, #e5e7eb);
	}

	.panel {
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--border-color, #e5e7eb);
		overflow: hidden;
		min-height: 0; /* Important for flex children to shrink */
	}

	.panel:last-child {
		border-bottom: none;
	}

	.panel-header {
		padding: 8px 12px;
		background: var(--surface-2, #f9fafb);
		border-bottom: 1px solid var(--border-color, #e5e7eb);
		flex-shrink: 0;
	}

	.panel-header h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary, #111827);
	}

	.panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 4px;
		min-height: 0; /* Important for scrolling */
	}

	/* Compact List Items */
	.list-item,
	.eclass-row,
	.worklist-item {
		padding: 4px 8px;
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 6px;
		border-bottom: 1px solid var(--border-light, #f3f4f6);
	}

	.list-item:hover,
	.eclass-row:hover,
	.worklist-item:hover {
		background: var(--surface-hover, #f9fafb);
	}

	.arrow {
		color: var(--text-muted, #9ca3af);
		font-size: 11px;
	}

	/* Set Grouping (Deferred Mode) */
	.set-block {
		margin-bottom: 8px;
	}

	.set-title {
		padding: 6px 8px;
		background: var(--surface-2, #f3f4f6);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-secondary, #6b7280);
		border-top: 1px solid var(--border-color, #e5e7eb);
		border-bottom: 1px solid var(--border-color, #e5e7eb);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.eclass-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.eclass-row.merged {
		background: rgba(239, 68, 68, 0.05);
		border-left: 3px solid #ef4444;
	}

	.eclass-id {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.eclass-nodes {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-secondary, #6b7280);
		overflow-x: auto;
		white-space: nowrap;
	}

	.badge {
		font-size: 10px;
		padding: 2px 4px;
		border-radius: 3px;
		background: #ef4444;
		color: white;
		font-weight: 600;
	}

	.empty-message {
		padding: 16px 8px;
		text-align: center;
		color: var(--text-muted, #9ca3af);
		font-size: 12px;
		font-style: italic;
	}

	/* Scrollbar Styling */
	.panel-body::-webkit-scrollbar {
		width: 6px;
	}

	.panel-body::-webkit-scrollbar-track {
		background: transparent;
	}

	.panel-body::-webkit-scrollbar-thumb {
		background: var(--scrollbar-thumb, #d1d5db);
		border-radius: 3px;
	}

	.panel-body::-webkit-scrollbar-thumb:hover {
		background: var(--scrollbar-thumb-hover, #9ca3af);
	}
</style>
