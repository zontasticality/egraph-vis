<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		type Node,
		type Edge,
		useSvelteFlow,
	} from "@xyflow/svelte";
	import "@xyflow/svelte/dist/style.css";
	import { writable } from "svelte/store";
	import { currentState } from "../stores/timelineStore";
	import ELK from "elkjs";
	import type { EGraphState } from "../engine/types";

	// --- State ---

	const nodes = writable<Node[]>([]);
	const edges = writable<Edge[]>([]);

	let elk: any;

	// --- Layout Logic ---

	async function updateLayout(state: EGraphState | null) {
		if (!elk) {
			elk = new ELK();
		}

		if (!state) {
			nodes.set([]);
			edges.set([]);
			return;
		}

		// 1. Convert EGraphState to ELK Graph
		// We want to group nodes by E-Class.
		// ELK supports hierarchical layout.

		const elkNodes: any[] = [];
		const elkEdges: any[] = [];

		// Map to track node dimensions (approximated for now)
		const nodeWidth = 150;
		const nodeHeight = 40;
		const clusterPadding = 20;

		// Create clusters for E-Classes
		for (const eclass of state.eclasses) {
			const children: any[] = [];

			eclass.nodes.forEach((enode, index) => {
				const nodeId = `node-${eclass.id}-${index}`;
				children.push({
					id: nodeId,
					width: nodeWidth,
					height: nodeHeight,
					labels: [{ text: `${enode.op}(${enode.args.join(", ")})` }],
					// Custom data for Svelte Flow
					data: {
						label: enode.op,
						args: enode.args,
						eclassId: eclass.id,
					},
				});
			});

			elkNodes.push({
				id: `class-${eclass.id}`,
				children: children,
				layoutOptions: {
					"elk.direction": "DOWN",
					"elk.padding": `[top=${clusterPadding},left=${clusterPadding},bottom=${clusterPadding},right=${clusterPadding}]`,
					"elk.spacing.nodeNode": "10",
				},
				labels: [{ text: `Class ${eclass.id}` }],
			});
		}

		// Create edges
		// Edges go from E-Node to E-Class (arguments)
		// But in the visual graph, we draw edge from E-Node to the target E-Class cluster.
		// ELK handles edges between hierarchical nodes.

		let edgeId = 0;
		for (const eclass of state.eclasses) {
			eclass.nodes.forEach((enode, nodeIndex) => {
				const sourceId = `node-${eclass.id}-${nodeIndex}`;

				enode.args.forEach((argClassId, argIndex) => {
					const targetId = `class-${argClassId}`;
					elkEdges.push({
						id: `edge-${edgeId++}`,
						sources: [sourceId],
						targets: [targetId],
						labels: [{ text: `${argIndex}` }],
					});
				});
			});
		}

		const graph = {
			id: "root",
			layoutOptions: {
				"elk.algorithm": "layered",
				"elk.direction": "DOWN",
				"elk.spacing.nodeNode": "40",
				"elk.layered.spacing.nodeNodeBetweenLayers": "40",
				// Interactive strategy for stability
				"elk.layered.crossingMinimization.strategy": "INTERACTIVE",
				"elk.layered.nodePlacement.strategy": "INTERACTIVE",
			},
			children: elkNodes,
			edges: elkEdges,
		};

		// 2. Run Layout
		try {
			const layoutedGraph = await elk.layout(graph);

			// 3. Convert back to Svelte Flow
			const newNodes: Node[] = [];
			const newEdges: Edge[] = [];

			// Helper to traverse and create nodes
			function traverse(node: any, parentId?: string) {
				// Is it a cluster (E-Class) or a leaf (E-Node)?
				// Our clusters start with 'class-'
				const isCluster = node.id.startsWith("class-");

				const flowNode: Node = {
					id: node.id,
					type: isCluster ? "group" : "default", // We might need custom types later
					position: { x: node.x, y: node.y },
					data: { label: node.labels?.[0]?.text || "" },
					style: `width: ${node.width}px; height: ${node.height}px;`,
					parentId: parentId,
					extent: isCluster ? "parent" : undefined,
				};

				// Style adjustments
				if (isCluster) {
					flowNode.style +=
						"background: rgba(240, 240, 240, 0.5); border: 1px dashed #999; border-radius: 8px;";
				} else {
					flowNode.style +=
						"background: white; border: 1px solid #333; border-radius: 4px; display: flex; align-items: center; justify-content: center;";
				}

				newNodes.push(flowNode);

				if (node.children) {
					node.children.forEach((child: any) =>
						traverse(child, node.id),
					);
				}
			}

			if (layoutedGraph.children) {
				layoutedGraph.children.forEach((child: any) => traverse(child));
			}

			if (layoutedGraph.edges) {
				layoutedGraph.edges.forEach((edge: any) => {
					newEdges.push({
						id: edge.id,
						source: edge.sources[0],
						target: edge.targets[0],
						type: "smoothstep",
						animated: false,
						label: edge.labels?.[0]?.text,
					});
				});
			}

			nodes.set(newNodes);
			edges.set(newEdges);
		} catch (err) {
			console.error("ELK Layout Error:", err);
		}
	}

	// React to state changes
	$: updateLayout($currentState);
</script>

<div class="graph-container">
	<SvelteFlow nodes={$nodes} edges={$edges} fitView minZoom={0.1}>
		<Background />
		<Controls />
	</SvelteFlow>
</div>

<style>
	.graph-container {
		width: 100%;
		height: 100%;
	}
</style>
