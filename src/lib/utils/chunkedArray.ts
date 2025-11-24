export class ChunkedArray<T> {
    private readonly chunkSize: number;
    // The underlying data structure: an array of arrays.
    // We expose this so it can be stored in the state (plain data).
    public readonly chunks: T[][];

    constructor(chunks: T[][] = [], chunkSize = 1024) {
        this.chunks = chunks;
        this.chunkSize = chunkSize;
    }

    get(index: number): T | undefined {
        const chunkIndex = Math.floor(index / this.chunkSize);
        const itemIndex = index % this.chunkSize;
        return this.chunks[chunkIndex]?.[itemIndex];
    }

    push(item: T): void {
        let lastChunk = this.chunks[this.chunks.length - 1];

        if (!lastChunk || lastChunk.length >= this.chunkSize) {
            lastChunk = [];
            this.chunks.push(lastChunk);
        }

        lastChunk.push(item);
    }

    get length(): number {
        if (this.chunks.length === 0) return 0;
        const lastChunk = this.chunks[this.chunks.length - 1];
        return (this.chunks.length - 1) * this.chunkSize + lastChunk.length;
    }

    [Symbol.iterator](): Iterator<T> {
        let chunkIndex = 0;
        let itemIndex = 0;
        const chunks = this.chunks;

        return {
            next: (): IteratorResult<T> => {
                if (chunkIndex >= chunks.length) {
                    return { done: true, value: undefined };
                }

                const chunk = chunks[chunkIndex];
                const value = chunk[itemIndex];
                itemIndex++;

                if (itemIndex >= chunk.length) {
                    chunkIndex++;
                    itemIndex = 0;
                }

                return { done: false, value };
            }
        };
    }

    // Helper to create a view over existing data without copying
    static from<T>(chunks: T[][], chunkSize = 1024): ChunkedArray<T> {
        return new ChunkedArray(chunks, chunkSize);
    }
}
