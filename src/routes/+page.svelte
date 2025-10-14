<script lang="ts">
	import { PaneGroup, Pane, PaneResizer } from 'paneforge';

	// Import the pane components
	import GraphPane from '$lib/components/GraphPane.svelte';
	import StatePane from '$lib/components/StatePane.svelte';
</script>

<div class="app-container">
	<header class="global-header">
		<div class="header-section">
			<h1>E-Graph Visualizer</h1>
		</div>
		<div class="header-section">
			<span class="pane-label">Graph View</span>
		</div>
		<div class="header-section">
			<span class="pane-label">State View</span>
		</div>
	</header>

	<div class="panes-container">
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
</div>

<style>
	.app-container {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.global-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background-color: #fff;
		border-bottom: 1px solid #e0e0e0;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.global-header h1 {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
		color: #333;
	}

	.header-section {
		flex: 1;
	}

	.header-section:first-child {
		flex: 0 0 auto;
	}

	.pane-label {
		font-size: 0.9rem;
		font-weight: 500;
		color: #666;
	}

	.panes-container {
		flex: 1;
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
