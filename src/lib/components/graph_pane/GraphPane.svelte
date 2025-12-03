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
	import { currentState, transitionMode, scrubData } from "../../stores/timelineStore";
	import { interactionStore } from "../../stores/interactionStore";
	import type { EGraphState } from "../../engine/types";
	import { getColorForId, getLightColorForId } from "../../utils/colors";
	import { NODE_STYLES, ECLASS_STYLES } from "../../engine/visualStyles";

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

	// --- Interaction Handling ---

	function handleNodeClick({ node }: { node: Node }) {
		// Determine node type and handle selection accordingly
		const nodeType = node.type;

		if (nodeType === "enode") {
			// Individual E-Node clicked
			const enodeId = node.data?.id as number | undefined;
			if (enodeId !== undefined) {
				interactionStore.selectENode(enodeId);
			}
		} else if (nodeType === "eclassGroup") {
			// Inner E-Class group clicked - select all nodes in this class
			const nodeIds = node.data?.nodeIds as number[] | undefined;
			if (nodeIds && nodeIds.length > 0) {
				interactionStore.selectEClass(nodeIds);
			}
		} else if (nodeType === "unionFindGroup") {
			// Outer Union-Find group clicked - select all nodes in all classes in this set
			// Collect all node IDs from all child E-Class groups
			const allNodeIds: number[] = [];
			const currentNodes = get(nodes);

			// Find all eclassGroup children of this union-find group
			currentNodes.forEach((n) => {
				if (n.parentId === node.id && n.type === "eclassGroup") {
					const childNodeIds = n.data?.nodeIds as
						| number[]
						| undefined;
					if (childNodeIds) {
						allNodeIds.push(...childNodeIds);
					}
				}
			});

			if (allNodeIds.length > 0) {
				interactionStore.selectEClass(allNodeIds);
			} else {
				interactionStore.clearSelection();
			}
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

	function updateLayout(
		currentState: EGraphState | null,
		nextState: EGraphState | null = null,
		progress: number = 0
	) {
		if (!currentState) {
			nodes.set([]);
			edges.set([]);
			return;
		}

		const state = currentState;

		// Check if we have precomputed layout
		if (!state.layout) {
			console.warn('[GraphPane] No precomputed layout available, waiting...');
			return;
		}

		const newNodes: Node[] = [];
		const newEdges: Edge[] = [];

		// Determine if we should interpolate positions
		const shouldInterpolate =
			nextState?.layout &&
			progress > 0.01 &&
			progress < 0.99;

		// Helper to get interpolated position
		const getPosition = (
			id: string,
			isEnode: boolean
		): { x: number; y: number } => {
			if (isEnode) {
				const nodeId = parseInt(id.substring(5)); // "node-123" -> 123
				const currentPos = state.layout!.nodes.get(nodeId);
				if (!currentPos) return { x: 0, y: 0 };

				if (shouldInterpolate) {
					const nextPos = nextState.layout!.nodes.get(nodeId);
					if (nextPos) {
						return {
							x: currentPos.x + (nextPos.x - currentPos.x) * progress,
							y: currentPos.y + (nextPos.y - currentPos.y) * progress
						};
					}
				}
				return currentPos;
			} else {
				// Group node (class or set)
				const currentPos = state.layout!.groups.get(id);
				if (!currentPos) return { x: 0, y: 0 };

				if (shouldInterpolate) {
					const nextPos = nextState.layout!.groups.get(id);
					if (nextPos) {
						return {
							x: currentPos.x + (nextPos.x - currentPos.x) * progress,
							y: currentPos.y + (nextPos.y - currentPos.y) * progress
						};
					}
				}
				return currentPos;
			}
		};

		// Build Flow nodes from state structure

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

			// Create Flow nodes for each set
			for (const [canonicalId, eclassesInSet] of sets) {
				const setId = `set-${canonicalId}`;
				const setPos = getPosition(setId, false);
				const setLayout = state.layout.groups.get(setId);

				// Create union-find group node
				newNodes.push({
					id: setId,
					type: "unionFindGroup",
					position: setPos,
					data: {
						label: `Set: ${canonicalId}`,
						width: setLayout?.width ?? 100,
						height: setLayout?.height ?? 100
					},
					style: `width: ${setLayout?.width ?? 100}px; height: ${setLayout?.height ?? 100}px; background: transparent; border: none; padding: 0;`,
					draggable: false
				});

				for (const eclass of eclassesInSet) {
					const classId = `class-${eclass.id}`;
					const classPos = getPosition(classId, false);
					const classLayout = state.layout.groups.get(classId);
					const isCanonical = eclass.id === canonicalId;

					const eclassColor = "#9ca3af";
					const eclassLightColor = "rgba(156, 163, 175, 0.1)";

					// Create e-class group node
					newNodes.push({
						id: classId,
						type: "eclassGroup",
						position: classPos,
						parentId: setId,
						extent: "parent",
						data: {
							eclassId: eclass.id,
							color: eclassColor,
							lightColor: eclassLightColor,
							isCanonical: isCanonical,
							label: `ID: ${eclass.id}`,
							nodeIds: eclass.nodes.map((n) => n.id),
							width: classLayout?.width ?? 80,
							height: classLayout?.height ?? 80
						},
						style: `width: ${classLayout?.width ?? 80}px; height: ${classLayout?.height ?? 80}px; background: transparent; border: none; padding: 0;`,
						draggable: false
					});

					// Create e-node Flow nodes
					const enodeIdentityColor = getColorForId(eclass.id);

					for (const enode of eclass.nodes) {
						const nodeId = `node-${enode.id}`;
						const nodePos = getPosition(nodeId, true);
						const visualState = state.visualStates?.nodes.get(enode.id);
						const nextVisualState = nextState?.visualStates?.nodes.get(enode.id);

						newNodes.push({
							id: nodeId,
							type: "enode",
							position: nodePos,
							parentId: classId,
							extent: "parent",
							data: {
								id: enode.id,
								eclassId: eclass.id,
								color: enodeIdentityColor,
								enodeColor: getColorForId(enode.id),
								args: enode.args,
								label: enode.op,
								visualState: visualState,
								nextVisualState: nextVisualState,
								progress: progress
							},
							style: `width: 50px; height: 50px; background: transparent; border: none; padding: 0;`,
							draggable: false
						});
					}
				}
			}
		} else {
			// Naive mode: just e-classes and e-nodes
			for (const eclass of state.eclasses) {
				const classId = `class-${eclass.id}`;
				const classPos = getPosition(classId, false);
				const classLayout = state.layout.groups.get(classId);

				const eclassColor = "#9ca3af";
				const eclassLightColor = "rgba(156, 163, 175, 0.1)";

				// Create e-class group node
				newNodes.push({
					id: classId,
					type: "eclassGroup",
					position: classPos,
					data: {
						eclassId: eclass.id,
						color: eclassColor,
						lightColor: eclassLightColor,
						isCanonical: true,
						label: `ID: ${eclass.id}`,
						nodeIds: eclass.nodes.map((n) => n.id),
						width: classLayout?.width ?? 80,
						height: classLayout?.height ?? 80
					},
					style: `width: ${classLayout?.width ?? 80}px; height: ${classLayout?.height ?? 80}px; background: transparent; border: none; padding: 0;`,
					draggable: false
				});

				const enodeIdentityColor = getColorForId(eclass.id);

				for (const enode of eclass.nodes) {
					const nodeId = `node-${enode.id}`;
					const nodePos = getPosition(nodeId, true);
					const visualState = state.visualStates?.nodes.get(enode.id);
					const nextVisualState = nextState?.visualStates?.nodes.get(enode.id);

					newNodes.push({
						id: nodeId,
						type: "enode",
						position: nodePos,
						parentId: classId,
						extent: "parent",
						data: {
							id: enode.id,
							eclassId: eclass.id,
							color: enodeIdentityColor,
							enodeColor: getColorForId(enode.id),
							args: enode.args,
							label: enode.op,
							visualState: visualState,
							nextVisualState: nextVisualState,
							progress: progress
						},
						style: `width: 50px; height: 50px; background: transparent; border: none; padding: 0;`,
						draggable: false
					});
				}
			}
		}

		// Create edges
		let edgeId = 0;
		for (const eclass of state.eclasses) {
			for (const enode of eclass.nodes) {
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

					newEdges.push({
						id: `edge-${edgeId++}`,
						source: sourceId,
						target: targetId,
						sourceHandle: `port-${enode.id}-${argIndex}`,
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
		}

		// Update stores
		nodes.set(newNodes);
		edges.set(newEdges);
	}

	// React to state changes (use scrubData for interpolation support)
	$: updateLayout($scrubData.currentState, $scrubData.nextState, $scrubData.progress);
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
