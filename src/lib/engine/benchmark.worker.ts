/// <reference lib="webworker" />
/**
 * Runs benchmarks off the main thread (they take a few hundred ms each).
 */
import { benchmarkAll, type BenchmarkOptions } from './benchmark';
import type { EngineOptions, PresetConfig } from './types';

export interface BenchmarkRequest {
    id: number;
    preset: PresetConfig;
    configs: EngineOptions[];
    bench: Omit<BenchmarkOptions, 'clock'>;
}

self.onmessage = (e: MessageEvent<BenchmarkRequest>) => {
    const { id, preset, configs, bench } = e.data;
    try {
        postMessage({ id, results: benchmarkAll(preset, configs, bench) });
    } catch (err) {
        postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
};
