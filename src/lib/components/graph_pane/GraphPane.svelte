<script lang="ts">
	import { layoutVersion } from "../../stores/timelineStore";
	import { layoutManager } from "../../engine/layout";
	import GraphCanvas from "./GraphCanvas.svelte";
	import RewriteRulesPanel from "./RewriteRulesPanel.svelte";

	// Edge routing follows the layout settings (re-read whenever layouts change)
	const edgeRouting = (_version: number) => layoutManager.getConfig().edgeRouting;
	$: routing = edgeRouting($layoutVersion);
</script>

<div class="graph-pane">
	<div class="canvas-area">
		<GraphCanvas {routing} />
	</div>
	<RewriteRulesPanel />
</div>

<style>
	.graph-pane {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
	}

	.canvas-area {
		position: relative;
		flex: 1;
		min-height: 0;
	}
</style>
