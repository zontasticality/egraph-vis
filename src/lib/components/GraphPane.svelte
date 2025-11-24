<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		type Node,
		type Edge,
		useSvelteFlow,
		MarkerType,
	} from "@xyflow/svelte";
	import "@xyflow/svelte/dist/style.css";
	import { writable, get } from "svelte/store";
	import { currentState, transitionMode } from "../stores/timelineStore";
	import { interactionStore } from "../stores/interactionStore";
	import ELK from "elkjs";
	import type { EGraphState } from "../engine/types";
	import { getColorForId, getLightColorForId } from "../utils/colors";

	import ENode from "./ENode.svelte";
	import FlowENode from "./FlowENode.svelte"; // I will create this next
	import FlowEClassGroup from "./FlowEClassGroup.svelte";

	const nodeTypes = {
		enode: FlowENode,
		eclassGroup: FlowEClassGroup,
	};

	// --- State ---

	const nodes = writable<Node[]>([]);
	const edges = writable<Edge[]>([]);

	let elk: any;

	// --- Interaction Handling ---

	function handleNodeClick({ node }: { node: Node }) {
		const eclassId = node.data?.eclassId as number | string | undefined;
		if (eclassId !== undefined) {
			interactionStore.select({ type: "eclass", id: eclassId });
		} else {
			interactionStore.clearSelection();
		}
	}

	function handleNodeMouseEnter({ node }: { node: Node }) {
		const eclassId = node.data?.eclassId as number | string | undefined;
		if (eclassId !== undefined) {
			interactionStore.hover({ type: "eclass", id: eclassId });
		}
	}

	function handleNodeMouseLeave({ node }: { node: Node }) {
		interactionStore.clearHover();
	}

	function handlePaneClick() {
		interactionStore.clearSelection();
	}

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
		const elkNodes: any[] = [];
		const elkEdges: any[] = [];

		// Estimate dimensions for ENode component
		const nodeWidth = 100; // Approximate width for symbol mode
		const nodeHeight = 40;
		const clusterPadding = 20;

		for (const eclass of state.eclasses) {
			const children: any[] = [];
			const color = getColorForId(eclass.id);
			const lightColor = getLightColorForId(eclass.id);

			eclass.nodes.forEach((enode, index) => {
				const nodeId = `node-${enode.id}`; // Use actual Node ID for stability
				children.push({
					id: nodeId,
					width: nodeWidth,
					height: nodeHeight,
					labels: [{ text: enode.op }], // Fallback label
					data: {
						id: enode.id, // Pass ID to FlowENode
						mode: "symbol",
						eclassId: eclass.id,
						color: color,
					},
				});
			});

			elkNodes.push({
				id: `class-${eclass.id}`,
				children: children,
				layoutOptions: {
					"elk.algorithm": "layered",
					"elk.direction": "DOWN",
					"elk.padding": `[top=${clusterPadding + 20},left=${clusterPadding},bottom=${clusterPadding},right=${clusterPadding}]`,
					"elk.spacing.nodeNode": "10",
				},
				labels: [{ text: `ID: ${eclass.id}` }],
				data: {
					eclassId: eclass.id,
					color: color,
					lightColor: lightColor,
				},
			});
		}

		let edgeId = 0;
		for (const eclass of state.eclasses) {
			eclass.nodes.forEach((enode) => {
				const sourceId = `node-${enode.id}`;

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
				"elk.hierarchyHandling": "INCLUDE_CHILDREN",
			},
			children: elkNodes,
			edges: elkEdges,
		};

		try {
			const layoutedGraph = await elk.layout(graph);

			const newNodes: Node[] = [];
			const newEdges: Edge[] = [];

			function traverse(node: any, parentId?: string) {
				const isCluster = node.id.startsWith("class-");

				const flowNode: Node = {
					id: node.id,
					type: isCluster ? "eclassGroup" : "enode", // Use custom types
					position: { x: node.x, y: node.y },
					data: {
						label: node.labels?.[0]?.text || "",
						width: node.width,
						height: node.height,
						...node.data,
					},
					style: `width: ${node.width}px; height: ${node.height}px;`,
					parentId: parentId,
					extent: isCluster ? "parent" : undefined,
					draggable: false,
				};

				// Styles are now handled by the components based on data
				// We just ensure the wrapper is transparent/sized correctly
				flowNode.style +=
					"background: transparent; border: none; padding: 0;";

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
						// label: edge.labels?.[0]?.text, // Removed label
						style: "stroke: #b1b1b7;",
						markerEnd: {
							type: MarkerType.ArrowClosed,
							color: "#b1b1b7",
						},
						// targetHandle: null, // No longer needed as we have a default handle
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

	// React to interaction changes to update styles (Clusters only)
	// ENode component handles its own interaction styles!
	$: {
		const $interaction = $interactionStore;
		const $mode = $transitionMode;

		nodes.update((currentNodes) => {
			return currentNodes.map((node) => {
				// We don't need to update style string anymore for clusters,
				// as FlowEClassGroup should react to data changes?
				// Wait, FlowEClassGroup receives `data`. We need to update `data` to trigger reactivity in the component?
				// Or we can just update the style prop if we want to override colors.

				// Actually, FlowEClassGroup uses `data.color`.
				// If we want to highlight, we should probably update `data`.
				// But Svelte Flow nodes are reactive.

				// Let's stick to the previous approach of updating style for now,
				// BUT FlowEClassGroup uses CSS variables from style attribute?
				// No, it uses style:--color={data.color}.

				// If we want to change the border color on selection, we should update data.
				// Or we can just let the component handle selection state if we pass it?
				// But selection state is global in interactionStore.

				// Let's update `data` in the node.

				const isCluster = node.id.startsWith("class-");
				const eclassId = node.data?.eclassId;

				let isSelected = false;
				let isHovered = false;

				if (eclassId !== undefined) {
					if (
						$interaction.selection?.type === "eclass" &&
						$interaction.selection.id === eclassId
					) {
						isSelected = true;
					}
					if (
						$interaction.hover?.type === "eclass" &&
						$interaction.hover.id === eclassId
					) {
						isHovered = true;
					}
				}

				if (isCluster) {
					// We need to clone data to trigger update
					const newData = { ...node.data };

					const baseColor = newData.color || "#999";
					// We can't easily change the color prop without losing the original.
					// But we can add an override.

					if (isSelected) {
						newData.color = "#2563eb";
						newData.lightColor = "rgba(37, 99, 235, 0.1)";
					} else if (isHovered) {
						newData.color = "#60a5fa";
					} else {
						// Reset to original (stored where? we don't store original in a separate field)
						// We need to re-fetch color from ID.
						newData.color = getColorForId(eclassId);
						newData.lightColor = getLightColorForId(eclassId);
					}

					return { ...node, data: newData };
				}

				return node;
			});
		});
	}
</script>

<div class="graph-container">
	<SvelteFlow
		nodes={$nodes}
		edges={$edges}
		{nodeTypes}
		fitView
		minZoom={0.1}
		onnodeclick={handleNodeClick}
		onnodepointerenter={handleNodeMouseEnter}
		onnodepointerleave={handleNodeMouseLeave}
		onpaneclick={handlePaneClick}
	>
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
