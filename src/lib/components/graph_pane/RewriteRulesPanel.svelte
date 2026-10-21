<script lang="ts">
    import { displayState, currentPreset } from "../../stores/timelineStore";
    import {
        isEditing,
        draftPreset,
        updateDraftRules,
        enterEditMode,
    } from "../../stores/presetEditorStore";
    import SingleRewriteRuleEditor from "../editors/SingleRewriteRuleEditor.svelte";
    import type { RewriteRule } from "../../engine/types";
    import { stringifyPattern } from "../../engine/parser";

    // In edit mode, show the draft rules
    $: displayRules =
        $isEditing && $draftPreset
            ? $draftPreset.rewrites
            : ($currentPreset?.rewrites ?? []);

    // Match counts (read phases) and the rule being applied (write phase)
    $: matchCounts = (() => {
        const counts = new Map<string, number>();
        const phase = $displayState?.phase;
        if (phase === "read" || phase === "read-batch") {
            for (const m of $displayState!.metadata.matches) {
                counts.set(m.rule, (counts.get(m.rule) ?? 0) + 1);
            }
        }
        return counts;
    })();
    $: appliedRules = new Set(
        $displayState?.phase === "write"
            ? ($displayState.metadata.applied ?? []).map((a) => a.rule)
            : [],
    );

    // --- Editing Logic ---
    let editingRuleIndex: number | null = null;
    let newRule: RewriteRule | null = null;
    let collapsed = false;

    function ensureEditMode() {
        if (!$isEditing && $currentPreset) {
            enterEditMode($currentPreset);
        }
        return $isEditing || !!$currentPreset;
    }

    function handleEditRule(index: number) {
        if (ensureEditMode()) {
            newRule = null;
            editingRuleIndex = index;
        }
    }

    function handleAddRule() {
        if (ensureEditMode()) {
            editingRuleIndex = null;
            newRule = {
                name: uniqueName(`rule-${displayRules.length + 1}`),
                lhs: { op: "f", args: ["?x"] },
                rhs: "?x",
                enabled: true,
            };
        }
    }

    function uniqueName(base: string): string {
        const names = new Set(displayRules.map((r) => r.name));
        let name = base;
        for (let i = 2; names.has(name); i++) name = `${base}-${i}`;
        return name;
    }

    function handleToggleRule(index: number) {
        if (ensureEditMode()) {
            const newRules = displayRules.map((r, i) =>
                i === index ? { ...r, enabled: !r.enabled } : r,
            );
            updateDraftRules(newRules);
        }
    }

    function handleDeleteRule(index: number) {
        if (ensureEditMode()) {
            updateDraftRules(displayRules.filter((_, i) => i !== index));
            if (editingRuleIndex === index) editingRuleIndex = null;
        }
    }

    function handleSaveRule(e: CustomEvent<RewriteRule>) {
        const updatedRule = e.detail;
        if (newRule) {
            updateDraftRules([...displayRules, updatedRule]);
        } else if (editingRuleIndex !== null) {
            updateDraftRules(
                displayRules.map((r, i) => (i === editingRuleIndex ? updatedRule : r)),
            );
        }
        closeEditor();
    }

    function closeEditor() {
        editingRuleIndex = null;
        newRule = null;
    }

    $: editorRule =
        newRule ?? (editingRuleIndex !== null ? displayRules[editingRuleIndex] : null);
    $: takenNames = displayRules
        .filter((_, i) => newRule !== null || i !== editingRuleIndex)
        .map((r) => r.name);
</script>

