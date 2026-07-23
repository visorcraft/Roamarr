/**
 * Admin-facing embedding model id (sentence-transformers family).
 * Runtime downloads the ONNX/ORT conversion via transformers.js.
 */
export const DEFAULT_EMBEDDING_MODEL_ID = 'sentence-transformers/all-MiniLM-L6-v2';

/**
 * transformers.js / Hugging Face Hub ONNX export of the same MiniLM weights.
 * Used for local download + inference via ONNX Runtime.
 */
export const DEFAULT_ONNX_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

export type EmbeddingsStatus = 'disabled' | 'downloading' | 'ready' | 'error';

export type EmbeddingsConfig = {
	enabled: boolean;
	/** Admin-facing model id (default MiniLM). */
	model: string;
	/** Status of local model readiness. */
	status: EmbeddingsStatus;
	/** Last error message when status is `error`. */
	error: string | null;
	/** ISO timestamp when the model last became ready. */
	readyAt: string | null;
};

export const DEFAULT_EMBEDDINGS_CONFIG: EmbeddingsConfig = {
	enabled: false,
	model: DEFAULT_EMBEDDING_MODEL_ID,
	status: 'disabled',
	error: null,
	readyAt: null
};

/** Map an admin-facing model id to the ONNX Hub id transformers.js can download. */
export function onnxModelIdFor(modelId: string): string {
	const id = modelId.trim();
	if (!id || id === DEFAULT_EMBEDDING_MODEL_ID) return DEFAULT_ONNX_MODEL_ID;
	// Already an ONNX/transformers.js-friendly id.
	if (id.startsWith('Xenova/') || id.includes('onnx')) return id;
	// Known MiniLM aliases.
	if (id.toLowerCase().includes('all-minilm-l6-v2')) return DEFAULT_ONNX_MODEL_ID;
	// Fall back to Xenova-prefixed form when possible.
	const bare = id.includes('/') ? id.split('/').pop()! : id;
	return `Xenova/${bare}`;
}

export function parseEmbeddingsConfig(raw: unknown): EmbeddingsConfig {
	if (raw == null || raw === '') return { ...DEFAULT_EMBEDDINGS_CONFIG };
	let obj: Record<string, unknown>;
	if (typeof raw === 'string') {
		try {
			obj = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return { ...DEFAULT_EMBEDDINGS_CONFIG };
		}
	} else if (typeof raw === 'object') {
		obj = raw as Record<string, unknown>;
	} else {
		return { ...DEFAULT_EMBEDDINGS_CONFIG };
	}
	const status = obj.status;
	const validStatus: EmbeddingsStatus[] = ['disabled', 'downloading', 'ready', 'error'];
	return {
		enabled: obj.enabled === true,
		model: typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : DEFAULT_EMBEDDING_MODEL_ID,
		status: validStatus.includes(status as EmbeddingsStatus)
			? (status as EmbeddingsStatus)
			: obj.enabled === true
				? 'error'
				: 'disabled',
		error: typeof obj.error === 'string' ? obj.error : null,
		readyAt: typeof obj.readyAt === 'string' ? obj.readyAt : null
	};
}

export function serializeEmbeddingsConfig(cfg: EmbeddingsConfig): string {
	return JSON.stringify(cfg);
}
