<script lang="ts">
    import { currentPreset, currentState } from "../../stores/timelineStore";

    let collapsed = false;

    // Render expression as simple string
    function renderExpr(expr: any): string {
        if (typeof expr === "string") return expr;
        if (expr.op) {
            const args = expr.args.map(renderExpr).join(", ");
            return `${expr.op}(${args})`;
        }
        return String(expr);
    }

    // Determine highlighting for a rule based on current state
    $: ruleHighlights = (() => {
        if (!$currentState || !$currentPreset) return {};

        const highlights: Record<string, { lhs: boolean; rhs: boolean }> = {};
        const phase = $currentState.phase;
        const matches = $currentState.metadata.matches;

        // Read phase: Highlight LHS of matched rules (yellow)
        if (phase === "read" && matches.length > 0) {
            matches.forEach((match) => {
                highlights[match.rule] = { lhs: true, rhs: false };
            });
        }

        // Write phase: Highlight RHS of rules that just fired (red)
        if (phase === "write") {
            const rewrites = $currentState.metadata.diffs.filter(
                (d) => d.type === "rewrite",
            );
            rewrites.forEach((rw: any) => {
                highlights[rw.rule] = { lhs: false, rhs: true };
            });
        }

        return highlights;
    })();
</script>

<div class="rules-panel" class:collapsed>
    <div class="panel-header">
        <h3>Rewrite Rules ({$currentPreset?.rewrites.length ?? 0})</h3>
        <button
            class="collapse-btn"
            on:click={() => (collapsed = !collapsed)}
            aria-label="Toggle rules panel"
        >
            {collapsed ? "+" : "−"}
        </button>
    </div>

    {#if !collapsed && $currentPreset}
        <div class="rules-container">
            {#each $currentPreset.rewrites as rule}
                {@const highlight = ruleHighlights[rule.name]}
                <div
                    class="rule-chip"
                    class:disabled={!rule.enabled}
                    class:active={highlight}
                >
                    <div class="rule-name">{rule.name}</div>
                    <div class="rule-expr">
                        <span class="lhs" class:highlight-read={highlight?.lhs}>
                            {renderExpr(rule.lhs)}
                        </span>
                        <span class="arrow">→</span>
                        <span
                            class="rhs"
                            class:highlight-write={highlight?.rhs}
                        >
                            {renderExpr(rule.rhs)}
                        </span>
                    </div>
                </div>
            {/each}
            <!-- Invisible spacer to force last line justification -->
            <span class="spacer"></span>
        </div>
    {/if}
</div>

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

    .panel-header h3 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
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
        padding: 8px 12px;
        margin: 4px 0; /* Vertical margin only */
        font-size: 12px;
        vertical-align: top;
        transition: all 0.2s;
    }

    .rule-chip:hover {
        background: #e0e7ff;
        border-color: #6366f1;
        box-shadow: 0 2px 4px rgba(99, 102, 241, 0.1);
    }

    .rule-chip.active {
        background: #fef3c7;
        border-color: #f59e0b;
    }

    .rule-chip.disabled {
        opacity: 0.4;
        text-decoration: line-through;
    }

    .rule-name {
        font-weight: 600;
        color: #374151;
        margin-bottom: 4px;
        font-size: 11px;
        text-transform: lowercase;
    }

    .rule-expr {
        color: #6b7280;
        font-family: "Monaco", "Menlo", monospace;
        white-space: nowrap;
    }

    .lhs {
        color: #dc2626;
    }

    /* Read phase highlight (yellow) */
    .lhs.highlight-read {
        background: #fef08a;
        color: #854d0e;
        padding: 2px 4px;
        border-radius: 3px;
        font-weight: 700;
    }

    .arrow {
        margin: 0 6px;
        color: #9ca3af;
    }

    .rhs {
        color: #059669;
    }

    /* Write phase highlight (red) */
    .rhs.highlight-write {
        background: #fecaca;
        color: #991b1b;
        padding: 2px 4px;
        border-radius: 3px;
        font-weight: 700;
    }

    /* Invisible spacer for last-line justification */
    .spacer {
        display: inline-block;
        width: 100%;
        height: 0;
    }
</style>
