/**
 * Runs benchmarks in a web worker, or in-thread (with a smaller budget) where
 * workers are unavailable (tests, server-side rendering) or fail to start.
 */
import { benchmarkAll, type Benchmark, type BenchmarkOptions } from './benchmark';
import type { BenchmarkRequest } from './benchmark.worker';
import type { EngineOptions, PresetConfig } from './types';

type Bench = Omit<BenchmarkOptions, 'clock'>;

interface Job {
    resolve: (b: Benchmark[]) => void;
    reject: (e: Error) => void;
    /** The same job in-thread, if the worker dies before answering. */
    fallback: () => Promise<Benchmark[]>;
}

let worker: Worker | null = null;
/** Set when the worker could not run (e.g. blocked by the host): measure in-thread from then on. */
let workerBroken = false;
let nextId = 0;
const pending = new Map<number, Job>();

function getWorker(): Worker | null {
    if (worker) return worker;
    if (workerBroken || typeof window === 'undefined' || typeof Worker === 'undefined') return null;
    try {
        worker = new Worker(new URL('./benchmark.worker.ts', import.meta.url), { type: 'module' });
    } catch {
        workerBroken = true;
        return null;
    }
    worker.onmessage = (e: MessageEvent<{ id: number; results?: Benchmark[]; error?: string }>) => {
        const job = pending.get(e.data.id);
        if (!job) return;
        pending.delete(e.data.id);
        if (e.data.results) job.resolve(e.data.results);
        else job.reject(new Error(e.data.error ?? 'Benchmark failed'));
    };
    worker.onerror = () => {
        // A worker that failed to load or crashed never answers: measure in-thread instead
        workerBroken = true;
        worker?.terminate();
        worker = null;
        const jobs = Array.from(pending.values());
        pending.clear();
        for (const job of jobs) job.fallback().then(job.resolve, job.reject);
    };
    return worker;
}

function inThread(preset: PresetConfig, configs: EngineOptions[], bench: Bench): Promise<Benchmark[]> {
    // Keep the page responsive: a smaller budget, after the current task
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            try {
                resolve(benchmarkAll(preset, configs, { ...bench, budgetMs: Math.min(bench.budgetMs ?? 300, 80) }));
            } catch (e) {
                reject(e as Error);
            }
        }, 0);
    });
}

/** Benchmark several configurations of a preset together (see `benchmarkAll`). */
export function runBenchmarks(preset: PresetConfig, configs: EngineOptions[], bench: Bench = {}): Promise<Benchmark[]> {
    const w = getWorker();
    if (!w) return inThread(preset, configs, bench);
    const id = nextId++;
    // Plain JSON: stores and editors may hand us objects that can't be structured-cloned
    const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
    const request: BenchmarkRequest = { id, preset: plain(preset), configs: plain(configs), bench };
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, fallback: () => inThread(preset, configs, bench) });
        w.postMessage(request);
    });
}
