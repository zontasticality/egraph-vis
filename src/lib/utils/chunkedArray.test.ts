import { describe, it, expect } from 'vitest';
import { ChunkedArray } from './chunkedArray';

describe('ChunkedArray', () => {
    it('should push and get items correctly', () => {
        const ca = new ChunkedArray<number>([], 4); // Small chunk size for testing

        for (let i = 0; i < 10; i++) {
            ca.push(i);
        }

        expect(ca.length).toBe(10);
        expect(ca.get(0)).toBe(0);
        expect(ca.get(3)).toBe(3);
        expect(ca.get(4)).toBe(4); // New chunk
        expect(ca.get(9)).toBe(9);
        expect(ca.get(10)).toBeUndefined();
    });

    it('should handle chunk boundaries', () => {
        const ca = new ChunkedArray<string>([], 2);
        ca.push('a');
        ca.push('b');
        expect(ca.chunks.length).toBe(1);

        ca.push('c');
        expect(ca.chunks.length).toBe(2);
        expect(ca.get(2)).toBe('c');
    });

    it('should be iterable', () => {
        const ca = new ChunkedArray<number>([], 3);
        const items = [1, 2, 3, 4, 5];
        items.forEach(i => ca.push(i));

        const result = [];
        for (const item of ca) {
            result.push(item);
        }

        expect(result).toEqual(items);
    });

    it('should work with existing chunks', () => {
        const chunks = [[1, 2], [3]];
        const ca = ChunkedArray.from(chunks, 2);

        expect(ca.length).toBe(3);
        expect(ca.get(2)).toBe(3);

        ca.push(4);
        expect(chunks[1]).toContain(4); // Should modify the passed array (which is what we want for drafts)
    });
});
