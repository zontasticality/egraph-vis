<script lang="ts">
	import { currentState } from "../stores/timelineStore";
	import ENode from "./ENode.svelte";
	import type { EClassViewModel } from "../engine/types";

	// Helper to get hashcons entries from state
	$: hashconsEntries = $currentState?.nodeChunks
		? $currentState.nodeChunks.flat().map((node, id) => ({ id, node }))
		: [];

	// Optimization: The above flat() is expensive (O(N)).
	// Since nodeChunks is chunked, we can iterate chunks.
	// But for the UI list we need a flat array or we can iterate chunks in the template.
	// Let's iterate chunks in template to avoid copy.
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
		<div class="scroll-container">
			<!-- 1. Hashcons View -->
			<section>
				<h3>
					Hashcons ({$currentState.nodeChunks.reduce(
						(acc, c) => acc + c.length,
						0,
					)})
				</h3>
				<div class="hashcons-list">
					{#each $currentState.nodeChunks as chunk, chunkIndex}
						{#each chunk as node, nodeIndex}
							{@const id = chunkIndex * 1024 + nodeIndex}
							<div class="hashcons-row">
								<ENode {id} mode="symbol" />
								<span class="arrow">→</span>
								<ENode {id} mode="id" />
							</div>
						{/each}
					{/each}
				</div>
			</section>

			<hr />

			<!-- 2. E-Classes View -->
			<section>
				<h3>E-Classes ({$currentState.eclasses.length})</h3>
				<div class="eclass-list">
					{#each [...sets.entries()] as [canonicalId, eclasses]}
						<div class="set-group">
							<div class="set-header">
								<span class="set-label">Set</span>
								<ENode id={canonicalId} mode="id" />
							</div>
							<div class="set-body">
								{#each eclasses as eclass}
									{@const isCanonical =
										eclass.id === canonicalId}
									<div
										class="eclass-card"
										class:merged={!isCanonical}
									>
										<div class="card-header">
											<div class="header-left">
												<ENode
													id={eclass.id}
													mode="id"
												/>
												{#if !isCanonical}
													<span class="badge merged"
														>Merged</span
													>
												{/if}
											</div>
											{#if eclass.inWorklist}
												<span class="badge dirty"
													>Dirty</span
												>
											{/if}
										</div>
										<div class="card-body">
											{#each eclass.nodes as node}
												<div class="node-row">
													<span class="op"
														>{node.op}</span
													>
													<span class="args">
														{#if node.args.length > 0}
															<span class="paren"
																>(</span
															>
															{#each node.args as argId, i}
																<ENode
																	id={argId}
																	mode="id"
																/>
																{#if i < node.args.length - 1}<span
																		class="comma"
																		>,</span
																	>{/if}
															{/each}
															<span class="paren"
																>)</span
															>
														{/if}
													</span>
												</div>
											{/each}
										</div>
										{#if eclass.parents.length > 0}
											<div class="card-footer">
												<span class="label"
													>Parents:</span
												>
												{#each eclass.parents as parent}
													<div class="parent-ref">
														<span class="op"
															>{parent.op}</span
														>
														<ENode
															id={parent.parentId}
															mode="id"
														/>
													</div>
												{/each}
											</div>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</section>

			<hr />

			<!-- 3. Worklist View -->
			<section>
				<h3>Worklist ({$currentState.worklist.length})</h3>
				<div class="worklist">
					{#if $currentState.worklist.length === 0}
						<span class="empty-text">Empty</span>
					{:else}
						{#each $currentState.worklist as id}
							<div class="worklist-item">
								<ENode {id} mode="id" />
							</div>
						{/each}
					{/if}
				</div>
			</section>
		</div>
	{/if}
</div>

<style>
	.state-pane {
		height: 100%;
		background: white;
		border-left: 1px solid #e5e7eb;
		display: flex;
		flex-direction: column;
	}

	.scroll-container {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}

	section {
		margin-bottom: 2rem;
	}

	h3 {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #6b7280;
		margin-bottom: 1rem;
		font-weight: 600;
	}

	hr {
		border: 0;
		border-top: 1px solid #e5e7eb;
		margin: 2rem 0;
	}

	/* Hashcons */
	.hashcons-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	.hashcons-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.arrow {
		color: #9ca3af;
	}

	/* E-Classes */
	.eclass-list {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.set-group {
		border: 1px dashed #cbd5e1;
		border-radius: 12px;
		padding: 1rem;
		background: #f8fafc;
	}

	.set-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		font-weight: 600;
		color: #475569;
	}

	.set-label {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.set-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.eclass-card {
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 0.75rem;
		background: #fff;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}

	/* Merged (Non-Canonical) Styling */
	.eclass-card.merged {
		border-color: #fca5a5; /* Red 300 */
		background: #fef2f2; /* Red 50 */
	}

	.eclass-card.merged .card-header {
		border-bottom-color: #fee2e2;
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid #f3f4f6;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.badge.dirty {
		background: #fee2e2;
		color: #991b1b;
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: 4px;
		text-transform: uppercase;
		font-weight: bold;
	}

	.badge.merged {
		background: #fee2e2;
		color: #dc2626;
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: 4px;
		text-transform: uppercase;
		font-weight: bold;
	}

	.card-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.node-row {
		font-family: monospace;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.op {
		font-weight: bold;
		color: #374151;
	}
	.paren,
	.comma {
		color: #9ca3af;
	}
	.args {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.card-footer {
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid #f3f4f6;
		font-size: 0.85rem;
		color: #6b7280;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.parent-ref {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: #f9fafb;
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid #e5e7eb;
	}

	/* Worklist */
	.worklist {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.worklist-item {
		/* No extra styling needed, ENode handles it */
	}

	.empty-text {
		color: #9ca3af;
		font-style: italic;
		font-size: 0.9rem;
	}

	.empty {
		text-align: center;
		color: #9ca3af;
		margin-top: 2rem;
	}
</style>
