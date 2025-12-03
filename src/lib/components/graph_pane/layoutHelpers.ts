/**
 * Layout helper functions for GraphPane.
 * Extracted from GraphPane.svelte to improve organization and testability.
 */

import type { EGraphState, LayoutData, NodeVisualState, EClassVisualState } from '../../engine/types';
import { NODE_STYLES, ECLASS_STYLES } from '../../engine/visualStyles';
import { interpolateColor, interpolateOpacity } from '../../utils/colors';
import { easeInExpo } from '../../utils/easing';

/**
 * Get interpolated position for a node or group.
 * Positions are relative to parent.
 */
export function getPosition(
    id: string,
    isEnode: boolean,
    currentState: EGraphState,
    nextState: EGraphState | null,
    progress: number,
    shouldInterpolate: boolean | undefined,
): { x: number; y: number } {
    const easedProgress = shouldInterpolate ? easeInExpo(progress) : progress;

    if (isEnode) {
        const nodeId = parseInt(id.substring(5)); // "node-123" -> 123
        const currentPos = currentState.layout!.nodes.get(nodeId);
        if (!currentPos) return { x: 0, y: 0 };

        if (shouldInterpolate && nextState?.layout) {
            const nextPos = nextState.layout.nodes.get(nodeId);
            if (nextPos) {
                return {
                    x: currentPos.x + (nextPos.x - currentPos.x) * easedProgress,
                    y: currentPos.y + (nextPos.y - currentPos.y) * easedProgress,
                };
            }
        }
        return currentPos;
    } else {
        // Group node (class or set)
        const currentPos = currentState.layout!.groups.get(id);
        if (!currentPos) return { x: 0, y: 0 };

        if (shouldInterpolate && nextState?.layout) {
            const nextPos = nextState.layout.groups.get(id);
            if (nextPos) {
                return {
                    x: currentPos.x + (nextPos.x - currentPos.x) * easedProgress,
                    y: currentPos.y + (nextPos.y - currentPos.y) * easedProgress,
                };
            }
        }
        return currentPos;
    }
}

/**
 * Get interpolated dimensions for a group.
 * Smoothly transitions width/height when e-classes grow or shrink.
 */
export function getDimensions(
    id: string,
    currentState: EGraphState,
    nextState: EGraphState | null,
    progress: number,
    shouldInterpolate: boolean | undefined,
): { width: number; height: number } {
    const easedProgress = shouldInterpolate ? easeInExpo(progress) : progress;
    const currentLayout = currentState.layout!.groups.get(id);
    if (!currentLayout) return { width: 100, height: 100 };

    if (shouldInterpolate && nextState?.layout) {
        const nextLayout = nextState.layout.groups.get(id);
        if (nextLayout) {
            return {
                width:
                    currentLayout.width +
                    (nextLayout.width - currentLayout.width) * easedProgress,
                height:
                    currentLayout.height +
                    (nextLayout.height - currentLayout.height) * easedProgress,
            };
        }
    }
    return { width: currentLayout.width, height: currentLayout.height };
}

/**
 * Get interpolated e-class visual properties (color, lightColor, opacity).
 */
export function getEClassVisuals(
    eclassId: number,
    currentState: EGraphState,
    nextState: EGraphState | null,
    progress: number,
    shouldInterpolate: boolean | undefined,
): { color: string; lightColor: string; opacity: number } {
    const easedProgress = shouldInterpolate ? easeInExpo(progress) : progress;

    const currentVisualState = currentState.visualStates?.eclasses.get(eclassId);
    const nextVisualState = nextState?.visualStates?.eclasses.get(eclassId);

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
            ? interpolateOpacity(baseStyle.opacity, nextStyle!.opacity, easedProgress)
            : (baseStyle.opacity ?? 1.0);

    return {
        color: borderColor,
        lightColor: backgroundColor,
        opacity,
    };
}
