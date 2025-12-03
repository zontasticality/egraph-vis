import { NodeStyleClass, EClassStyleClass } from './types';

// Shared style definition structure
export interface StyleDefinition {
    borderColor: string;
    borderWidth: number;
    borderStyle: 'solid' | 'dashed';
    backgroundColor: string;
    textColor: string;
    opacity?: number;
}

// Node style definitions - single source of truth
export const NODE_STYLES: Record<NodeStyleClass, StyleDefinition> = {
    [NodeStyleClass.Default]: {
        borderColor: '#000000',
        borderWidth: 2,
        borderStyle: 'solid',
        backgroundColor: '#ffffff',
        textColor: '#374151'
    },
    [NodeStyleClass.MatchedLHS]: {
        borderColor: '#facc15',  // Yellow
        borderWidth: 2,
        borderStyle: 'solid',
        backgroundColor: '#facc15',
        textColor: '#ffffff'
    },
    [NodeStyleClass.NewNode]: {
        borderColor: '#ef4444',  // Red
        borderWidth: 2,
        borderStyle: 'solid',
        backgroundColor: '#ef4444',
        textColor: '#ffffff'
    },
    [NodeStyleClass.NonCanonical]: {
        borderColor: '#ef4444',  // Red
        borderWidth: 2,
        borderStyle: 'dashed',  // Dashed to indicate ghost/non-canonical
        backgroundColor: '#ffffff',
        textColor: '#374151'
    },
    [NodeStyleClass.ParentNode]: {
        borderColor: '#3b82f6',  // Blue
        borderWidth: 2,
        borderStyle: 'solid',
        backgroundColor: '#3b82f6',
        textColor: '#ffffff'
    }
};

// E-Class style definitions
export const ECLASS_STYLES: Record<EClassStyleClass, Partial<StyleDefinition>> = {
    [EClassStyleClass.Default]: {
        borderColor: '#9ca3af',  // Gray
        backgroundColor: 'rgba(156, 163, 175, 0.1)',
        opacity: 1.0
    },
    [EClassStyleClass.Active]: {
        borderColor: '#fb923c',  // Orange
        backgroundColor: 'rgba(251, 146, 60, 0.1)',
        opacity: 1.0
    },
    [EClassStyleClass.InWorklist]: {
        borderColor: '#3b82f6',  // Blue
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        opacity: 1.0
    },
    [EClassStyleClass.Merged]: {
        borderColor: '#9ca3af',  // Gray
        backgroundColor: 'rgba(156, 163, 175, 0.1)',
        opacity: 0.5  // Faded to indicate merged/non-canonical
    }
};
