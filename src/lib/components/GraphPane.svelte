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
	import { writable, get } from "svelte/store";
	import { currentState, transitionMode } from "../stores/timelineStore";
	import { interactionStore } from "../stores/interactionStore";
	import ELK from "elkjs";
	import type { EGraphState } from "../engine/types";
	import { getColorForId, getLightColorForId } from "../utils/colors";

	import ENode from "./ENode.svelte";
	import FlowENode from "./FlowENode.svelte"; // I will create this next

	const nodeTypes = {
		enode: FlowENode,
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
				"elk.layered.crossingMinimization.strategy": "INTERACTIVE",
				"elk.layered.nodePlacement.strategy": "INTERACTIVE",
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
					type: isCluster ? "group" : "enode", // Use 'enode' for children
					position: { x: node.x, y: node.y },
					data: {
						label: node.labels?.[0]?.text || "",
						...node.data,
					},
					style: `width: ${node.width}px; height: ${node.height}px;`,
					parentId: parentId,
					extent: isCluster ? "parent" : undefined,
					draggable: false,
				};

				// Cluster Styles
				if (isCluster) {
					const borderColor = node.data.color || "#999";
					const bg =
						node.data.lightColor || "rgba(240, 240, 240, 0.5)";
					flowNode.style += `background: ${bg}; border: 2px dashed ${borderColor}; border-radius: 8px; color: ${borderColor}; font-weight: bold;`;
				} else {
					// ENode Styles: Handled by component, but we need to ensure wrapper is transparent/sized
					// Svelte Flow nodes have default styles (border, bg). We might want to remove them for 'enode' type?
					// Or we can let FlowENode handle it.
					// But 'style' prop applies to the wrapper div.
					// Let's make the wrapper transparent so ENode component controls the look.
					flowNode.style +=
						"background: transparent; border: none; padding: 0;";
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
						style: "stroke: #b1b1b7;",
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
				let style = node.style || "";

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
					const baseColor = node.data.color || "#999";
					const baseBg =
						node.data.lightColor || "rgba(240, 240, 240, 0.5)";

					let borderColor = baseColor;
					let borderWidth = "2px";
					let bg = baseBg;
					let boxShadow = "none";

					if (isSelected) {
						borderColor = "#2563eb";
						borderWidth = "3px";
						bg = "rgba(37, 99, 235, 0.1)";
						boxShadow = "0 0 0 4px rgba(37, 99, 235, 0.2)";
					} else if (isHovered) {
						borderColor = "#60a5fa";
						borderWidth = "3px";
					}

					// Reconstruct style string (hacky but works for now)
					// We preserve width/height
					const widthMatch = style.match(/width: [^;]+;/);
					const heightMatch = style.match(/height: [^;]+;/);
					const w = widthMatch ? widthMatch[0] : "";
					const h = heightMatch ? heightMatch[0] : "";

					style = `${w} ${h} background: ${bg}; border: ${borderWidth} dashed ${borderColor}; border-radius: 8px; transition: all 0.2s; color: ${baseColor}; font-weight: bold; box-shadow: ${boxShadow};`;
				}
				// For ENodes, we don't update style here because the component handles it.
				// UNLESS we need to handle transition mode for them too?
				// ENode component can subscribe to transitionMode.

				// Handle transition mode for clusters
				if ($mode === "instant" && isCluster) {
					style = style.replace(
						"transition: all 0.2s;",
						"transition: none;",
					);
				}

				return { ...node, style };
			});
		});
	}
</script>

<div class="graph-container">
	<SvelteFlow
		nodes={$nodes}
		edges={$edges}
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
