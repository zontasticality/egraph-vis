<script lang="ts">
	import {
		currentState,
		currentIndex,
		timeline,
	} from "../../stores/timelineStore";
	import { interactionStore } from "../../stores/interactionStore";
	import ENode from "./ENode.svelte";
	import { NodeStyleClass } from "../../engine/types";
	import type {
		EClassViewModel,
		EGraphState,
		MatchEvent,
	} from "../../engine/types";

	const MAX_ROWS = 400;

	/**
	 * Scroll an element into view within its panel when `active` becomes true.
	 * (scrollIntoView would also scroll overflow-hidden ancestors of the app.)
	 */
	function revealWhen(node: HTMLElement, active: boolean) {
		const run = (on: boolean) => {
			if (!on) return;
			const panel = node.closest<HTMLElement>(".panel-body");
			if (!panel) return;
			const p = panel.getBoundingClientRect();
			const r = node.getBoundingClientRect();
			if (r.top < p.top) panel.scrollTop += r.top - p.top - 4;
			else if (r.bottom > p.bottom) panel.scrollTop += r.bottom - p.bottom + 4;
		};
		run(active);
		return { update: run };
	}

	$: state = $currentState;
	$: prev =
		$timeline && $currentIndex > 0
			? $timeline.states[$currentIndex - 1]
			: null;
	$: deferred = state?.implementation === "deferred";
	$: phase = state?.phase;
	$: meta = state?.metadata;

	// ── E-classes, grouped by union-find set ────────────────────────────
	$: groups = (() => {
		const map = new Map<number, EClassViewModel[]>();
		if (!state) return [];
		for (const eclass of state.eclasses) {
			const canonical = state.unionFind[eclass.id]?.canonical ?? eclass.id;
			if (!map.has(canonical)) map.set(canonical, []);
			map.get(canonical)!.push(eclass);
		}
		return Array.from(map.entries()).map(([canonical, classes]) => ({
			canonical,
			classes,
		}));
	})();
	$: nodeCount = state?.eclasses.reduce((n, c) => n + c.nodes.length, 0) ?? 0;
	$: batchClasses = new Set(meta?.batch?.classIds ?? []);
	$: worklist = new Set(state?.worklist ?? []);
	$: selectedIds = $interactionStore.selection?.nodeIds;

	const styleOf = (s: EGraphState, id: number) =>
		s.visualStates.nodes.get(id)?.styleClass ?? NodeStyleClass.Default;

	// ── Hashcons with per-step changes ─────────────────────────────────
	$: prevHashcons = new Map(prev?.hashcons.map((h) => [h.key, h.eclass]) ?? []);
	$: hashconsChanged = (key: string, eclass: number) =>
		!!prev && prevHashcons.get(key) !== eclass;

	// ── Union-find: non-trivial sets ────────────────────────────────────
	$: ufSets = (() => {
		if (!state) return [];
		const sets = new Map<number, number[]>();
		for (const e of state.unionFind) {
			if (!e || e.isCanonical) continue;
			if (!sets.has(e.canonical)) sets.set(e.canonical, []);
			sets.get(e.canonical)!.push(e.id);
		}
		return Array.from(sets.entries()).sort((a, b) => a[0] - b[0]);
	})();
	$: ufChanged = (canonical: number, members: number[]) =>
		!!prev &&
		members.some((m) => prev!.unionFind[m]?.canonical !== canonical);
	$: canonicalCount = state?.unionFind.filter((e) => e?.isCanonical).length ?? 0;

	// ── Writelist (deferred) / matches (naive) ──────────────────────────
	$: writelist = meta?.writelist;
	$: wlEntries = writelist ? writelist.entries.slice(0, writelist.count) : [];
	$: currentEntry =
		phase === "write" && writelist ? writelist.nextIndex - 1 : -1;
	$: batchEntryStart =
		phase === "read-batch" && writelist
			? writelist.count - (meta?.matches.length ?? 0)
			: Infinity;

	// Naive mode: show the matches of the iteration's read phase
	$: naiveMatches = (() => {
		if (!state || deferred || !$timeline) return [] as MatchEvent[];
		for (let i = $currentIndex; i >= 0; i--) {
			const s = $timeline.states[i];
			if (s.phase === "read") return s.metadata.matches;
			if (s.phase === "init") break;
		}
		return [] as MatchEvent[];
	})();
	$: appliedRule = phase === "write" ? meta?.applied : undefined;

	/** Highlight a match's LHS e-nodes and its e-class in the graph. */
	function hoverMatch(nodes: number[], eclass: number) {
		interactionStore.hover({ type: "match", nodes, eclass });
	}
