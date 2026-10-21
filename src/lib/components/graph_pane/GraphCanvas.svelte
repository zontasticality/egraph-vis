<script lang="ts">
    import { onDestroy } from "svelte";
    import {
        scrubData,
        timeline,
        layoutVersion,
        engineError,
    } from "../../stores/timelineStore";
    import { interactionStore } from "../../stores/interactionStore";
    import { layoutManager } from "../../engine/layout";
    import {
        buildFrame,
        type Frame,
        type FrameNode,
        type FrameClass,
        type EdgeRouting,
    } from "../../graph/frame";
    import {
        fitViewport,
        zoomAt,
        needsRefit,
        lerpViewport,
        viewportEquals,
        type Viewport,
    } from "../../graph/viewport";
    import { portOffset, unionRects } from "../../graph/geometry";
    import { getColorForId } from "../../utils/colors";
    import {
        EDGE_COLORS,
        SET_STYLE,
        NODE_STYLES,
        ECLASS_STYLES,
    } from "../../engine/visualStyles";
    import { NodeStyleClass, EClassStyleClass } from "../../engine/types";
    import type { EGraphTimeline, Rect } from "../../engine/types";
    import GraphLegend from "./GraphLegend.svelte";

    export let routing: EdgeRouting = "SPLINES";

    let width = 0;
    let height = 0;
    let viewport: Viewport = { x: 0, y: 0, k: 1 };
    let cameraTarget: Viewport | null = null;
    let cameraFrame: number | null = null;
    let follow = true;
    let fittedTimeline: EGraphTimeline | null = null;
    let lastFrame: Frame | null = null;
    let lastFrameTimeline: EGraphTimeline | null = null;
    let waitingForLayout = false;
    let hoveredNode: FrameNode | null = null;
    let hoveredBox: FrameClass | null = null;
    let tooltip = { x: 0, y: 0 };

    // ─── Frame ──────────────────────────────────────────────────────────
    $: frame = computeFrame($scrubData, $timeline, $layoutVersion, routing);

    function computeFrame(
        s: typeof $scrubData,
        tl: EGraphTimeline | null,
        _version: number,
        edgeRouting: EdgeRouting,
    ): Frame | null {
        if (!s.currentState) {
            lastFrame = null;
            waitingForLayout = false;
            return null;
        }
        const la = layoutManager.getLayout(s.currentIndex);
        if (!la) {
            waitingForLayout = true;
            // Never keep showing (and accepting clicks on) another timeline's frame
            return lastFrameTimeline === tl ? lastFrame : null;
        }
        let next = null;
        if (s.nextState && s.progress > 0) {
            const lb = layoutManager.getLayout(s.nextIndex);
            if (lb) next = { state: s.nextState, layout: lb };
        }
        waitingForLayout = !!s.nextState && s.progress > 0 && !next;
        const f = buildFrame(
            { state: s.currentState, layout: la },
            next,
            next ? s.progress : 0,
            edgeRouting,
        );
        lastFrame = f;
        lastFrameTimeline = tl;
        return f;
    }

    // ─── Camera ─────────────────────────────────────────────────────────
    // Bounds of both endpoints of the current transition, so the camera
    // settles once per step instead of chasing the animation.
    $: cameraBounds = computeCameraBounds(
        $scrubData.currentIndex,
        $scrubData.nextIndex,
        $scrubData.progress > 0,
        $layoutVersion,
    );

    function computeCameraBounds(
        a: number,
        b: number,
        moving: boolean,
        _version: number,
    ): Rect | null {
        const la = layoutManager.getLayout(a);
        if (!la) return null;
        const lb = moving ? layoutManager.getLayout(b) : undefined;
        return unionRects(lb ? [la.bounds, lb.bounds] : [la.bounds]) ?? null;
    }

    $: if (cameraBounds && width > 0 && height > 0) {
        if ($timeline !== fittedTimeline) {
            // New timeline: jump straight to a fitted view
            fittedTimeline = $timeline;
            follow = true;
            stopCamera();
            viewport = fitViewport(cameraBounds, width, height);
        } else if (follow) {
            const ref = cameraTarget ?? viewport;
            if (needsRefit(ref, cameraBounds, width, height)) {
                animateCamera(fitViewport(cameraBounds, width, height));
            }
        }
    }

    function animateCamera(to: Viewport) {
        cameraTarget = to;
        if (cameraFrame !== null) return;
        const step = () => {
            if (!cameraTarget) {
                cameraFrame = null;
                return;
            }
            viewport = lerpViewport(viewport, cameraTarget, 0.16);
            if (viewportEquals(viewport, cameraTarget)) {
                viewport = cameraTarget;
                cameraTarget = null;
                cameraFrame = null;
                return;
            }
            cameraFrame = requestAnimationFrame(step);
        };
        cameraFrame = requestAnimationFrame(step);
    }

    function stopCamera() {
        if (cameraFrame !== null) cancelAnimationFrame(cameraFrame);
        cameraFrame = null;
        cameraTarget = null;
    }

    onDestroy(stopCamera);

    function fitNow() {
        follow = true;
        const b = cameraBounds ?? frame?.bounds;
        if (b) animateCamera(fitViewport(b, width, height));
    }

    function zoomBy(factor: number) {
        follow = false;
        stopCamera();
        viewport = zoomAt(viewport, factor, width / 2, height / 2);
    }

    // ─── Pan & zoom input ───────────────────────────────────────────────
    let container: HTMLDivElement;
    let drag: { x: number; y: number; vx: number; vy: number; id: number } | null =
        null;
    let didPan = false;

    function handleWheel(e: WheelEvent) {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
        const factor = Math.exp(-e.deltaY * unit * 0.0015);
        follow = false;
        stopCamera();
        viewport = zoomAt(
            viewport,
            factor,
            e.clientX - rect.left,
            e.clientY - rect.top,
        );
    }

    function handlePointerDown(e: PointerEvent) {
        if (e.button !== 0) return;
        drag = {
            x: e.clientX,
            y: e.clientY,
            vx: viewport.x,
            vy: viewport.y,
            id: e.pointerId,
        };
        didPan = false;
    }

    function handlePointerMove(e: PointerEvent) {
        if (drag && e.pointerId === drag.id) {
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;
            if (!didPan && Math.hypot(dx, dy) > 4) {
                didPan = true;
                follow = false;
                stopCamera();
                container.setPointerCapture(e.pointerId);
            }
            if (didPan) {
                viewport = { ...viewport, x: drag.vx + dx, y: drag.vy + dy };
            }
        }
        if (hoveredNode || hoveredBox) {
            const rect = container.getBoundingClientRect();
            tooltip = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }
    }

    function handlePointerUp(e: PointerEvent) {
        if (drag && e.pointerId === drag.id) {
            if (container.hasPointerCapture(e.pointerId)) {
                container.releasePointerCapture(e.pointerId);
            }
            drag = null;
        }
    }

    // ─── Selection & hover ──────────────────────────────────────────────
    function handleBackgroundClick() {
        if (didPan) return;
        interactionStore.clearSelection();
    }

    function handleNodeClick(e: MouseEvent, id: number) {
        e.stopPropagation();
        if (didPan) return;
        interactionStore.selectENode(id);
    }

    function handleClassClick(e: MouseEvent, id: number) {
        e.stopPropagation();
        if (didPan || !frame) return;
        interactionStore.selectEClass(
            frame.nodes.filter((n) => n.classId === id).map((n) => n.id),
        );
    }

    function enterClass(e: PointerEvent, c: FrameClass) {
        hoveredBox = c;
        const rect = container.getBoundingClientRect();
        tooltip = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        interactionStore.hover({ type: "eclass", id: c.canonical });
    }

    function enterNode(e: PointerEvent, n: FrameNode) {
        hoveredNode = n;
        hoveredBox = null;
        const rect = container.getBoundingClientRect();
        tooltip = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        interactionStore.hover({ type: "enode", id: n.id });
    }

    function leave() {
        hoveredNode = null;
        hoveredBox = null;
        interactionStore.clearHover();
    }

    // Level of detail: labels are unreadable (and costly) when zoomed far out
    $: detailed = viewport.k >= 0.35;

    // Canonical ids as drawn in the current frame (it may already show the next snapshot)
    $: frameCanonical = new Map(frame?.classes.map((c) => [c.id, c.canonical]) ?? []);
    $: canonicalOf = (id: number) =>
        frameCanonical.get(id) ?? $scrubData.currentState?.unionFind[id]?.canonical ?? id;
    $: hover = $interactionStore.hover;
    $: selection = $interactionStore.selection;
    $: hoveredClass =
        hover?.type === "eclass"
            ? hover.id
            : hover?.type === "match"
              ? hover.eclass
              : null;
    $: hoveredMatch = hover?.type === "match" ? new Set(hover.nodes) : null;
    $: hoveredSource = hover?.type === "enode" ? hover.id : null;

    function classHighlighted(id: number, canonical: number): boolean {
        return hoveredClass !== null && (canonical === hoveredClass || id === hoveredClass);
    }

    function edgeHighlighted(target: number, source: number): boolean {
        if (hoveredSource !== null) return source === hoveredSource;
        if (hoveredMatch) return hoveredMatch.has(source);
        if (hoveredClass === null) return false;
        return target === hoveredClass || canonicalOf(target) === hoveredClass;
    }

    function labelWidth(text: string): number {
        return text.length * 6.6 + 10;
    }

    $: styleLabel = (n: FrameNode) => NODE_STYLES[n.style].label;
    $: hoveredInfo = hoveredNode
        ? {
              node: hoveredNode,
              stale: hoveredNode.args.some((a, i) => hoveredNode!.argCanonical[i] !== a),
          }
        : null;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    class="graph-canvas"
    bind:this={container}
    bind:clientWidth={width}
    bind:clientHeight={height}
    class:panning={didPan && drag}
    style:background-size="{24 * viewport.k}px {24 * viewport.k}px"
    style:background-position="{viewport.x}px {viewport.y}px"
    on:wheel={handleWheel}
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={handlePointerUp}
    on:pointercancel={handlePointerUp}
    on:click={handleBackgroundClick}
