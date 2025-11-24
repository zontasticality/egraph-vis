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

		const nodeWidth = 150;
		const nodeHeight = 40;
		const clusterPadding = 20;

		for (const eclass of state.eclasses) {
			const children: any[] = [];
			const color = getColorForId(eclass.id);
			const lightColor = getLightColorForId(eclass.id);

			eclass.nodes.forEach((enode, index) => {
				const nodeId = `node-${eclass.id}-${index}`;
				children.push({
					id: nodeId,
					width: nodeWidth,
					height: nodeHeight,
					labels: [{ text: `${enode.op}(${enode.args.join(", ")})` }],
					data: {
						label: enode.op,
						args: enode.args,
						eclassId: eclass.id,
						enodeId: index, // Tracking specific enode if needed
						color: color, // Pass color to node
					},
				});
			});

			elkNodes.push({
				id: `class-${eclass.id}`,
				children: children,
				layoutOptions: {
					"elk.direction": "DOWN",
					"elk.padding": `[top=${clusterPadding + 20},left=${clusterPadding},bottom=${clusterPadding},right=${clusterPadding}]`, // Extra top padding for label
					"elk.spacing.nodeNode": "10",
				},
				labels: [{ text: `ID: ${eclass.id}` }], // Simplified label
				data: {
					eclassId: eclass.id,
					color: color,
					lightColor: lightColor,
				},
			});
		}

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
				"elk.layered.crossingMinimization.strategy": "INTERACTIVE",
				"elk.layered.nodePlacement.strategy": "INTERACTIVE",
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
					type: isCluster ? "group" : "default",
					position: { x: node.x, y: node.y },
					data: {
						label: node.labels?.[0]?.text || "",
						...node.data,
					},
					style: `width: ${node.width}px; height: ${node.height}px;`,
					parentId: parentId,
					extent: isCluster ? "parent" : undefined,
					draggable: false, // Disable dragging for stability
				};

				// Base styles
				if (isCluster) {
					const borderColor = node.data.color || "#999";
					const bg =
						node.data.lightColor || "rgba(240, 240, 240, 0.5)";
					// We can't easily render a diamond here without a custom node,
					// but we can color the border and background.
					flowNode.style += `background: ${bg}; border: 2px dashed ${borderColor}; border-radius: 8px; color: ${borderColor}; font-weight: bold;`;
				} else {
					// Symbol Box
					flowNode.style +=
						"background: white; border: 1px solid #333; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-family: monospace; box-shadow: 0 1px 2px rgba(0,0,0,0.1);";
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

	// React to interaction changes to update styles
	$: {
		const $interaction = $interactionStore;
		const $mode = $transitionMode;

		nodes.update((currentNodes) => {
			return currentNodes.map((node) => {
				let style = node.style || "";
				// Reset borders/backgrounds to base state (simplified)
				// Note: This is a bit destructive if we had other dynamic styles.
				// Ideally we'd toggle classes, but Svelte Flow style prop is inline.

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

				// Re-apply base styles + overrides
				// This is inefficient but robust for now.
				if (isCluster) {
					const baseColor = node.data.color || "#999";
					const baseBg =
						node.data.lightColor || "rgba(240, 240, 240, 0.5)";

					let borderColor = baseColor;
					let borderWidth = "2px";
					let bg = baseBg;
					let boxShadow = "none";

					if (isSelected) {
						borderColor = "#2563eb"; // Blue override for selection
						borderWidth = "3px";
						bg = "rgba(37, 99, 235, 0.1)";
						boxShadow = "0 0 0 4px rgba(37, 99, 235, 0.2)";
					} else if (isHovered) {
						borderColor = "#60a5fa"; // Light Blue
						borderWidth = "3px";
					}

					style = `width: ${node.width}px; height: ${node.height}px; background: ${bg}; border: ${borderWidth} dashed ${borderColor}; border-radius: 8px; transition: all 0.2s; color: ${baseColor}; font-weight: bold; box-shadow: ${boxShadow};`;
				} else {
					let borderColor = "#333";
					let borderWidth = "1px";
					let bg = "white";
					let boxShadow = "0 1px 2px rgba(0,0,0,0.1)";

					if (isSelected) {
						borderColor = "#2563eb";
						borderWidth = "2px";
						boxShadow = "0 0 0 2px rgba(37, 99, 235, 0.2)";
					} else if (isHovered) {
						borderColor = "#60a5fa";
						borderWidth = "2px";
					}

					style = `width: ${node.width}px; height: ${node.height}px; background: ${bg}; border: ${borderWidth} solid ${borderColor}; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-family: monospace; transition: all 0.2s; box-shadow: ${boxShadow};`;
				}

				// Handle transition mode
				if ($mode === "instant") {
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
