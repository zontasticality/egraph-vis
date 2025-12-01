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
	import { currentState, transitionMode } from "../../stores/timelineStore";
	import { interactionStore } from "../../stores/interactionStore";
	import ELK from "elkjs";
	import type { EGraphState } from "../../engine/types";
	import { getColorForId, getLightColorForId } from "../../utils/colors";

	import FlowENode from "./FlowENode.svelte";
	import FlowUnionFindGroup from "./FlowUnionFindGroup.svelte";
	import FlowEClassGroup from "./FlowEClassGroup.svelte";
	import RewriteRulesPanel from "./RewriteRulesPanel.svelte";

	const nodeTypes = {
		enode: FlowENode,
		eclassGroup: FlowEClassGroup,
		unionFindGroup: FlowUnionFindGroup,
	};

	// --- State ---

	const nodes = writable<Node[]>([]);
	const edges = writable<Edge[]>([]);

	let elk: any;

	// --- Interaction Handling ---

	function handleNodeClick({ node }: { node: Node }) {
		// Clicking E-Class group selects all nodes in the class
		const nodeIds = node.data?.nodeIds as number[] | undefined;
		if (nodeIds && nodeIds.length > 0) {
			interactionStore.selectEClass(nodeIds);
		} else {
			interactionStore.clearSelection();
		}
	}

	function handleNodeMouseEnter({ node }: { node: Node }) {
		const eclassId = node.data?.eclassId as number | undefined;
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

		// In deferred mode, group E-Classes by their canonical Union-Find set
		// In naive mode, render E-Classes directly without union-find grouping
		if (state.implementation === "deferred") {
			// Group eclasses by canonical ID
			const sets = new Map<number, typeof state.eclasses>();
			for (const eclass of state.eclasses) {
				const canonicalId =
					state.unionFind[eclass.id]?.canonical ?? eclass.id;
				if (!sets.has(canonicalId)) {
					sets.set(canonicalId, []);
				}
				sets.get(canonicalId)!.push(eclass);
			}

			// Create nodes for each set
			for (const [canonicalId, eclassesInSet] of sets) {
				const setChildren: any[] = [];

				for (const eclass of eclassesInSet) {
					const classChildren: any[] = [];
					const isCanonical = eclass.id === canonicalId;

					// Determine styling based on canonical status
					// Non-canonical (merged) classes get Red styling
					let color = getColorForId(eclass.id);
					let lightColor = getLightColorForId(eclass.id);

					if (!isCanonical) {
						// Red for merged/dirty classes
						color = "#ef4444"; // Red 500
						lightColor = "rgba(239, 68, 68, 0.1)";
					}

					eclass.nodes.forEach((enode, index) => {
						const nodeId = `node-${enode.id}`;

						classChildren.push({
							id: nodeId,
							width: 50,
							height: 50,
							data: {
								id: enode.id,
								eclassId: eclass.id,
								color: color,
								enodeColor: getColorForId(enode.id), // E-Node identity color
								args: enode.args,
								label: enode.op,
							},
						});
					});

					setChildren.push({
						id: `class-${eclass.id}`,
						children: classChildren,
						layoutOptions: {
							"elk.algorithm": "layered",
							"elk.direction": "DOWN",
							"elk.padding": `[top=8,left=8,bottom=8,right=8]`,
							"elk.spacing.nodeNode": "8",
						},
						data: {
							eclassId: eclass.id,
							color: color,
							lightColor: lightColor,
							isCanonical: isCanonical,
							label: `ID: ${eclass.id}`,
							nodeIds: eclass.nodes.map((n) => n.id), // For selection logic
						},
					});
				}

				// Create the Union-Find Group Node
				elkNodes.push({
					id: `set-${canonicalId}`,
					children: setChildren,
					layoutOptions: {
						"elk.algorithm": "layered",
						"elk.direction": "DOWN",
						"elk.padding": `[top=8,left=20,bottom=8,right=8]`,
						"elk.spacing.nodeNode": "10",
					},
					data: {
						label: `Set: ${canonicalId}`,
					},
				});
			}
		} else {
			// Naive mode: render E-Classes directly
			for (const eclass of state.eclasses) {
				const classChildren: any[] = [];

				const color = getColorForId(eclass.id);
				const lightColor = getLightColorForId(eclass.id);

				eclass.nodes.forEach((enode, index) => {
					const nodeId = `node-${enode.id}`;

					classChildren.push({
						id: nodeId,
						width: 50,
						height: 50,
						data: {
							id: enode.id,
							eclassId: eclass.id,
							color: color,
							enodeColor: getColorForId(enode.id), // E-Node identity color
							args: enode.args,
							label: enode.op,
						},
					});
				});

				elkNodes.push({
					id: `class-${eclass.id}`,
					children: classChildren,
					layoutOptions: {
						"elk.algorithm": "layered",
						"elk.direction": "DOWN",
						"elk.padding": `[top=8,left=8,bottom=8,right=8]`,
						"elk.spacing.nodeNode": "8",
					},
					data: {
						eclassId: eclass.id,
						color: color,
						lightColor: lightColor,
						isCanonical: true,
						label: `ID: ${eclass.id}`,
						nodeIds: eclass.nodes.map((n) => n.id), // For selection logic
					},
				});
			}
		}

		let edgeId = 0;
		for (const eclass of state.eclasses) {
			eclass.nodes.forEach((enode) => {
				const sourceId = `node-${enode.id}`;

				enode.args.forEach((argClassId, argIndex) => {
					// In deferred mode: edges point to SET nodes
					// In naive mode: edges point to CLASS nodes directly
					const canonicalArgId =
						state.unionFind[argClassId]?.canonical ?? argClassId;
					const targetId =
						state.implementation === "deferred"
							? `set-${canonicalArgId}`
							: `class-${canonicalArgId}`;

					elkEdges.push({
						id: `edge-${edgeId++}`,
						sources: [sourceId],
						targets: [targetId],
						sourcePort: `port-${enode.id}-${argIndex}`, // Connect from specific port
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
				const isSet = node.id.startsWith("set-");
				const isClass = node.id.startsWith("class-");
				const isEnode = node.id.startsWith("node-");

				let type = "enode";
				if (isSet) type = "unionFindGroup";
				else if (isClass) type = "eclassGroup";

				const flowNode: Node = {
					id: node.id,
					type: type,
					position: { x: node.x, y: node.y },
					data: {
						label: node.labels?.[0]?.text || "",
						width: node.width,
						height: node.height,
						...node.data,
					},
					style: `width: ${node.width}px; height: ${node.height}px;`,
					parentId: parentId,
					extent: parentId ? "parent" : undefined, // All nodes with parents should be constrained
					draggable: false,
				};

				// Styles are now handled by the components based on data
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
						sourceHandle: edge.sourcePort, // Map sourcePort to sourceHandle
						type: "smoothstep",
						animated: false,
						style: "stroke: #b1b1b7;",
						markerEnd: {
							type: MarkerType.ArrowClosed,
							color: "#b1b1b7",
						},
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

	<RewriteRulesPanel />
</div>

<style>
	.graph-container {
		position: relative;
		width: 100%;
		height: 100%;
	}
</style>
