<script lang="ts">
    import { currentState } from "../../stores/timelineStore";
    import {
        isEditing,
        draftPreset,
        updateDraftRules,
        enterEditMode,
    } from "../../stores/presetEditorStore";
    import SingleRewriteRuleEditor from "../editors/SingleRewriteRuleEditor.svelte";
    import type { RewriteRule } from "../../engine/types";
    import { currentPreset } from "../../stores/timelineStore";

    // Access the current rules from the timeline state
    // In edit mode, we should display the draft rules if available
    $: displayRules =
        $isEditing && $draftPreset
            ? $draftPreset.rewrites
            : ($currentPreset?.rewrites ?? []);

    // Highlights for rules
    let highlights: Record<string, { lhs: boolean; rhs: boolean }> = {};

    $: {
        highlights = {};
        const phase = $currentState?.phase;
        const matches = $currentState?.metadata?.matches || [];

        // Read phase: Highlight LHS of matched rules (yellow)
        if (phase === "read" && matches.length > 0) {
            matches.forEach((match: any) => {
                highlights[match.rule] = { lhs: true, rhs: false };
            });
        }

        // Write phase: Highlight RHS of rules that just fired (red)
        if (phase === "write") {
            const rewrites =
                $currentState?.metadata?.diffs?.filter(
                    (d: any) => d.type === "rewrite",
                ) || [];
            rewrites.forEach((rw: any) => {
                highlights[rw.rule] = { lhs: false, rhs: true };
            });
        }
    }

    import { stringifyPattern } from "../../engine/parser";

    // Helper to render expressions
    function renderExpr(expr: any): string {
        if (typeof expr === "string") return expr;
        return stringifyPattern(expr);
    }

    // --- Editing Logic ---
    let editingRuleIndex: number | null = null;
    let isAddingRule = false;
    let collapsed = false;

    function ensureEditMode() {
        if (!$isEditing && $currentPreset) {
            enterEditMode($currentPreset);
            return true;
        }
        return $isEditing;
    }

    function handleEditRule(index: number) {
        if (ensureEditMode()) {
            editingRuleIndex = index;
            isAddingRule = false;
        }
    }

    function handleAddRule() {
        if (ensureEditMode()) {
            // Create a dummy rule
            const newRule: RewriteRule = {
                name: `rule-${displayRules.length + 1}`,
                lhs: "?x",
                rhs: "?x",
                enabled: true,
            };

            // Add it to the draft
            const newRules = [...displayRules, newRule];
            updateDraftRules(newRules);

            // Immediately edit it
            editingRuleIndex = newRules.length - 1;
            isAddingRule = true;
        }
    }

    function handleDeleteRule(index: number) {
        if (ensureEditMode()) {
            const newRules = [...displayRules];
            newRules.splice(index, 1);
            updateDraftRules(newRules);

            if (editingRuleIndex === index) {
                editingRuleIndex = null;
            }
        }
    }

    function handleSaveRule(e: CustomEvent<RewriteRule>) {
        if (editingRuleIndex === null) return;

        const updatedRule = e.detail;
        const newRules = [...displayRules];
        newRules[editingRuleIndex] = updatedRule;

        updateDraftRules(newRules);
        editingRuleIndex = null;
        isAddingRule = false;
    }

    function handleCancelEdit() {
        if (isAddingRule && editingRuleIndex !== null) {
            // If we were adding a new rule and cancelled, delete it directly
            // Don't call handleDeleteRule to avoid triggering ensureEditMode
            const newRules = [...displayRules];
            newRules.splice(editingRuleIndex, 1);
            updateDraftRules(newRules);
        }
        editingRuleIndex = null;
        isAddingRule = false;
    }
</script>

