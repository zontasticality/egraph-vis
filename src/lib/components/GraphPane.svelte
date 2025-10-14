<script lang="ts">
	import { SvelteFlow, Background, Controls } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';

	// Initial empty nodes and edges
	let nodes = $state([]);
	let edges = $state([]);
</script>

<div class="graph-pane">
	<SvelteFlow {nodes} {edges}>
		<Background />
		<Controls />
	</SvelteFlow>
</div>

<style>
	.graph-pane {
		height: 100%;
		position: relative;
		background-color: #fafafa;
	}
</style>
