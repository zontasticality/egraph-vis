/**
 * ELK Layout Configuration
 * 
 * Centralizes all ELK layout options for easy experimentation and customization.
 * See https://eclipse.dev/elk/reference.html for all available options.
 */

export interface LayoutConfig {
    /** Main layout algorithm */
    algorithm: 'layered' | 'force' | 'stress' | 'mrtree' | 'radial' | 'disco';

    /** Layout direction */
    direction: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

    /** Spacing between nodes at the same level */
    nodeSpacing: number;

    /** Spacing between layers (for layered algorithm) */
    layerSpacing: number;

    /** Padding inside containers [top, right, bottom, left] */
    containerPadding: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };

    /** How to handle hierarchical structures */
    hierarchyHandling: 'INHERIT' | 'INCLUDE_CHILDREN' | 'SEPARATE_CHILDREN';
}

export interface NodeLayoutConfig {
    width: number;
    height: number;
}

/**
 * Default layout configuration (current production settings)
 */
export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
    algorithm: 'layered',
    direction: 'DOWN',
    nodeSpacing: 40,
    layerSpacing: 40,
    containerPadding: {
        top: 8,
        right: 8,
        bottom: 8,
        left: 8,
    },
    hierarchyHandling: 'INCLUDE_CHILDREN',
};

/**
 * Compact layout (tighter spacing for large graphs)
 */
export const COMPACT_LAYOUT_CONFIG: LayoutConfig = {
    algorithm: 'layered',
    direction: 'DOWN',
    nodeSpacing: 20,
    layerSpacing: 25,
    containerPadding: {
        top: 4,
        right: 4,
        bottom: 4,
        left: 4,
    },
    hierarchyHandling: 'INCLUDE_CHILDREN',
};

/**
 * Wide layout (more horizontal space, good for deep trees)
 */
export const WIDE_LAYOUT_CONFIG: LayoutConfig = {
    algorithm: 'layered',
    direction: 'DOWN',
    nodeSpacing: 60,
    layerSpacing: 50,
    containerPadding: {
        top: 12,
        right: 12,
        bottom: 12,
        left: 12,
    },
    hierarchyHandling: 'INCLUDE_CHILDREN',
};

/**
 * Force-directed layout (organic, physics-based)
 */
export const FORCE_LAYOUT_CONFIG: LayoutConfig = {
    algorithm: 'force',
    direction: 'DOWN', // Less relevant for force
    nodeSpacing: 40,
    layerSpacing: 40,
    containerPadding: {
        top: 8,
        right: 8,
        bottom: 8,
        left: 8,
    },
    hierarchyHandling: 'INCLUDE_CHILDREN',
};

/**
 * E-node dimensions
 */
export const ENODE_LAYOUT: NodeLayoutConfig = {
    width: 50,
    height: 50,
};

/**
 * Padding configuration for different container types
 */
export const CONTAINER_PADDING = {
    eclassGroup: {
        top: 8,
        right: 8,
        bottom: 8,
        left: 8,
    },
    unionFindGroup: {
        top: 8,
        right: 8,
        bottom: 8,
        left: 20, // Extra left padding for visual distinction
    },
};

/**
 * Convert LayoutConfig to ELK layoutOptions object
 */
export function toELKOptions(config: LayoutConfig): Record<string, string> {
    return {
        'elk.algorithm': config.algorithm,
        'elk.direction': config.direction,
        'elk.spacing.nodeNode': config.nodeSpacing.toString(),
        'elk.layered.spacing.nodeNodeBetweenLayers': config.layerSpacing.toString(),
        'elk.padding': `[top=${config.containerPadding.top},left=${config.containerPadding.left},bottom=${config.containerPadding.bottom},right=${config.containerPadding.right}]`,
        'elk.hierarchyHandling': config.hierarchyHandling,
    };
}

/**
 * Convert container padding config to ELK padding string
 */
export function toPaddingString(padding: { top: number; right: number; bottom: number; left: number }): string {
    return `[top=${padding.top},left=${padding.left},bottom=${padding.bottom},right=${padding.right}]`;
}
