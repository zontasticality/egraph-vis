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
	import {
		currentState,
		transitionMode,
		scrubData,
	} from "../../stores/timelineStore";
	import { interactionStore } from "../../stores/interactionStore";
	import type { EGraphState } from "../../engine/types";
	import { getColorForId, getLightColorForId } from "../../utils/colors";
	import { NODE_STYLES, ECLASS_STYLES } from "../../engine/visualStyles";
	import { easeInExpo } from "../../utils/easing";
	import {
		getPosition,
		getDimensions,
		getEClassVisuals,
	} from "./layoutHelpers";
	import { layoutManager } from "../../engine/layout";

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

	/**
	 * Calculate which handle to use on the target node based on relative positions
	 * Needs nodeMap to resolve parent positions for nested nodes
	 */
	function calculateTargetHandle(
		sourceNode: Node,
		targetNode: Node,
		nodeMap: Map<string, Node>
	): string {
		// Get absolute center positions
		// Source node might have a parent, so we need to add parent's position
		let sourceAbsX = Number(sourceNode.position.x);
		let sourceAbsY = Number(sourceNode.position.y);

		// If source has a parent, add parent's position to get absolute position
		if (sourceNode.parentId) {
			const parent = nodeMap.get(sourceNode.parentId);
			if (parent) {
				sourceAbsX += Number(parent.position.x);
				sourceAbsY += Number(parent.position.y);

				// If parent also has a parent (e-class inside union-find), add that too
				if (parent.parentId) {
					const grandparent = nodeMap.get(parent.parentId);
					if (grandparent) {
						sourceAbsX += Number(grandparent.position.x);
						sourceAbsY += Number(grandparent.position.y);
					}
				}
			}
		}

		// Add half of node size to get center
		const sourceCenterX = sourceAbsX + 25; // 50px node width / 2
		const sourceCenterY = sourceAbsY + 25; // 50px node height / 2

		// Target position (containers are already absolute if they're top-level)
		let targetAbsX = Number(targetNode.position.x);
		let targetAbsY = Number(targetNode.position.y);

		// If target has a parent, add parent's position
		if (targetNode.parentId) {
			const parent = nodeMap.get(targetNode.parentId);
			if (parent) {
				targetAbsX += Number(parent.position.x);
				targetAbsY += Number(parent.position.y);

				// If parent also has a parent, add that too
				if (parent.parentId) {
					const grandparent = nodeMap.get(parent.parentId);
					if (grandparent) {
						targetAbsX += Number(grandparent.position.x);
						targetAbsY += Number(grandparent.position.y);
					}
				}
			}
		}

		const targetCenterX = targetAbsX + ((targetNode.data?.width as number) || 100) / 2;
		const targetCenterY = targetAbsY + ((targetNode.data?.height as number) || 100) / 2;

		// Calculate angle from target to source
		const dx = sourceCenterX - targetCenterX;
		const dy = sourceCenterY - targetCenterY;
		const angle = Math.atan2(dy, dx) * (180 / Math.PI);

		// Map angle to handle (0° = right, 90° = bottom, 180° = left, -90° = top)
		if (angle >= -45 && angle < 45) return "right";
		if (angle >= 45 && angle < 135) return "bottom";
		if (angle >= 135 || angle < -135) return "left";
		return "top";
	}

	function updateLayout(
		currentState: EGraphState | null,
		nextState: EGraphState | null = null,
		progress: number = 0,
	) {
		if (!currentState) {
			nodes.set([]);
			edges.set([]);
			return;
		}

		const state = currentState;

		// Diagnostic logging
		console.log("[GraphPane] updateLayout:", {
			phase: state.phase,
			stepIndex: state.stepIndex,
			numEClasses: state.eclasses.length,
			totalNodes: state.eclasses.reduce(
				(sum, ec) => sum + ec.nodes.length,
				0,
			),
			numMatches: state.metadata.matches.length,
			matchedNodes: state.metadata.matches.flatMap((m) => m.nodes).length,
			numDiffs: state.metadata.diffs.length,
			progress: progress.toFixed(3),
			implementation: state.implementation,
		});

		// Check if we have precomputed layout
		if (!state.layout) {
			console.warn(
				"[GraphPane] No precomputed layout available, waiting...",
			);
			return;
		}

		const newNodes: Node[] = [];
		const newEdges: Edge[] = [];

		// Determine if we should interpolate positions
		// Keep interpolating all the way to progress = 1.0 to avoid snap-back
		const shouldInterpolate =
			nextState?.layout && progress > 0.01 && progress < 1.0;

		// Apply easing to progress for smoother transitions
		// Use eased progress for positions/colors, linear progress for opacity
		const easedProgress = shouldInterpolate
			? easeInExpo(progress)
			: progress;
		const linearProgress = progress; // Linear for opacity (no easing)

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
				const setPos = getPosition(
					setId,
					false,
					state,
					nextState,
					progress,
					shouldInterpolate,
				);
				const setDims = getDimensions(
					setId,
					state,
					nextState,
					progress,
					shouldInterpolate,
				);

				// Create union-find group node
				newNodes.push({
					id: setId,
					type: "unionFindGroup",
					position: setPos,
					data: {
						label: `Set: ${canonicalId}`,
						width: setDims.width,
						height: setDims.height,
					},
					style: `width: ${setDims.width}px; height: ${setDims.height}px; background: transparent; border: none; padding: 0;`,
					draggable: false,
				});

				for (const eclass of eclassesInSet) {
					const classId = `class-${eclass.id}`;
					const classPos = getPosition(
						classId,
						false,
						state,
						nextState,
						progress,
						shouldInterpolate,
					);
					const classDims = getDimensions(
						classId,
						state,
						nextState,
						progress,
						shouldInterpolate,
					);
					const classVisuals = getEClassVisuals(
						eclass.id,
						state,
						nextState,
						progress,
						shouldInterpolate,
					);
					const isCanonical = eclass.id === canonicalId;

					// Create e-class group node
					newNodes.push({
						id: classId,
						type: "eclassGroup",
						position: classPos,
						parentId: setId,
						extent: "parent",
						data: {
							eclassId: eclass.id,
							color: classVisuals.color,
							lightColor: classVisuals.lightColor,
							opacity: classVisuals.opacity,
							isCanonical: isCanonical,
							label: `ID: ${eclass.id}`,
							nodeIds: eclass.nodes.map((n) => n.id),
							width: classDims.width,
							height: classDims.height,
						},
						style: `width: ${classDims.width}px; height: ${classDims.height}px; background: transparent; border: none; padding: 0;`,
						draggable: false,
					});

					// Create e-node Flow nodes
					const enodeIdentityColor = getColorForId(eclass.id);

					for (const enode of eclass.nodes) {
						const nodeId = `node-${enode.id}`;
						const nodePos = getPosition(
							nodeId,
							true,
							state,
							nextState,
							progress,
							shouldInterpolate,
						);
						const visualState = state.visualStates?.nodes.get(
							enode.id,
						);
						const nextVisualState =
							nextState?.visualStates?.nodes.get(enode.id);

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
								progress: easedProgress, // Eased for color interpolation
								linearProgress: linearProgress, // Linear for opacity
							},
							style: `width: 50px; height: 50px; background: transparent; border: none; padding: 0;`,
							draggable: false,
						});
					}
				}
			}
		} else {
			// Naive mode: just e-classes and e-nodes
			for (const eclass of state.eclasses) {
				const classId = `class-${eclass.id}`;
				const classPos = getPosition(
					classId,
					false,
					state,
					nextState,
					progress,
					shouldInterpolate,
				);
				const classDims = getDimensions(
					classId,
					state,
					nextState,
					progress,
					shouldInterpolate,
				);
				const classVisuals = getEClassVisuals(
					eclass.id,
					state,
					nextState,
					progress,
					shouldInterpolate,
				);

				// Create e-class group node
				newNodes.push({
					id: classId,
					type: "eclassGroup",
					position: classPos,
					data: {
						eclassId: eclass.id,
						color: classVisuals.color,
						lightColor: classVisuals.lightColor,
						opacity: classVisuals.opacity,
						isCanonical: true,
						label: `ID: ${eclass.id}`,
						nodeIds: eclass.nodes.map((n) => n.id),
						width: classDims.width,
						height: classDims.height,
					},
					style: `width: ${classDims.width}px; height: ${classDims.height}px; background: transparent; border: none; padding: 0;`,
					draggable: false,
				});

				const enodeIdentityColor = getColorForId(eclass.id);

				for (const enode of eclass.nodes) {
					const nodeId = `node-${enode.id}`;
					const nodePos = getPosition(
						nodeId,
						true,
						state,
						nextState,
						progress,
						shouldInterpolate,
					);
					const visualState = state.visualStates?.nodes.get(enode.id);
					const nextVisualState = nextState?.visualStates?.nodes.get(
						enode.id,
					);

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
							progress: easedProgress, // Eased for color interpolation
							linearProgress: linearProgress, // Linear for opacity
						},
						style: `width: 50px; height: 50px; background: transparent; border: none; padding: 0;`,
						draggable: false,
					});
				}
			}
		}

		// Create a lookup map for nodes by ID for edge handle calculation
		const nodeMap = new Map<string, Node>();
		for (const node of newNodes) {
			nodeMap.set(node.id, node);
		}

		// Create edges
		let edgeId = 0;
		const layoutConfig = layoutManager.getConfig();
		let edgeType = "smoothstep"; // Default to orthogonal

		if (layoutConfig.edgeRouting === "POLYLINE") {
			edgeType = "straight";
		} else if (layoutConfig.edgeRouting === "SPLINES") {
			edgeType = "default"; // Bezier
		}

		for (const eclass of state.eclasses) {
			for (const enode of eclass.nodes) {
				const sourceId = `node-${enode.id}`;
				const sourceNode = nodeMap.get(sourceId);

				enode.args.forEach((argClassId, argIndex) => {
					// In deferred mode: edges point to SET nodes
					// In naive mode: edges point to CLASS nodes directly
					const canonicalArgId =
						state.unionFind[argClassId]?.canonical ?? argClassId;
					const targetId =
						state.implementation === "deferred"
							? `set-${canonicalArgId}`
							: `class-${canonicalArgId}`;

					const targetNode = nodeMap.get(targetId);

					// Calculate which handle to use on the target based on positions
					const targetHandle = sourceNode && targetNode
						? calculateTargetHandle(sourceNode, targetNode, nodeMap)
						: undefined;

					newEdges.push({
						id: `edge-${edgeId++}`,
						source: sourceId,
						target: targetId,
						sourceHandle: `port-${enode.id}-${argIndex}`,
						targetHandle: targetHandle,
						type: edgeType,
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
	$: updateLayout(
		$scrubData.currentState,
		$scrubData.nextState,
		$scrubData.progress,
	);
</script>

<div class="graph-container">
	{#if !$currentState?.layout}
		<div class="loading-overlay">
			<div class="spinner"></div>
			<div class="loading-text">Computing Layout...</div>
		</div>
	{/if}

	<SvelteFlow
		nodes={$nodes}
		edges={$edges}
		{nodeTypes}
		fitView
		minZoom={0.1}
		panOnDrag={true}
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

	.loading-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(255, 255, 255, 0.8);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		z-index: 50;
		backdrop-filter: blur(2px);
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 4px solid #f3f3f3;
		border-top: 4px solid #3b82f6;
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-bottom: 1rem;
	}

	.loading-text {
		color: #374151;
		font-weight: 500;
		font-size: 0.9rem;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
</style>
