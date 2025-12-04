/**
 * ELK Layout Configuration
 * 
 * Centralizes all ELK layout options for easy experimentation and customization.
 * See https://eclipse.dev/elk/reference.html for all available options.
 */

export type LayoutAlgorithm = 'layered' | 'mrtree' | 'force';

export interface LayoutConfig {
    /** Main layout algorithm */
    algorithm: LayoutAlgorithm;

    /** Layout direction */
    direction: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

    /** Spacing between nodes at the same level */
    nodeSpacing: number;

    /** Spacing between layers (for layered algorithm) or levels (for mrtree) */
    layerSpacing: number;

    /** Spacing between edges and nodes */
    edgeNodeSpacing: number;

    /** Spacing between edges */
    edgeEdgeSpacing: number;

    /** Padding inside containers [top, right, bottom, left] */
    containerPadding: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };

    /** How to handle hierarchical structures */
    hierarchyHandling: 'INHERIT' | 'INCLUDE_CHILDREN' | 'SEPARATE_CHILDREN';

    /** Edge routing style */
    edgeRouting: 'ORTHOGONAL' | 'POLYLINE' | 'SPLINES';

    /** Port constraints */
    portConstraints: 'FREE';

    /** Algorithm specific configurations */
    force?: {
        iterations: number;
        repulsion: number; // 'elk.force.repulsion'
    };
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
    edgeRouting: 'ORTHOGONAL',
    portConstraints: 'FREE',
    edgeNodeSpacing: 10,
    edgeEdgeSpacing: 5,
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
    edgeRouting: 'ORTHOGONAL',
    portConstraints: 'FREE',
    edgeNodeSpacing: 5,
    edgeEdgeSpacing: 2,
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
    edgeRouting: 'ORTHOGONAL',
    portConstraints: 'FREE',
    edgeNodeSpacing: 15,
    edgeEdgeSpacing: 10,
};

/**
 * Force-directed layout (organic, physics-based)
 */
export const FORCE_LAYOUT_CONFIG: LayoutConfig = {
    algorithm: 'force',
    direction: 'DOWN', // Less relevant for force but still used
    nodeSpacing: 50,
    layerSpacing: 50,
    containerPadding: {
        top: 8,
        right: 8,
        bottom: 8,
        left: 8,
    },
    hierarchyHandling: 'INCLUDE_CHILDREN',
    edgeRouting: 'POLYLINE',
    portConstraints: 'FREE',
    edgeNodeSpacing: 10,
    edgeEdgeSpacing: 5,
    force: {
        iterations: 100,
        repulsion: 1.0
    }
};

/**
 * Mr. Tree layout (specialized for trees)
 */
export const MRTREE_LAYOUT_CONFIG: LayoutConfig = {
    algorithm: 'mrtree',
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
    edgeRouting: 'ORTHOGONAL',
    portConstraints: 'FREE',
    edgeNodeSpacing: 10,
    edgeEdgeSpacing: 5,
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
    const options: Record<string, string> = {
        'elk.algorithm': config.algorithm,
        'elk.direction': config.direction,
        'elk.padding': `[top=${config.containerPadding.top},left=${config.containerPadding.left},bottom=${config.containerPadding.bottom},right=${config.containerPadding.right}]`,
        'elk.hierarchyHandling': config.hierarchyHandling,
        'elk.edgeRouting': config.edgeRouting,
        'elk.portConstraints': config.portConstraints,
        'elk.spacing.edgeNode': config.edgeNodeSpacing.toString(),
        'elk.spacing.edgeEdge': config.edgeEdgeSpacing.toString(),
    };

    // Algorithm specific mapping
    switch (config.algorithm) {
        case 'layered':
            options['elk.spacing.nodeNode'] = config.nodeSpacing.toString();
            options['elk.layered.spacing.nodeNodeBetweenLayers'] = config.layerSpacing.toString();
            break;
        case 'mrtree':
            options['elk.spacing.nodeNode'] = config.nodeSpacing.toString();
            // mrtree uses layer spacing implicitly or via other params, but nodeNode is key
            // We can map layerSpacing to edgeNode spacing if needed, but standard nodeNode is main
            break;
        case 'force':
            options['elk.spacing.nodeNode'] = config.nodeSpacing.toString();
            if (config.force) {
                options['elk.force.iterations'] = config.force.iterations.toString();
                options['elk.force.repulsion'] = config.force.repulsion.toString();
            }
            break;
    }

    return options;
}

/**
 * Convert container padding config to ELK padding string
 */
export function toPaddingString(padding: { top: number; right: number; bottom: number; left: number }): string {
    return `[top=${padding.top},left=${padding.left},bottom=${padding.bottom},right=${padding.right}]`;
}
