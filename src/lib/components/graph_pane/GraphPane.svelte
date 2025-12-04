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
	import { getColorForId } from "../../utils/colors";
	import { ECLASS_STYLES } from "../../engine/visualStyles";
	import { easeInExpo } from "../../utils/easing";
	import {
		getPosition,
		getEClassVisuals,
	} from "./layoutHelpers";
	import { layoutManager } from "../../engine/layout";
	import { ENODE_LAYOUT } from "../../engine/layoutConfig";

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

		// Map angle to handle in 8 directions (0° = right, 90° = bottom, 180° = left, -90° = top)
		// Each direction covers 45° (360° / 8)
		if (angle >= -22.5 && angle < 22.5) return "e";   // East (Right)
		if (angle >= 22.5 && angle < 67.5) return "se";   // South-East
		if (angle >= 67.5 && angle < 112.5) return "s";   // South (Bottom)
		if (angle >= 112.5 && angle < 157.5) return "sw"; // South-West
		if (angle >= 157.5 || angle < -157.5) return "w"; // West (Left)
		if (angle >= -157.5 && angle < -112.5) return "nw"; // North-West
		if (angle >= -112.5 && angle < -67.5) return "n";  // North (Top)
		return "ne"; // North-East
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
		const renderedEdgeSources: Array<{
			nodeId: number;
			args: number[];
			opacity: number;
			eclassId: number;
		}> = [];

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

		const canonicalOf = (id: number, preferNext = false) => {
			if (preferNext && nextState?.unionFind[id]) {
				return nextState.unionFind[id].canonical;
			}
			if (state.unionFind[id]) {
				return state.unionFind[id].canonical;
			}
			if (nextState?.unionFind[id]) {
				return nextState.unionFind[id].canonical;
			}
			return id;
		};
		const canonicalMapCurrent = new Map<number, number>();
		const canonicalMapNext = new Map<number, number>();
		state.unionFind.forEach((entry) =>
			canonicalMapCurrent.set(entry.id, entry.canonical),
		);
		nextState?.unionFind.forEach((entry) =>
			canonicalMapNext.set(entry.id, entry.canonical),
		);

		const allCurrentNodeIds = new Set<number>();
		state.eclasses.forEach((ec) =>
			ec.nodes.forEach((n) => allCurrentNodeIds.add(n.id)),
		);

		const interpolateGroupPosition = (id: string) => {
			const currentPos = state.layout!.groups.get(id);
			const nextPos = nextState?.layout?.groups.get(id);

			if (shouldInterpolate && currentPos && nextPos) {
				return {
					x:
						currentPos.x +
						(nextPos.x - currentPos.x) * easedProgress,
					y:
						currentPos.y +
						(nextPos.y - currentPos.y) * easedProgress,
				};
			}
			if (currentPos) return { x: currentPos.x, y: currentPos.y };
			if (nextPos) return { x: nextPos.x, y: nextPos.y };
			return { x: 0, y: 0 };
		};

		const interpolateGroupDimensions = (id: string) => {
			const currentDims = state.layout!.groups.get(id);
			const nextDims = nextState?.layout?.groups.get(id);

			if (shouldInterpolate && currentDims && nextDims) {
				return {
					width:
						currentDims.width +
						(nextDims.width - currentDims.width) *
							easedProgress,
					height:
						currentDims.height +
						(nextDims.height - currentDims.height) *
							easedProgress,
				};
			}
			if (currentDims)
				return {
					width: currentDims.width,
					height: currentDims.height,
				};
			if (nextDims)
				return {
					width: nextDims.width,
					height: nextDims.height,
				};
			return { width: 100, height: 100 };
		};

		// Group by canonical IDs across current/next to keep logical classes together.
		type RenderEntry = {
			canonicalId: number;
			currentClasses: typeof state.eclasses;
			nextClasses: typeof state.eclasses;
		};

		const groupsByCanonical = new Map<number, RenderEntry>();

		const ensureGroup = (canonicalId: number) => {
			if (!groupsByCanonical.has(canonicalId)) {
				groupsByCanonical.set(canonicalId, {
					canonicalId,
					currentClasses: [],
					nextClasses: [],
				});
			}
			return groupsByCanonical.get(canonicalId)!;
		};

		for (const ec of state.eclasses) {
			const can = canonicalMapCurrent.get(ec.id) ?? ec.id;
			ensureGroup(can).currentClasses.push(ec);
		}

		if (nextState) {
			for (const ec of nextState.eclasses) {
				const can = canonicalMapNext.get(ec.id) ?? ec.id;
				ensureGroup(can).nextClasses.push(ec);
			}
		}

		const renderEntries = Array.from(groupsByCanonical.values()).sort(
			(a, b) => a.canonicalId - b.canonicalId,
		);

		// Render union-find sets (deferred implementation) using union of current/next
		if (state.implementation === "deferred") {
			const allSetIds = new Set<number>();
			for (const entry of renderEntries) {
				allSetIds.add(entry.canonicalId);
			}

			for (const canonicalId of Array.from(allSetIds).sort(
				(a, b) => a - b,
			)) {
				const setId = `set-${canonicalId}`;
				const setPos = interpolateGroupPosition(setId);
				const setDims = interpolateGroupDimensions(setId);

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
			}
		}

		for (const entry of renderEntries) {
			const canonicalId = entry.canonicalId;
			const currentClasses = entry.currentClasses;
			const nextClasses = entry.nextClasses;

			const currentNodeIds = new Set<number>();
			currentClasses.forEach((ec) =>
				ec.nodes.forEach((n) => currentNodeIds.add(n.id)),
			);

			const nextNodeIds = new Set<number>();
			nextClasses.forEach((ec) =>
				ec.nodes.forEach((n) => nextNodeIds.add(n.id)),
			);

			const existsCurrent = currentClasses.length > 0;
			const existsNext = nextClasses.length > 0;
			const hasTrueNewNodes = Array.from(nextNodeIds).some(
				(id) => !allCurrentNodeIds.has(id),
			);

			let renderMode:
				| "normal"
				| "mergeLoser"
				| "addNodes"
				| "newClass" = "normal";

			if (existsCurrent && !existsNext) {
				renderMode = "mergeLoser";
			} else if (!existsCurrent && existsNext) {
				renderMode = "newClass";
			} else if (existsCurrent && existsNext && hasTrueNewNodes) {
				renderMode = "addNodes";
			}

			const classId = `class-${canonicalId}`;
			const classPos = interpolateGroupPosition(classId);
			const classDims = interpolateGroupDimensions(classId);
			const spawnCenter = {
				x: classDims.width / 2 - ENODE_LAYOUT.width / 2,
				y: classDims.height / 2 - ENODE_LAYOUT.height / 2,
			};

			const classVisuals = (() => {
				const fallbackNext =
					nextState?.visualStates?.eclasses.get(canonicalId);
				if (!existsCurrent && fallbackNext) {
					const style = ECLASS_STYLES[fallbackNext.styleClass];
					return {
						color: style.borderColor!,
						lightColor: style.backgroundColor!,
						opacity: style.opacity ?? 1,
					};
				}
				return getEClassVisuals(
					canonicalId,
					state,
					nextState,
					progress,
					shouldInterpolate,
				);
			})();

			const classOpacity =
				renderMode === "newClass" && shouldInterpolate
					? linearProgress
					: classVisuals.opacity;

			const parentSetId =
				state.implementation === "deferred"
					? `set-${canonicalId}`
					: undefined;

			const nodeIdsForClass = new Set<number>();
			if (renderMode === "addNodes") {
				currentNodeIds.forEach((id) => nodeIdsForClass.add(id));
				nextNodeIds.forEach((id) => nodeIdsForClass.add(id));
			} else if (renderMode === "newClass") {
				nextNodeIds.forEach((id) => nodeIdsForClass.add(id));
			} else {
				currentNodeIds.forEach((id) => nodeIdsForClass.add(id));
			}

				const eclassId = canonicalId;

				newNodes.push({
					id: classId,
					type: "eclassGroup",
					position: classPos,
					parentId: parentSetId,
					extent: parentSetId ? "parent" : undefined,
				data: {
					eclassId: eclassId,
					color: classVisuals.color,
					lightColor: classVisuals.lightColor,
					opacity: classOpacity,
					isCanonical: true,
					label: `ID: ${canonicalId}`,
					nodeIds: Array.from(nodeIdsForClass),
					width: classDims.width,
					height: classDims.height,
				},
				style: `width: ${classDims.width}px; height: ${classDims.height}px; background: transparent; border: none; padding: 0;`,
				draggable: false,
			});

			const enodeIdentityColor = getColorForId(canonicalId);

			for (const nodeId of nodeIdsForClass) {
				let currentNode:
					| { id: number; op: string; args: number[] }
					| undefined;
				for (const ec of currentClasses) {
					const found = ec.nodes.find((n) => n.id === nodeId);
					if (found) {
						currentNode = found;
						break;
					}
				}

				let nextNode:
					| { id: number; op: string; args: number[] }
					| undefined;
				for (const ec of nextClasses) {
					const found = ec.nodes.find((n) => n.id === nodeId);
					if (found) {
						nextNode = found;
						break;
					}
				}

				const isTrueNewNode =
					!currentNode &&
					nextNode !== undefined &&
					!allCurrentNodeIds.has(nodeId);

				let nodePos: { x: number; y: number };
				if (renderMode === "newClass") {
					const targetPos =
						nextState?.layout?.nodes.get(nodeId) ?? {
							x: spawnCenter.x,
							y: spawnCenter.y,
						};
					nodePos = { x: targetPos.x, y: targetPos.y };
				} else if (renderMode === "addNodes" && isTrueNewNode) {
					const targetPos =
						nextState?.layout?.nodes.get(nodeId) ?? {
							x: spawnCenter.x,
							y: spawnCenter.y,
						};
					nodePos = {
						x:
							spawnCenter.x +
							(targetPos.x - spawnCenter.x) * easedProgress,
						y:
							spawnCenter.y +
							(targetPos.y - spawnCenter.y) * easedProgress,
					};
				} else {
					nodePos = getPosition(
						`node-${nodeId}`,
						true,
						state,
						nextState,
						progress,
						shouldInterpolate,
					);
				}

				const visualState = state.visualStates?.nodes.get(nodeId);
					const nextVisualState =
						nextState?.visualStates?.nodes.get(nodeId);

				const overrideOpacity =
					renderMode === "newClass"
						? shouldInterpolate
							? linearProgress
							: 1
						: renderMode === "addNodes" && isTrueNewNode
							? shouldInterpolate
								? linearProgress
								: 1
							: undefined;

				const argsForNode = nextNode?.args ?? currentNode?.args ?? [];

				const labelForNode = nextNode?.op ?? currentNode?.op ?? "";

				newNodes.push({
					id: `node-${nodeId}`,
					type: "enode",
					position: nodePos,
					parentId: classId,
					extent: "parent",
					data: {
						id: nodeId,
						eclassId: eclassId,
						color: enodeIdentityColor,
						enodeColor: getColorForId(nodeId),
						args: argsForNode,
						label: labelForNode,
						visualState: visualState,
						nextVisualState: nextVisualState,
						progress: easedProgress, // Eased for color interpolation
						linearProgress: linearProgress, // Linear for opacity
						overrideOpacity: overrideOpacity,
					},
					style: `width: 50px; height: 50px; background: transparent; border: none; padding: 0;`,
					draggable: false,
				});

				renderedEdgeSources.push({
					nodeId,
					args: argsForNode,
					opacity: overrideOpacity ?? 1,
					eclassId,
				});
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

		for (const edgeSource of renderedEdgeSources) {
			const sourceId = `node-${edgeSource.nodeId}`;
			const sourceNode = nodeMap.get(sourceId);

			edgeSource.args.forEach((argClassId, argIndex) => {
				const canonicalArgId = canonicalOf(argClassId, true);
				const targetId =
					state.implementation === "deferred"
						? `set-${canonicalArgId}`
						: `class-${canonicalArgId}`;

				const targetNode = nodeMap.get(targetId);

				const targetHandle = sourceNode && targetNode
					? calculateTargetHandle(sourceNode, targetNode, nodeMap)
					: undefined;

				newEdges.push({
					id: `edge-${edgeId++}`,
					source: sourceId,
					target: targetId,
					sourceHandle: `port-${edgeSource.nodeId}-${argIndex}`,
					targetHandle: targetHandle,
					type: edgeType,
					animated: false,
					style: `stroke: #b1b1b7; opacity: ${edgeSource.opacity};`,
					markerEnd: {
						type: MarkerType.ArrowClosed,
						color: "#b1b1b7",
					},
				});
			});
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
