<script lang="ts">
	import { SvelteFlow, Background, Controls } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';

	// Initial empty nodes and edges
	let nodes = $state([]);
	let edges = $state([]);
</script>

<div class="graph-pane">
	<div class="pane-header">
		<h2>Graph Pane</h2>
	</div>
	<div class="flow-container">
		<SvelteFlow {nodes} {edges}>
			<Background />
			<Controls />
		</SvelteFlow>
	</div>
</div>

<style>
	.graph-pane {
		height: 100%;
		display: flex;
		flex-direction: column;
		background-color: #fafafa;
	}

	.pane-header {
		padding: 1rem;
		border-bottom: 1px solid #e0e0e0;
		background-color: #fff;
	}

	.pane-header h2 {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 600;
	}

	.flow-container {
		flex: 1;
		position: relative;
	}
</style>