</script>

<div class="state-pane">
	{#if !state}
		<div class="empty">No state loaded</div>
	{:else}
		<div class="panel-grid">
			<!-- E-Classes -->
			<section class="panel classes">
				<header>
					<h3>E-Classes <span class="count">{state.eclasses.length}</span></h3>
					<span class="sub">{nodeCount} e-nodes</span>
				</header>
				<div class="panel-body">
					{#each groups as group (group.canonical)}
						{@const multi = group.classes.length > 1}
						<div class="set-block" class:multi>
							{#if multi}
								<div class="set-title" title="Unioned in the union-find but not yet compacted">
									≡ set <ENode id={group.canonical} />
								</div>
							{/if}
							{#each group.classes as eclass (eclass.id)}
								{@const isCanonical = eclass.id === group.canonical}
								{@const active = meta?.activeId === eclass.id && (phase === "compact" || phase === "repair")}
								{@const compacting = phase === "compact" && meta?.compactedId === eclass.id}
								{@const selected = !!selectedIds && eclass.nodes.some((n) => selectedIds?.has(n.id))}
								<div
									class="eclass-row"
									class:merged={!isCanonical}
									class:active
									class:compacting
									class:in-batch={batchClasses.has(eclass.id)}
									class:selected
									use:revealWhen={active}
								>
									<div class="eclass-id">
										<ENode id={eclass.id} />
										{#if !isCanonical}<span class="tag merged-tag">→ {group.canonical}</span>{/if}
										{#if worklist.has(eclass.id)}<span class="wl-dot" title="In the worklist"></span>{/if}
									</div>
									<div class="eclass-nodes">
										{#each eclass.nodes as node (node.id)}
											<ENode id={node.id} mode="symbol" {node} styleClass={styleOf(state, node.id)} />
										{/each}
									</div>
								</div>
							{/each}
						</div>
					{/each}
				</div>
			</section>

			<!-- Hashcons -->
			<section class="panel hashcons">
				<header>
					<h3 title="Canonical e-node → e-class">Hashcons <span class="count">{state.hashcons.length}</span></h3>
					{#if !meta?.invariants.hashconsValid}
						<span class="sub warn" title="Some keys are stale until rebuilding finishes">stale keys</span>
					{/if}
				</header>
				<div class="panel-body">
					{#each state.hashcons.slice(0, MAX_ROWS) as h (h.key)}
						<div class="hc-row" class:changed={hashconsChanged(h.key, h.eclass)}>
							<span class="hc-key"
								><b>{h.op}</b>{#if h.args.length}({#each h.args as a, i}<ENode id={a} />{#if i < h.args.length - 1},{/if}{/each}){/if}</span
							>
							<span class="arrow">→</span>
							<ENode id={h.eclass} />
						</div>
					{/each}
					{#if state.hashcons.length > MAX_ROWS}
						<div class="more">…and {state.hashcons.length - MAX_ROWS} more</div>
					{/if}
				</div>
			</section>

			<!-- Union-Find -->
			<section class="panel unionfind">
				<header>
					<h3 title="Every id points to its canonical representative">Union-Find</h3>
					<span class="sub">{state.unionFind.length} ids · {canonicalCount} canonical</span>
				</header>
				<div class="panel-body">
					{#if ufSets.length === 0}
						<div class="empty-message">Every id is its own canonical id</div>
					{:else}
						{#each ufSets as [canonical, members] (canonical)}
							<div class="uf-row" class:changed={ufChanged(canonical, members)}>
								<ENode id={canonical} />
								<span class="arrow">←</span>
								<span class="uf-members">
									{#each members as m (m)}<ENode id={m} />{/each}
								</span>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<!-- Writelist (deferred) / matches (naive) -->
			<section class="panel writelist">
				{#if deferred}
					<header>
						<h3 title="Matches found by the read phase, applied in order by the write phase">
							Writelist <span class="count">{wlEntries.length}</span>
						</h3>
						{#if writelist && phase === "write"}
							<span class="sub">applied {writelist.nextIndex}/{writelist.count}</span>
						{/if}
					</header>
					<div class="panel-body">
						{#if wlEntries.length === 0}
							<div class="empty-message">
								{phase === "read-batch" ? "No matches yet" : "Empty — filled by the next read phase"}
							</div>
						{:else}
							{#each wlEntries.slice(0, MAX_ROWS) as entry, i (i)}
								{@const status = !writelist || phase !== "write" ? (i >= batchEntryStart ? "new" : "pending") : i === currentEntry ? "current" : i < writelist.nextIndex ? "done" : "pending"}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="wl-row {status}"
									use:revealWhen={status === "current"}
									on:mouseenter={() => hoverMatch(entry.lhsNodes, entry.targetClass)}
									on:mouseleave={() => interactionStore.clearHover()}
								>
									<span class="wl-index">{i + 1}</span>
									<span class="wl-rule">{entry.ruleName}</span>
									<span class="wl-at">@</span>
									<ENode id={entry.targetClass} />
								</div>
							{/each}
							{#if wlEntries.length > MAX_ROWS}
								<div class="more">…and {wlEntries.length - MAX_ROWS} more</div>
							{/if}
						{/if}
					</div>
				{:else}
					<header>
						<h3 title="Matches found by the last read phase">Matches <span class="count">{naiveMatches.length}</span></h3>
					</header>
					<div class="panel-body">
						{#if naiveMatches.length === 0}
							<div class="empty-message">No matches</div>
						{:else}
							{#each naiveMatches.slice(0, MAX_ROWS) as m, i (i)}
								{@const current = !!appliedRule && appliedRule.rule === m.rule && appliedRule.lhsNodes[0] === m.nodes[0]}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="wl-row"
									class:current
									use:revealWhen={current}
									on:mouseenter={() => hoverMatch(m.nodes, m.eclassId)}
									on:mouseleave={() => interactionStore.clearHover()}
								>
									<span class="wl-index">{i + 1}</span>
									<span class="wl-rule">{m.rule}</span>
									<span class="wl-at">@</span>
									<ENode id={m.eclassId} />
								</div>
							{/each}
						{/if}
					</div>
				{/if}
			</section>

			<!-- Worklist -->
			<section class="panel worklist">
				<header>
					<h3 title="E-classes whose parents must be repaired">Worklist <span class="count">{state.worklist.length}</span></h3>
				</header>
				<div class="panel-body wl-chips">
					{#if state.worklist.length === 0}
						<div class="empty-message">{phase === "repair" || phase === "done" || phase === "read" || phase === "read-batch" ? "Empty — invariants hold" : "Empty"}</div>
					{:else}
						{#each state.worklist as eclassId (eclassId)}
							<ENode id={eclassId} />
						{/each}
					{/if}
				</div>
			</section>
		</div>
	{/if}
</div>

<style>
	.state-pane {
		height: 100%;
		width: 100%;
		background: #ffffff;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: #6b7280;
		font-size: 14px;
	}

	.panel-grid {
		display: grid;
		grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
		grid-template-rows: minmax(0, 1.25fr) minmax(0, 0.75fr) minmax(0, 0.9fr);
		grid-template-areas:
			"classes hashcons"
			"classes unionfind"
			"writelist worklist";
		height: 100%;
	}

	.classes {
		grid-area: classes;
	}
	.hashcons {
		grid-area: hashcons;
	}
	.unionfind {
		grid-area: unionfind;
	}
	.writelist {
		grid-area: writelist;
	}
	.worklist {
		grid-area: worklist;
	}

	.panel {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
		border-bottom: 1px solid #e5e7eb;
	}

	.classes,
	.writelist {
		border-right: 1px solid #e5e7eb;
	}

	.panel header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		padding: 6px 10px;
		background: #f9fafb;
		border-bottom: 1px solid #e5e7eb;
		flex-shrink: 0;
	}

	.panel h3 {
		margin: 0;
		font-size: 12.5px;
		font-weight: 650;
		color: #111827;
		white-space: nowrap;
	}

	.count {
		display: inline-block;
		margin-left: 3px;
		padding: 0 6px;
		border-radius: 999px;
		background: #e5e7eb;
		color: #374151;
		font-size: 10.5px;
		font-weight: 600;
	}

	.sub {
		font-size: 11px;
		color: #9ca3af;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sub.warn {
		color: #ea580c;
	}

	.panel-body {
		flex: 1;
		overflow: auto;
		padding: 4px;
		min-height: 0;
	}

	/* E-classes */
	.set-block.multi {
		margin: 4px 2px 6px;
		border: 1.5px solid #c4b5fd;
		background: #faf5ff;
		border-radius: 8px;
		overflow: hidden;
	}

	.set-title {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 3px 8px;
		font-size: 10.5px;
		font-weight: 700;
		color: #7c3aed;
	}

	.eclass-row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 4px 6px;
		border-radius: 6px;
		border-left: 3px solid transparent;
		transition: background 0.15s;
	}

	.eclass-row:hover {
		background: #f8fafc;
	}

	.eclass-row.merged {
		background: #fff7ed;
		border-left-color: #fb923c;
	}

	.eclass-row.in-batch {
		background: #fffbeb;
		border-left-color: #fbbf24;
	}

	.eclass-row.active {
		background: #eff6ff;
		border-left-color: #2563eb;
	}

	.eclass-row.compacting {
		background: #ffedd5;
		border-left-color: #ea580c;
	}

	.eclass-row.selected {
		box-shadow: inset 0 0 0 1.5px #93c5fd;
	}

	.eclass-id {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		min-width: 34px;
		padding-top: 1px;
	}

	.tag {
		font-size: 10px;
		font-weight: 600;
		white-space: nowrap;
	}

	.merged-tag {
		color: #c2410c;
	}

	.wl-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #38bdf8;
	}

	.eclass-nodes {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		min-width: 0;
	}

	/* Hashcons & union-find */
	.hc-row,
	.uf-row {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 2px 6px;
		font-size: 11.5px;
		border-radius: 5px;
		transition: background 0.2s;
	}

	.hc-key {
		display: inline-flex;
		align-items: center;
		gap: 1px;
		font-family: ui-monospace, Menlo, monospace;
		color: #374151;
		white-space: nowrap;
	}

	.hc-key b {
		margin-right: 1px;
	}

	.hc-row.changed,
	.uf-row.changed {
		background: #fef3c7;
	}

	.arrow {
		color: #9ca3af;
		font-size: 11px;
	}

	.uf-members {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
	}

	/* Writelist */
	.wl-row {
		cursor: default;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 6px;
		font-size: 11.5px;
		border-radius: 5px;
	}

	.wl-index {
		min-width: 22px;
		text-align: right;
		color: #9ca3af;
		font-variant-numeric: tabular-nums;
		font-size: 10.5px;
	}

	.wl-rule {
		font-weight: 600;
		color: #374151;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.wl-at {
		color: #9ca3af;
	}

	.wl-row.done {
		opacity: 0.45;
	}

	.wl-row.new {
		background: #fffbeb;
	}

	.wl-row.current {
		background: #ffe4e6;
		box-shadow: inset 3px 0 0 #e11d48;
	}

	.wl-chips {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		gap: 4px;
		padding: 6px 8px;
	}

	.empty-message,
	.more {
		padding: 10px 8px;
		text-align: center;
		color: #9ca3af;
		font-size: 11.5px;
		font-style: italic;
		width: 100%;
	}

	.panel-body::-webkit-scrollbar {
		width: 6px;
		height: 6px;
	}

	.panel-body::-webkit-scrollbar-thumb {
		background: #d1d5db;
		border-radius: 3px;
	}
</style>
