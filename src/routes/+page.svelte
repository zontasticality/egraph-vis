<script lang="ts">
	import { PaneGroup, Pane, PaneResizer } from 'paneforge';

	// Import the pane components
	import GraphPane from '$lib/components/GraphPane.svelte';
	import StatePane from '$lib/components/StatePane.svelte';
</script>

<div class="app-container">
	<PaneGroup direction="horizontal">
		<!-- Graph Pane (left side) -->
		<Pane defaultSize={60} minSize={30}>
			<GraphPane />
		</Pane>

		<PaneResizer class="resizer" />

		<!-- State Pane (right side) -->
		<Pane defaultSize={40} minSize={20}>
			<StatePane />
		</Pane>
	</PaneGroup>
</div>

<style>
	.app-container {
		width: 100vw;
		height: 100vh;
		overflow: hidden;
	}

	:global(.resizer) {
		width: 4px;
		background-color: #e0e0e0;
		cursor: col-resize;
		transition: background-color 0.2s;
	}

	:global(.resizer:hover) {
		background-color: #b0b0b0;
	}
</style>
