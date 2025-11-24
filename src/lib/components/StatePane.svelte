<script lang="ts">
	import { currentState } from "../stores/timelineStore";
	import ENode from "./ENode.svelte";

	// Helper to get hashcons entries from state
	$: hashconsEntries = $currentState?.nodeChunks
		? $currentState.nodeChunks.flat().map((node, id) => ({ id, node }))
		: [];

	// Optimization: The above flat() is expensive (O(N)).
	// Since nodeChunks is chunked, we can iterate chunks.
	// But for the UI list we need a flat array or we can iterate chunks in the template.
	// Let's iterate chunks in template to avoid copy.
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
					{#each $currentState.eclasses as eclass}
						<div class="eclass-card">
							<div class="card-header">
								<ENode id={eclass.id} mode="id" />
								{#if eclass.inWorklist}
									<span class="badge dirty">Dirty</span>
								{/if}
							</div>
							<div class="card-body">
								{#each eclass.nodes as node}
									<!-- We need the ID of this specific node to render it as a symbol properly 
                                         if we want to use the ENode component's symbol mode lookup.
                                         However, eclass.nodes only contains {op, args}, not the original ID.
                                         The ENode component in 'symbol' mode looks up by ID.
                                         
                                         PROBLEM: We don't have the original ID of the nodes inside the E-Class here.
                                         The EGraphState.eclasses view model just has the structure.
                                         
                                         SOLUTION: We should probably update EClassViewModel to include the original ID of the nodes?
                                         OR we can just render the structure manually using ENode for args.
                                         
                                         Let's use ENode for args (ID mode) and render the op manually here, 
                                         since ENode component expects an ID for symbol lookup.
                                         Unless we allow passing `node` prop to ENode component?
                                         
                                         Wait, I removed the `node` prop from the spec in favor of ID lookup.
                                         But here we have the structure but not the ID.
                                         
                                         Actually, if we want to highlight the *specific* node in the Hashcons view when hovering this,
                                         we need its ID.
                                         
                                         So `EClassViewModel` should probably store `{ id, op, args }`.
                                         Let's check types.ts.
                                         
                                         Current types.ts:
                                         nodes: Array<{ op: string; args: number[] }>;
                                         
                                         I should update types.ts to include `id` in `nodes`.
                                         For now, I will render it manually to unblock, but I'll add a TODO.
                                    -->
									<div class="node-row">
										<span class="op">{node.op}</span>
										<span class="args">
											{#if node.args.length > 0}
												<span class="paren">(</span>
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
												<span class="paren">)</span>
											{/if}
										</span>
									</div>
								{/each}
							</div>
							{#if eclass.parents.length > 0}
								<div class="card-footer">
									<span class="label">Parents:</span>
									{#each eclass.parents as parent}
										<div class="parent-ref">
											<span class="op">{parent.op}</span>
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
		gap: 1rem;
	}

	.eclass-card {
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 0.75rem;
		background: #fff;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid #f3f4f6;
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

	.empty {
		text-align: center;
		color: #9ca3af;
		margin-top: 2rem;
	}
</style>