<div class="rules-panel" class:collapsed>
    <div class="panel-header">
        <button
            class="collapse-btn"
            on:click={() => (collapsed = !collapsed)}
            aria-expanded={!collapsed}
            aria-label="Toggle rules panel"
        >
            <span class="chevron" class:rot={collapsed}>▾</span>
            <h3>Rewrite Rules ({displayRules.length})</h3>
        </button>
        <button class="add-btn" on:click={handleAddRule} title="Add a rewrite rule">
            + Add rule
        </button>
    </div>

    {#if !collapsed}
        <div class="rules-container">
            {#if displayRules.length === 0}
                <div class="empty">No rules yet. Add one to start rewriting.</div>
            {/if}
            {#each displayRules as rule, i (rule.name + i)}
                {@const count = matchCounts.get(rule.name) ?? 0}
                <div
                    class="rule-chip"
                    class:highlight-lhs={count > 0}
                    class:highlight-rhs={appliedRules.has(rule.name)}
                    class:disabled={!rule.enabled}
                >
                    <div class="rule-top">
                        <label class="enable" title={rule.enabled ? "Disable rule" : "Enable rule"}>
                            <input
                                type="checkbox"
                                checked={rule.enabled}
                                on:change={() => handleToggleRule(i)}
                            />
                        </label>
                        <span class="rule-name">{rule.name}</span>
                        {#if count > 0}
                            <span class="badge match" title="Matches found in this step"
                                >{count} match{count === 1 ? "" : "es"}</span
                            >
                        {/if}
                        {#if appliedRules.has(rule.name)}
                            <span class="badge apply">applying</span>
                        {/if}
                        <span class="chip-actions">
                            <button
                                class="icon-btn"
                                on:click={() => handleEditRule(i)}
                                title="Edit rule"
                                aria-label="Edit rule {rule.name}">✎</button
                            >
                            <button
                                class="icon-btn danger"
                                on:click={() => handleDeleteRule(i)}
                                title="Delete rule"
                                aria-label="Delete rule {rule.name}">✕</button
                            >
                        </span>
                    </div>
                    <div class="rule-expr">
                        <span class="lhs">{stringifyPattern(rule.lhs)}</span>
                        <span class="arrow">→</span>
                        <span class="rhs">{stringifyPattern(rule.rhs)}</span>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

{#if editorRule}
    <SingleRewriteRuleEditor
        rule={editorRule}
        isNew={newRule !== null}
        {takenNames}
        on:save={handleSaveRule}
        on:cancel={closeEditor}
    />
{/if}

<style>
    .rules-panel {
        flex-shrink: 0;
        max-height: 34%;
        display: flex;
        flex-direction: column;
        background: white;
        border-top: 1px solid #e5e7eb;
        box-shadow: 0 -2px 6px rgba(0, 0, 0, 0.04);
    }

    .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 10px 4px 6px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
        flex-shrink: 0;
    }

    .rules-panel.collapsed .panel-header {
        border-bottom: none;
    }

    .collapse-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: none;
        border: none;
        padding: 4px 6px;
        border-radius: 6px;
        cursor: pointer;
    }

    .collapse-btn:hover {
        background: #f3f4f6;
    }

    .chevron {
        color: #6b7280;
        transition: transform 0.15s;
        display: inline-block;
    }

    .chevron.rot {
        transform: rotate(-90deg);
    }

    .panel-header h3 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: #111827;
    }

    .add-btn {
        background: none;
        border: 1px solid transparent;
        border-radius: 6px;
        padding: 3px 8px;
        font-size: 12px;
        font-weight: 600;
        color: #2563eb;
        cursor: pointer;
    }

    .add-btn:hover {
        background: #eff6ff;
        border-color: #bfdbfe;
    }

    .rules-container {
        overflow-y: auto;
        padding: 8px 10px 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-content: flex-start;
    }

    .empty {
        color: #9ca3af;
        font-size: 12px;
        font-style: italic;
        padding: 4px;
    }

    .rule-chip {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 4px 8px 6px;
        font-size: 12px;
        transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    }

    .rule-chip:hover {
        border-color: #c7d2fe;
        box-shadow: 0 1px 3px rgba(99, 102, 241, 0.12);
    }

    .rule-top {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-bottom: 2px;
    }

    .enable {
        display: inline-flex;
        cursor: pointer;
    }

    .enable input {
        margin: 0;
        width: 12px;
        height: 12px;
        cursor: pointer;
    }

    .rule-name {
        font-weight: 600;
        color: #374151;
        font-size: 11px;
    }

    .badge {
        font-size: 10px;
        font-weight: 600;
        padding: 0 5px;
        border-radius: 999px;
        line-height: 15px;
    }

    .badge.match {
        background: #fde68a;
        color: #78350f;
    }

    .badge.apply {
        background: #fecdd3;
        color: #881337;
    }

    .chip-actions {
        margin-left: auto;
        display: inline-flex;
        gap: 1px;
        opacity: 0;
        transition: opacity 0.15s;
    }

    .rule-chip:hover .chip-actions,
    .rule-chip:focus-within .chip-actions {
        opacity: 1;
    }

    .icon-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 11px;
        color: #6b7280;
        padding: 1px 4px;
        border-radius: 4px;
    }

    .icon-btn:hover {
        background: #e5e7eb;
        color: #111827;
    }

    .icon-btn.danger:hover {
        background: #fee2e2;
        color: #b91c1c;
    }

    .rule-expr {
        font-family: ui-monospace, Menlo, monospace;
        white-space: nowrap;
        color: #6b7280;
    }

    .lhs {
        color: #b45309;
    }

    .arrow {
        margin: 0 5px;
        color: #9ca3af;
    }

    .rhs {
        color: #047857;
    }

    .highlight-lhs {
        background: #fffbeb;
        border-color: #fcd34d;
    }

    .highlight-rhs {
        background: #fff1f2;
        border-color: #fda4af;
    }

    .disabled {
        opacity: 0.55;
    }

    .disabled .rule-expr {
        text-decoration: line-through;
    }
</style>
