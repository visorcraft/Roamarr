import { afterEach, expect, test, vi } from 'vitest';

const mock = vi.hoisted(() => ({ pipeline: vi.fn() }));
vi.mock('@huggingface/transformers', () => ({ pipeline: mock.pipeline, env: {} }));

import { ensureEmbeddingModel, isEmbeddingModelLoaded, unloadEmbeddingModel } from './model';

function extractor() {
	return Object.assign(vi.fn(async () => ({ data: new Float32Array(384) })), { dispose: vi.fn(async () => {}) });
}

afterEach(async () => {
	await unloadEmbeddingModel();
	mock.pipeline.mockReset();
});

test('unload disposes the pipeline once and allows a fresh load', async () => {
	const first = extractor();
	const second = extractor();
	mock.pipeline.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
	const embed = await ensureEmbeddingModel();
	expect(await embed('hello')).toHaveLength(384);
	await unloadEmbeddingModel();
	await unloadEmbeddingModel();
	expect(first.dispose).toHaveBeenCalledOnce();
	expect(isEmbeddingModelLoaded()).toBe(false);
	await ensureEmbeddingModel();
	expect(mock.pipeline).toHaveBeenCalledTimes(2);
});

test('unload waits for a pending download and disposes its result', async () => {
	const loading = Promise.withResolvers<ReturnType<typeof extractor>>();
	mock.pipeline.mockReturnValueOnce(loading.promise);
	const ready = ensureEmbeddingModel();
	const unloading = unloadEmbeddingModel();
	const model = extractor();
	loading.resolve(model);
	await Promise.all([ready, unloading]);
	expect(model.dispose).toHaveBeenCalledOnce();
	expect(isEmbeddingModelLoaded()).toBe(false);
});

test('unload waits for in-flight inference before disposing', async () => {
	const inference = Promise.withResolvers<{ data: Float32Array<ArrayBuffer> }>();
	const model = extractor();
	model.mockReturnValueOnce(inference.promise);
	mock.pipeline.mockResolvedValueOnce(model);
	const embed = await ensureEmbeddingModel();
	const embedding = embed('hello');
	const unloading = unloadEmbeddingModel();
	await vi.waitFor(() => expect(isEmbeddingModelLoaded()).toBe(false));
	expect(model.dispose).not.toHaveBeenCalled();
	inference.resolve({ data: new Float32Array(384) });
	await Promise.all([embedding, unloading]);
	expect(model.dispose).toHaveBeenCalledOnce();
	await expect(embed('after unload')).rejects.toThrow('Embedding model was unloaded');
});

test('switching models disposes the previous pipeline', async () => {
	const first = extractor();
	mock.pipeline.mockResolvedValueOnce(first).mockResolvedValueOnce(extractor());
	await ensureEmbeddingModel();
	await ensureEmbeddingModel('Xenova/another-model');
	expect(first.dispose).toHaveBeenCalledOnce();
});

test('failed loading can be unloaded and retried', async () => {
	mock.pipeline.mockRejectedValueOnce(new Error('download failed')).mockResolvedValueOnce(extractor());
	await expect(ensureEmbeddingModel()).rejects.toThrow('download failed');
	await unloadEmbeddingModel();
	await ensureEmbeddingModel();
	expect(isEmbeddingModelLoaded()).toBe(true);
});
