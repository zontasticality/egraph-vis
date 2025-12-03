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

	// Exponential ease-in: stays close to 0 until late in the transition
	// This makes transitions feel more responsive - they "stick" to current state longer
	function easeInExpo(t: number): number {
		if (t <= 0) return 0;
		if (t >= 1) return 1;
		// Exponential: 2^(10(t-1))
		// At t=0.5, this gives ~0.03 (still very close to start)
		// At t=0.8, this gives ~0.25
		// At t=0.95, this gives ~0.76
		return Math.pow(2, 10 * (t - 1));
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

		// Helper to get interpolated position
		// Positions are RELATIVE to parent, so we can interpolate everything safely
		// extent:"parent" only prevents dragging outside, not programmatic positioning
		const getPosition = (
			id: string,
			isEnode: boolean,
		): { x: number; y: number } => {
			if (isEnode) {
				const nodeId = parseInt(id.substring(5)); // "node-123" -> 123
				const currentPos = state.layout!.nodes.get(nodeId);
				if (!currentPos) return { x: 0, y: 0 };

				if (shouldInterpolate) {
					const nextPos = nextState.layout!.nodes.get(nodeId);
					if (nextPos) {
						return {
							x:
								currentPos.x +
								(nextPos.x - currentPos.x) * easedProgress,
							y:
								currentPos.y +
								(nextPos.y - currentPos.y) * easedProgress,
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
							x:
								currentPos.x +
								(nextPos.x - currentPos.x) * easedProgress,
							y:
								currentPos.y +
								(nextPos.y - currentPos.y) * easedProgress,
						};
					}
				}
				return currentPos;
			}
		};

		// Helper to get interpolated dimensions
		// Smoothly transitions width/height when e-classes grow or shrink
		const getDimensions = (
			id: string,
		): { width: number; height: number } => {
			const currentLayout = state.layout!.groups.get(id);
			if (!currentLayout) return { width: 100, height: 100 };

			if (shouldInterpolate) {
				const nextLayout = nextState.layout!.groups.get(id);
				if (nextLayout) {
					return {
						width:
							currentLayout.width +
							(nextLayout.width - currentLayout.width) *
								easedProgress,
						height:
							currentLayout.height +
							(nextLayout.height - currentLayout.height) *
								easedProgress,
					};
				}
			}
			return { width: currentLayout.width, height: currentLayout.height };
		};

		// Helper to interpolate colors using CSS color-mix
		const interpolateColor = (
			color1: string,
			color2: string,
			progress: number,
		): string => {
			if (progress <= 0.01) return color1;
			if (progress >= 0.99) return color2;

			// Convert progress to percentage
			const p1 = Math.round((1 - progress) * 100);
			const p2 = Math.round(progress * 100);

			// Use CSS color-mix for GPU-accelerated blending
			return `color-mix(in srgb, ${color1} ${p1}%, ${color2} ${p2}%)`;
		};

		// Helper to get interpolated e-class visual properties
		const getEClassVisuals = (
			eclassId: number,
		): { color: string; lightColor: string; opacity: number } => {
			const currentVisualState =
				state.visualStates?.eclasses.get(eclassId);
			const nextVisualState =
				nextState?.visualStates?.eclasses.get(eclassId);

			// Get base style from current visual state (fallback to Default)
			const baseStyle = currentVisualState
				? ECLASS_STYLES[currentVisualState.styleClass]
				: ECLASS_STYLES[0]; // Default style

			// Get next style if available
			const nextStyle = nextVisualState
				? ECLASS_STYLES[nextVisualState.styleClass]
				: null;

			// Determine if we can interpolate colors (need both states with different styles)
			const canInterpolate =
				shouldInterpolate &&
				currentVisualState &&
				nextVisualState &&
				nextStyle &&
				currentVisualState.styleClass !== nextVisualState.styleClass;

			const borderColor = canInterpolate
				? interpolateColor(
						baseStyle.borderColor!,
						nextStyle!.borderColor!,
						easedProgress,
					)
				: baseStyle.borderColor!;

			const backgroundColor = canInterpolate
				? interpolateColor(
						baseStyle.backgroundColor!,
						nextStyle!.backgroundColor!,
						easedProgress,
					)
				: baseStyle.backgroundColor!;

			const opacity =
				canInterpolate &&
				baseStyle.opacity !== undefined &&
				nextStyle!.opacity !== undefined
					? baseStyle.opacity +
						(nextStyle!.opacity - baseStyle.opacity) * easedProgress
					: (baseStyle.opacity ?? 1.0);

			return {
				color: borderColor,
				lightColor: backgroundColor,
				opacity,
			};
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
				const setPos = getPosition(setId, false); // Top-level, no parent
				const setDims = getDimensions(setId);

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
					const classPos = getPosition(classId, false); // Has parent (set)
					const classDims = getDimensions(classId);
					const classVisuals = getEClassVisuals(eclass.id);
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
						const nodePos = getPosition(nodeId, true); // Has parent (e-class)
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

			/* // If interpolating, also add new nodes from nextState that don't exist in currentState (fade-in)
			if (shouldInterpolate && nextState) {
				// Build set of existing node IDs
				const existingNodeIds = new Set<number>();
				for (const eclass of state.eclasses) {
					for (const node of eclass.nodes) {
						existingNodeIds.add(node.id);
					}
				}

				// Find new nodes in nextState
				const nextSets = new Map<number, typeof nextState.eclasses>();
				for (const eclass of nextState.eclasses) {
					const canonicalId =
						nextState.unionFind[eclass.id]?.canonical ?? eclass.id;
					if (!nextSets.has(canonicalId)) {
						nextSets.set(canonicalId, []);
					}
					nextSets.get(canonicalId)!.push(eclass);
				}

				for (const [canonicalId, eclassesInSet] of nextSets) {
					for (const eclass of eclassesInSet) {
						for (const enode of eclass.nodes) {
							if (!existingNodeIds.has(enode.id)) {
								// This node is new - create it with fade-in
								const nodeId = `node-${enode.id}`;
								const nodePos = getPosition(nodeId, true); // Has parent (e-class)
								const nextVisualState =
									nextState.visualStates?.nodes.get(enode.id);
								const enodeIdentityColor = getColorForId(
									eclass.id,
								);

								// Check if parent e-class and set exist in current rendering
								const classId = `class-${eclass.id}`;
								const setId = `set-${canonicalId}`;

								// Only add if parent exists (to avoid orphaned nodes)
								const parentExists = newNodes.some(
									(n) => n.id === classId,
								);
								if (parentExists) {
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
											visualState: undefined, // No current state
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
					}
				}
			} */
		} else {
			// Naive mode: just e-classes and e-nodes
			for (const eclass of state.eclasses) {
				const classId = `class-${eclass.id}`;
				const classPos = getPosition(classId, false); // Top-level, no parent
				const classDims = getDimensions(classId);
				const classVisuals = getEClassVisuals(eclass.id);

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
					const nodePos = getPosition(nodeId, true); // Has parent (e-class)
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

			/* // If interpolating, also add new nodes from nextState that don't exist in currentState (fade-in)
			if (shouldInterpolate && nextState) {
				// Build set of existing node IDs
				const existingNodeIds = new Set<number>();
				for (const eclass of state.eclasses) {
					for (const node of eclass.nodes) {
						existingNodeIds.add(node.id);
					}
				}

				// Find new nodes in nextState
				for (const eclass of nextState.eclasses) {
					for (const enode of eclass.nodes) {
						if (!existingNodeIds.has(enode.id)) {
							// This node is new - create it with fade-in
							const nodeId = `node-${enode.id}`;
							const nodePos = getPosition(nodeId, true); // Has parent (e-class)
							const nextVisualState = nextState.visualStates?.nodes.get(enode.id);
							const enodeIdentityColor = getColorForId(eclass.id);

							// Check if parent e-class exists in current rendering
							const classId = `class-${eclass.id}`;
							const parentExists = newNodes.some(n => n.id === classId);

							if (parentExists) {
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
										visualState: undefined, // No current state
										nextVisualState: nextVisualState,
										progress: easedProgress, // Eased for color interpolation
										linearProgress: linearProgress // Linear for opacity
									},
									style: `width: 50px; height: 50px; background: transparent; border: none; padding: 0;`,
									draggable: false
								});
							}
						}
					}
				}
			} */
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
	$: updateLayout(
		$scrubData.currentState,
		$scrubData.nextState,
		$scrubData.progress,
	);
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
