import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getDatabasePath } from '../db/paths';
import { SEARCH_EMBEDDING_DIM } from '../db/mongrelSchema';
import { DEFAULT_EMBEDDING_MODEL_ID, onnxModelIdFor } from './config';

export type EmbedFn = (text: string) => Promise<number[]>;

let pipelinePromise: Promise<EmbedFn> | null = null;
let loadedOnnxId: string | null = null;

/** Override for tests — when set, `embedText` / `ensureEmbeddingModel` use it. */
let testEmbedFn: EmbedFn | null = null;

export function setTestEmbedFn(fn: EmbedFn | null): void {
	testEmbedFn = fn;
	pipelinePromise = null;
	loadedOnnxId = null;
}

export function getEmbeddingsCacheDir(): string {
	if (process.env.EMBEDDINGS_CACHE_PATH) {
		return resolve(process.env.EMBEDDINGS_CACHE_PATH);
	}
	const dbPath = getDatabasePath();
	// Prefer a sibling of the data directory so container volumes pick it up.
	const parent = dirname(resolve(dbPath));
	return join(parent, 'roamarr-models');
}

/**
 * Deterministic 384-d pseudo-embedding for tests (no HF download).
 * Similar short texts land near each other via shared token hashes.
 */
export function hashEmbed(text: string, dim = SEARCH_EMBEDDING_DIM): number[] {
	const vec = new Float64Array(dim);
	const tokens = text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	if (tokens.length === 0) {
		vec[0] = 1;
	} else {
		for (const tok of tokens) {
			let h = 2166136261;
			for (let i = 0; i < tok.length; i++) {
				h ^= tok.charCodeAt(i);
				h = Math.imul(h, 16777619);
			}
			const idx = Math.abs(h) % dim;
			vec[idx] += 1;
			vec[(idx + 1) % dim] += 0.5;
		}
	}
	let norm = 0;
	for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
	norm = Math.sqrt(norm) || 1;
	const out = new Array<number>(dim);
	for (let i = 0; i < dim; i++) out[i] = vec[i] / norm;
	return out;
}

async function loadPipeline(modelId: string): Promise<EmbedFn> {
	const onnxId = onnxModelIdFor(modelId);
	const cacheDir = getEmbeddingsCacheDir();
	mkdirSync(cacheDir, { recursive: true });

	// Dynamic import keeps the heavy ORT stack out of cold paths / unit tests
	// that inject `setTestEmbedFn`.
	const { pipeline, env } = await import('@huggingface/transformers');
	env.cacheDir = cacheDir;
	env.allowLocalModels = true;
	env.allowRemoteModels = true;

	const extractor = await pipeline('feature-extraction', onnxId, {
		// Prefer Node ORT when available; falls back to wasm if needed.
		dtype: 'fp32'
	});

	return async (text: string) => {
		const input = text.trim() || ' ';
		const output = await extractor(input, { pooling: 'mean', normalize: true });
		// transformers.js Tensor → nested data
		const data = (output as { data?: ArrayLike<number>; tolist?: () => unknown }).data
			? Array.from((output as { data: ArrayLike<number> }).data)
			: flattenNumbers((output as { tolist: () => unknown }).tolist());
		if (data.length !== SEARCH_EMBEDDING_DIM) {
			throw new Error(
				`Embedding dimension mismatch: got ${data.length}, expected ${SEARCH_EMBEDDING_DIM}`
			);
		}
		return data;
	};
}

function flattenNumbers(value: unknown): number[] {
	if (Array.isArray(value)) {
		if (value.length > 0 && typeof value[0] === 'number') return value as number[];
		return (value as unknown[]).flatMap(flattenNumbers);
	}
	throw new Error('Unexpected embedding output shape');
}

/**
 * Ensure the local ONNX MiniLM model is downloaded and ready. Idempotent.
 * Returns an `embed` function. Throws on download/load failure.
 */
export async function ensureEmbeddingModel(
	modelId: string = DEFAULT_EMBEDDING_MODEL_ID
): Promise<EmbedFn> {
	if (testEmbedFn) return testEmbedFn;
	const onnxId = onnxModelIdFor(modelId);
	if (pipelinePromise && loadedOnnxId === onnxId) return pipelinePromise;
	loadedOnnxId = onnxId;
	pipelinePromise = loadPipeline(modelId).catch((err) => {
		pipelinePromise = null;
		loadedOnnxId = null;
		throw err;
	});
	return pipelinePromise;
}

/** Drop the in-process model handle (e.g. after disable). Cache files remain. */
export function unloadEmbeddingModel(): void {
	pipelinePromise = null;
	loadedOnnxId = null;
}

export async function embedText(
	text: string,
	modelId: string = DEFAULT_EMBEDDING_MODEL_ID
): Promise<number[]> {
	if (testEmbedFn) return testEmbedFn(text);
	const embed = await ensureEmbeddingModel(modelId);
	return embed(text);
}

export function isEmbeddingModelLoaded(): boolean {
	return testEmbedFn != null || (pipelinePromise != null && loadedOnnxId != null);
}