<div class="rules-panel" class:collapsed>
    <div class="panel-header">
        <div class="title-group">
            <h3>Rewrite Rules ({displayRules.length})</h3>
            <!-- Add Button (Floating, visible on hover) -->
            <div class="add-container">
                <button
                    class="btn-icon add-btn"
                    on:click={handleAddRule}
                    title="Add Rule"
                >
                    +
                </button>
            </div>
        </div>
        <button
            class="collapse-btn"
            on:click={() => (collapsed = !collapsed)}
            aria-label="Toggle rules panel"
        >
            {collapsed ? "+" : "−"}
        </button>
    </div>

    {#if !collapsed}
        <div class="rules-container">
            {#each displayRules as rule, i}
                <div
                    class="rule-chip"
                    class:highlight-lhs={highlights[rule.name]?.lhs}
                    class:highlight-rhs={highlights[rule.name]?.rhs}
                    class:disabled={!rule.enabled}
                >
                    <div class="rule-name">
                        {rule.name}
                        <button
                            class="btn-icon edit-icon"
                            on:click={() => handleEditRule(i)}
                            title="Edit Rule"
                        >
                            ✎
                        </button>
                    </div>
                    <div class="rule-expr">
                        <span class="lhs">{renderExpr(rule.lhs)}</span>
                        <span class="arrow">→</span>
                        <span class="rhs">{renderExpr(rule.rhs)}</span>
                    </div>
                    <button
                        class="btn-icon trash-icon"
                        on:click={() => handleDeleteRule(i)}
                        title="Delete Rule"
                    >
                        🗑️
                    </button>
                </div>
            {/each}
            <!-- Invisible spacer to force last line justification -->
            <span class="spacer"></span>
        </div>
    {/if}
</div>

<!-- Editor Modal -->
{#if editingRuleIndex !== null}
    <SingleRewriteRuleEditor
        rule={displayRules[editingRuleIndex]}
        isNew={isAddingRule}
        on:save={handleSaveRule}
        on:cancel={handleCancelEdit}
    />
{/if}

<style>
    .rules-panel {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        max-height: 20%; /* 1/5th of parent */
        background: white;
        border-top: 2px solid #e5e7eb;
        box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1);
        display: flex;
        flex-direction: column;
        z-index: 100;
        transition: max-height 0.2s;
    }

    .rules-panel.collapsed {
        max-height: 40px;
    }

    .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
        flex-shrink: 0;
    }

    .title-group {
        display: flex;
        align-items: center;
        gap: 8px;
        position: relative;
    }

    .panel-header h3 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: #111827;
    }

    .add-container {
        display: inline-flex;
        opacity: 0;
        transition: opacity 0.2s;
        margin-left: 8px;
    }

    .rules-panel:hover .add-container {
        opacity: 1;
    }

    .btn-icon {
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px;
        border-radius: 4px;
        color: #6b7280;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .btn-icon:hover {
        background: #f3f4f6;
        color: #111827;
    }

    .add-btn {
        font-size: 1.2rem;
        font-weight: bold;
        color: #3b82f6;
        width: 20px;
        height: 20px;
        line-height: 1;
    }

    .add-btn:hover {
        background: #eff6ff;
        color: #2563eb;
    }

    .collapse-btn {
        background: none;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        padding: 2px 8px;
        cursor: pointer;
        font-size: 16px;
    }

    .collapse-btn:hover {
        background: #f3f4f6;
    }

    /* Justified chip layout */
    .rules-container {
        overflow-y: auto;
        flex: 1;
        padding: 12px;
        text-align: justify;
        font-size: 0; /* Remove whitespace between inline-blocks */
    }

    /* Force last line to justify */
    .rules-container::after {
        content: "";
        display: inline-block;
        width: 100%;
    }

    .rule-chip {
        display: inline-block;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 6px 10px;
        margin: 4px 0; /* Vertical margin only */
        font-size: 12px;
        vertical-align: top;
        transition: all 0.2s;
        min-width: fit-content;
        position: relative;
    }

    .rule-chip:hover {
        background: #e0e7ff;
        border-color: #6366f1;
        box-shadow: 0 2px 4px rgba(99, 102, 241, 0.1);
    }

    .rule-name {
        font-weight: 600;
        color: #374151;
        margin-bottom: 4px;
        font-size: 11px;
        text-transform: lowercase;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .edit-icon {
        font-size: 0.8rem;
        opacity: 0;
        padding: 1px 4px;
    }

    .rule-name:hover .edit-icon {
        opacity: 1;
    }

    .trash-icon {
        position: absolute;
        top: 4px;
        right: 4px;
        font-size: 0.8rem;
        color: #ef4444;
        opacity: 0;
    }

    .rule-chip:hover .trash-icon {
        opacity: 1;
    }

    .rule-expr {
        color: #6b7280;
        font-family: "Monaco", "Menlo", monospace;
        white-space: nowrap;
    }

    .lhs {
        color: #dc2626;
    }

    .arrow {
        margin: 0 6px;
        color: #9ca3af;
    }

    .rhs {
        color: #059669;
    }

    /* Highlights */
    .highlight-lhs {
        background: #fef9c3; /* Yellow-50 */
        border-color: #fde047;
    }

    .highlight-rhs {
        background: #fee2e2; /* Red-50 */
        border-color: #fca5a5;
    }

    .disabled {
        opacity: 0.6;
        background: #f3f4f6;
        text-decoration: line-through;
    }

    /* Invisible spacer for last-line justification */
    .spacer {
        display: inline-block;
        width: 100%;
        height: 0;
    }
</style>
