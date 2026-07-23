import { expect, test } from 'vitest';
import {
	DEFAULT_EMBEDDING_MODEL_ID,
	DEFAULT_ONNX_MODEL_ID,
	onnxModelIdFor,
	parseEmbeddingsConfig
} from './config';

test('default model maps to Xenova ONNX MiniLM', () => {
	expect(onnxModelIdFor(DEFAULT_EMBEDDING_MODEL_ID)).toBe(DEFAULT_ONNX_MODEL_ID);
	expect(onnxModelIdFor('sentence-transformers/all-MiniLM-L6-v2')).toBe(DEFAULT_ONNX_MODEL_ID);
	expect(onnxModelIdFor('Xenova/all-MiniLM-L6-v2')).toBe('Xenova/all-MiniLM-L6-v2');
});

test('parseEmbeddingsConfig defaults to disabled', () => {
	const cfg = parseEmbeddingsConfig(null);
	expect(cfg.enabled).toBe(false);
	expect(cfg.status).toBe('disabled');
	expect(cfg.model).toBe(DEFAULT_EMBEDDING_MODEL_ID);
});

test('parseEmbeddingsConfig reads stored JSON', () => {
	const cfg = parseEmbeddingsConfig(
		JSON.stringify({
			enabled: true,
			model: 'sentence-transformers/all-MiniLM-L6-v2',
			status: 'ready',
			error: null,
			readyAt: '2026-07-23T00:00:00.000Z'
		})
	);
	expect(cfg.enabled).toBe(true);
	expect(cfg.status).toBe('ready');
	expect(cfg.readyAt).toBe('2026-07-23T00:00:00.000Z');
});