>
    {#if frame}
        <svg
            {width}
            {height}
            role="img"
            aria-label="E-graph with {frame.classes.length} e-classes and {frame
                .nodes.length} e-nodes"
        >
            <defs>
                {#each [["normal", EDGE_COLORS.normal], ["stale", EDGE_COLORS.stale], ["hl", EDGE_COLORS.highlight]] as [name, color]}
                    <marker
                        id="arrow-{name}"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                    >
                        <path d="M 0 1 L 9 5 L 0 9 z" fill={color} />
                    </marker>
                {/each}
            </defs>

            <g
                transform="translate({viewport.x} {viewport.y}) scale({viewport.k})"
            >
                <!-- Union-find sets (deferred mode, pending compaction) -->
                {#each frame.sets as s (s.id)}
                    <g class="uf-set" opacity={s.opacity}>
                        <rect
                            x={s.rect.x}
                            y={s.rect.y}
                            width={s.rect.width}
                            height={s.rect.height}
                            rx="14"
                            fill={SET_STYLE.fill}
                            stroke={SET_STYLE.stroke}
                            stroke-width="1.5"
                        />
                        {#if detailed}
                            <text
                                class="set-label"
                                x={s.rect.x + 10}
                                y={s.rect.y + 15}
                                >≡ set {s.id}</text
                            >
                        {/if}
                        <title
                            >Union-find set {s.id}: e-classes {s.members.join(
                                ", ",
                            )} are equal but not yet compacted</title
                        >
                    </g>
                {/each}

                <!-- E-classes -->
                {#each frame.classes as c (c.id)}
                    {@const merged = c.style === EClassStyleClass.Merged}
                    {@const hl = classHighlighted(c.id, c.canonical)}
                    {@const label = merged ? `${c.id}→${c.canonical}` : `${c.id}`}
                    <g
                        class="eclass"
                        opacity={c.opacity}
                        on:click={(e) => handleClassClick(e, c.id)}
                        on:pointerenter={(e) => enterClass(e, c)}
                        on:pointerleave={leave}
                    >
                        <rect
                            x={c.rect.x}
                            y={c.rect.y}
                            width={c.rect.width}
                            height={c.rect.height}
                            rx="10"
                            fill={c.fill}
                            stroke={hl ? EDGE_COLORS.highlight : c.stroke}
                            stroke-width={hl ? 2.5 : c.strokeWidth}
                            stroke-dasharray={c.dashed && !hl ? "6 4" : null}
                        />
                        {#if detailed}
                            <rect
                                class="class-pill"
                                x={c.rect.x + 6}
                                y={c.rect.y + 5}
                                width={labelWidth(label)}
                                height="14"
                                rx="7"
                                fill="white"
                                stroke={getColorForId(c.canonical)}
                            />
                            <text
                                class="class-label"
                                x={c.rect.x + 6 + labelWidth(label) / 2}
                                y={c.rect.y + 12.5}
                                fill={getColorForId(c.canonical)}>{label}</text
                            >
                        {/if}
                        {#if detailed && c.style === EClassStyleClass.InWorklist}
                            <circle
                                cx={c.rect.x + 6 + labelWidth(label) + 7}
                                cy={c.rect.y + 12}
                                r="3.5"
                                fill="#38bdf8"
                            >
                                <title>In the worklist</title>
                            </circle>
                        {/if}
                    </g>
                {/each}

                <!-- Edges: argument port → e-class -->
                {#each frame.edges as e (e.key)}
                    {@const hl = edgeHighlighted(e.target, e.source)}
                    <path
                        class="edge"
                        d={e.d}
                        stroke={hl ? EDGE_COLORS.highlight : e.color}
                        stroke-width={hl ? 2.2 : 1.4}
                        stroke-dasharray={e.stale ? "5 4" : null}
                        opacity={e.opacity}
                        marker-end="url(#arrow-{hl
                            ? 'hl'
                            : e.stale
                              ? 'stale'
                              : 'normal'})"
                    />
                {/each}

                <!-- E-nodes -->
                {#each frame.nodes as n (n.id)}
                    {@const selected = selection?.nodeIds.has(n.id) ?? false}
                    {@const matched = hoveredMatch?.has(n.id) ?? false}
                    <g
                        class="enode"
                        transform="translate({n.rect.x} {n.rect.y})"
                        opacity={n.opacity}
                        on:click={(e) => handleNodeClick(e, n.id)}
                        on:pointerenter={(e) => enterNode(e, n)}
                        on:pointerleave={leave}
                    >
                        <rect
                            width={n.rect.width}
                            height={n.rect.height}
                            rx="7"
                            fill={n.fill}
                            stroke={selected || matched ? EDGE_COLORS.highlight : n.stroke}
                            stroke-width={selected || matched ? 2.5 : 1.5}
                            class:match-glow={matched}
                            stroke-dasharray={n.dashed ? "4 3" : null}
                        />
                        {#if detailed}
                            <text
                                class="op"
                                x={n.rect.width / 2}
                                y={n.rect.height / 2}
                                fill={n.text}>{n.op}</text
                            >
                            {#each n.args as arg, i}
                                <circle
                                    cx={portOffset(n.rect.width, n.args.length, i)}
                                    cy={n.rect.height}
                                    r="2.6"
                                    fill={n.argCanonical[i] !== arg
                                        ? EDGE_COLORS.stale
                                        : "#64748b"}
                                />
                            {/each}
                        {/if}
                    </g>
                {/each}
            </g>
        </svg>
    {/if}

    {#if $engineError}
        <div class="overlay error">
            <strong>Engine error</strong>
            <span>{$engineError}</span>
        </div>
    {:else if !frame && $timeline}
        <div class="overlay">
            <div class="spinner"></div>
            <span>Computing layout…</span>
        </div>
    {:else if waitingForLayout}
        <div class="layout-chip"><span class="mini-spinner"></span>Laying out…</div>
    {/if}

    <div class="toolbar" on:click|stopPropagation on:pointerdown|stopPropagation>
        <button title="Zoom in" aria-label="Zoom in" on:click={() => zoomBy(1.25)}
            >+</button
        >
        <button
            title="Zoom out"
            aria-label="Zoom out"
            on:click={() => zoomBy(0.8)}>−</button
        >
        <button
            title={follow
                ? "Following the graph (pan or zoom to stop)"
                : "Fit graph and follow it"}
            aria-label="Fit graph"
            class:active={follow}
            on:click={fitNow}
        >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                ><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg
            >
        </button>
    </div>

    <div class="legend-slot" on:click|stopPropagation on:pointerdown|stopPropagation>
        <GraphLegend implementation={$timeline?.implementation ?? "deferred"} />
    </div>

    {#if hoveredBox && !hoveredNode}
        {@const count = frame?.nodes.filter((n) => n.classId === hoveredBox?.id).length ?? 0}
        <div
            class="tooltip"
            style:left="{tooltip.x + 14}px"
            style:top="{tooltip.y + 14}px"
        >
            <div class="tt-title">
                e-class <b style:color={getColorForId(hoveredBox.canonical)}>{hoveredBox.id}</b>
                · {count} e-node{count === 1 ? "" : "s"}
            </div>
            {#if hoveredBox.style !== EClassStyleClass.Default}
                <div class="tt-row tt-state">
                    {ECLASS_STYLES[hoveredBox.style].label}: {ECLASS_STYLES[hoveredBox.style].description}
                </div>
            {/if}
            {#if hoveredBox.canonical !== hoveredBox.id}
                <div class="tt-row tt-stale">unioned into e-class {hoveredBox.canonical}</div>
            {/if}
        </div>
    {/if}

    {#if hoveredInfo}
        <div
            class="tooltip"
            style:left="{tooltip.x + 14}px"
            style:top="{tooltip.y + 14}px"
        >
            <div class="tt-title">
                <code>{hoveredInfo.node.op}({hoveredInfo.node.args.join(", ")})</code>
            </div>
            <div class="tt-row">
                e-node <b>#{hoveredInfo.node.id}</b> in e-class
                <b style:color={getColorForId(canonicalOf(hoveredInfo.node.classId))}
                    >{hoveredInfo.node.classId}</b
                >
            </div>
            {#if hoveredInfo.node.style !== NodeStyleClass.Default}
                <div class="tt-row tt-state">{styleLabel(hoveredInfo.node)}: {NODE_STYLES[hoveredInfo.node.style].description}</div>
            {/if}
            {#if hoveredInfo.stale}
                <div class="tt-row tt-stale">
                    children {hoveredInfo.node.args
                        .map((a, i) => [a, hoveredInfo.node.argCanonical[i]])
                        .filter(([a, c]) => a !== c)
                        .map(([a, c]) => `${a}→${c}`)
                        .join(", ")} are not canonical yet
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .graph-canvas {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background-color: #f8fafc;
        background-image: radial-gradient(circle, #d7dde6 1px, transparent 1.2px);
        cursor: grab;
        touch-action: none;
        user-select: none;
    }

    .graph-canvas.panning {
        cursor: grabbing;
    }

    svg {
        display: block;
    }

    .eclass,
    .enode {
        cursor: pointer;
    }

    .edge {
        fill: none;
        pointer-events: none;
    }

    .class-label {
        font: 600 10px ui-sans-serif, system-ui, sans-serif;
        text-anchor: middle;
        dominant-baseline: middle;
        pointer-events: none;
    }

    .class-pill {
        stroke-width: 1.2;
        pointer-events: none;
    }

    .set-label {
        font: 700 10.5px ui-sans-serif, system-ui, sans-serif;
        fill: #7c3aed;
        letter-spacing: 0.02em;
        pointer-events: none;
    }

    .op {
        font: 700 14px ui-monospace, "SFMono-Regular", Menlo, monospace;
        text-anchor: middle;
        dominant-baseline: central;
        pointer-events: none;
    }

    .match-glow {
        filter: drop-shadow(0 0 4px rgba(37, 99, 235, 0.65));
    }

    .enode:hover rect {
        filter: drop-shadow(0 1px 3px rgba(15, 23, 42, 0.25));
    }

    .toolbar {
        position: absolute;
        top: 10px;
        left: 10px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        z-index: 5;
    }

    .toolbar button {
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 7px;
        border: 1px solid #d1d5db;
        background: white;
        color: #374151;
        font-size: 17px;
        line-height: 1;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
    }

    .toolbar button:hover {
        background: #f3f4f6;
    }

    .toolbar button.active {
        color: #2563eb;
        border-color: #93c5fd;
        background: #eff6ff;
    }

    .legend-slot {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 5;
    }

    .overlay {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        color: #374151;
        font-size: 0.9rem;
        background: rgba(248, 250, 252, 0.8);
        z-index: 6;
    }

    .overlay.error {
        color: #b91c1c;
        padding: 2rem;
        text-align: center;
    }

    .spinner {
        width: 34px;
        height: 34px;
        border: 4px solid #e5e7eb;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
    }

    .layout-chip {
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        font-size: 0.75rem;
        color: #475569;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 999px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        z-index: 5;
    }

    .mini-spinner {
        width: 10px;
        height: 10px;
        border: 2px solid #cbd5e1;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .tooltip {
        position: absolute;
        z-index: 10;
        pointer-events: none;
        max-width: 280px;
        padding: 7px 9px;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 7px;
        font-size: 0.75rem;
        line-height: 1.45;
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.25);
    }

    .tt-title code {
        font-family: ui-monospace, Menlo, monospace;
        font-weight: 700;
        color: white;
    }

    .tt-row b {
        color: white;
    }

    .tt-state {
        color: #fde68a;
    }

    .tt-stale {
        color: #fdba74;
    }
</style>
