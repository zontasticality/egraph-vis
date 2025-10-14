<script lang="ts">
	// Import section components
	import HashconsView from "./state-sections/HashconsView.svelte";
	import EClassMapView from "./state-sections/EClassMapView.svelte";
	import UnionFindView from "./state-sections/UnionFindView.svelte";
	import WorklistView from "./state-sections/WorklistView.svelte";
</script>

<div class="state-pane">
	<div class="pane-header">
		<h2>State Pane</h2>
	</div>
	<div class="scrollable-content">
		<!-- Hashcons Section -->
		<h3 class="section-title">Hashcons</h3>
		<section class="state-section">
			<HashconsView />
		</section>

		<!-- E-class Map Section -->
		<h3 class="section-title">E-class Map</h3>
		<section class="state-section">
			<EClassMapView />
		</section>

		<!-- Union-Find Section -->
		<h3 class="section-title">Union-Find</h3>
		<section class="state-section">
			<UnionFindView />
		</section>

		<!-- Worklist Section -->
		<h3 class="section-title">Worklist</h3>
		<section class="state-section">
			<WorklistView />
		</section>
	</div>
</div>

<style>
	.state-pane {
		height: 100%;
		display: flex;
		flex-direction: column;
		background-color: #f5f5f5;
	}

	.pane-header {
		padding: 0.9rem;
		border-bottom: 1px solid #e0e0e0;
		background-color: #fff;
	}

	.pane-header h2 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.scrollable-content {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}

	.state-section {
		margin-bottom: 2rem;
		background-color: #fff;
		border-radius: 8px;
		border: 1px solid #e0e0e0;
		padding: 1rem;
	}

	.section-title {
		margin: 0 0 1rem 0;
		font-size: 1rem;
		font-weight: 600;
		color: #333;
		border-bottom: 2px solid #4caf50;
		padding-bottom: 0.5rem;
	}
</style>
