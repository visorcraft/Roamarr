import { and, eq } from '@visorcraft/mongreldb-kit';
import { kit } from '../db';
import { searchDocuments, trips as tripsTable, SEARCH_EMBEDDING_DIM } from '../db/mongrelSchema';
import { nowIso } from '../tz';
import {
	DEFAULT_EMBEDDINGS_CONFIG,
	type EmbeddingsConfig,
	parseEmbeddingsConfig,
	serializeEmbeddingsConfig
} from './config';
import { embedText, ensureEmbeddingModel, unloadEmbeddingModel } from './model';
import { getSettings, updateSettings } from '../repositories/settingsRepo';
import { canView } from '../sharing';
import * as tripsRepo from '../repositories/tripsRepo';
import * as segmentsRepo from '../repositories/segmentsRepo';

export type SearchEntityType = 'trip' | 'segment';

export type SearchHit = {
	entityType: SearchEntityType;
	entityId: number;
	ownerId: number;
	title: string;
	body: string;
	href: string;
};

export type SearchDocumentInput = {
	entityType: SearchEntityType;
	entityId: number;
	ownerId: number;
	title: string;
	body: string;
	href: string;
};

export function getEmbeddingsConfig(): EmbeddingsConfig {
	const s = getSettings();
	return s.embeddings ?? { ...DEFAULT_EMBEDDINGS_CONFIG };
}

export function setEmbeddingsConfig(cfg: EmbeddingsConfig): void {
	updateSettings({ embeddings: cfg });
}

function patchEmbeddings(partial: Partial<EmbeddingsConfig>): EmbeddingsConfig {
	const next = { ...getEmbeddingsConfig(), ...partial };
	setEmbeddingsConfig(next);
	return next;
}

/**
 * Enable embeddings: mark downloading, fetch MiniLM ONNX from HF Hub, reindex,
 * then mark ready. Cached Hub files make subsequent enables fast.
 */
export async function enableEmbeddings(model?: string): Promise<EmbeddingsConfig> {
	const current = getEmbeddingsConfig();
	const modelId = (model?.trim() || current.model || DEFAULT_EMBEDDINGS_CONFIG.model).trim();
	patchEmbeddings({
		enabled: true,
		model: modelId,
		status: 'downloading',
		error: null
	});
	try {
		await ensureEmbeddingModel(modelId);
		// Temporarily treat as ready so upsert helpers work during reindex.
		patchEmbeddings({ enabled: true, model: modelId, status: 'ready', error: null });
		await reindexAll();
		return patchEmbeddings({
			enabled: true,
			model: modelId,
			status: 'ready',
			error: null,
			readyAt: nowIso()
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return patchEmbeddings({
			enabled: true,
			model: modelId,
			status: 'error',
			error: message,
			readyAt: null
		});
	}
}

export function disableEmbeddings(): EmbeddingsConfig {
	unloadEmbeddingModel();
	return patchEmbeddings({
		enabled: false,
		status: 'disabled',
		error: null
	});
}

export function embeddingsReady(): boolean {
	const cfg = getEmbeddingsConfig();
	return cfg.enabled && cfg.status === 'ready';
}

/** Write one document into the ANN corpus (requires embeddings ready). */
export async function writeSearchDocument(input: SearchDocumentInput): Promise<void> {
	const cfg = getEmbeddingsConfig();
	if (!cfg.enabled || (cfg.status !== 'ready' && cfg.status !== 'downloading')) return;
	const text = `${input.title}\n${input.body}`.trim();
	const vector = await embedText(text, cfg.model);
	if (vector.length !== SEARCH_EMBEDDING_DIM) {
		throw new Error(`Bad embedding length ${vector.length}`);
	}
	const existing = kit
		.selectFrom(searchDocuments)
		.where(
			and(
				eq(searchDocuments.entity_type, input.entityType),
				eq(searchDocuments.entity_id, BigInt(input.entityId))
			)
		)
		.executeSync()[0];
	const row = {
		entity_type: input.entityType,
		entity_id: BigInt(input.entityId),
		owner_id: BigInt(input.ownerId),
		title: input.title.slice(0, 500),
		body: input.body.slice(0, 4000),
		href: input.href,
		vector,
		updated_at: nowIso()
	};
	if (existing) {
		kit
			.updateTable(searchDocuments)
			.set(row)
			.where(eq(searchDocuments.id, existing.id))
			.executeSync();
	} else {
		kit.insertInto(searchDocuments).values(row).executeSync();
	}
}

/** Upsert one document when embeddings are ready (no-op otherwise). */
export async function upsertSearchDocument(input: SearchDocumentInput): Promise<void> {
	if (!embeddingsReady()) return;
	await writeSearchDocument(input);
}

export function removeSearchDocument(entityType: SearchEntityType, entityId: number): void {
	kit
		.deleteFrom(searchDocuments)
		.where(
			and(
				eq(searchDocuments.entity_type, entityType),
				eq(searchDocuments.entity_id, BigInt(entityId))
			)
		)
		.executeSync();
}

function tripSearchDoc(trip: tripsRepo.Trip): SearchDocumentInput {
	const tags = (() => {
		try {
			const parsed = JSON.parse(trip.tags);
			return Array.isArray(parsed) ? parsed.join(' ') : '';
		} catch {
			return '';
		}
	})();
	const city = trip.destinationCityName ?? '';
	const country = trip.destinationCountryCode ?? '';
	const dest = trip.destination ?? '';
	const notes = trip.notes ?? '';
	return {
		entityType: 'trip',
		entityId: trip.id,
		ownerId: trip.ownerId,
		title: trip.name,
		body: [dest, city, country, tags, notes, trip.status].filter(Boolean).join(' '),
		href: `/trips/${trip.id}`
	};
}

function segmentSearchDoc(
	segment: ReturnType<typeof segmentsRepo.toSegmentRow>,
	ownerId: number
): SearchDocumentInput {
	return {
		entityType: 'segment',
		entityId: segment.id,
		ownerId,
		title: segment.title,
		body: [
			segment.type,
			segment.location,
			segment.cityName,
			segment.countryCode,
			segment.venue,
			segment.confirmationNumber
		]
			.filter(Boolean)
			.join(' '),
		href: `/trips/${segment.tripId}`
	};
}

/** Best-effort index of one trip (and its segments). No-op when embeddings off. */
export async function indexTrip(tripId: number): Promise<void> {
	if (!embeddingsReady()) return;
	const trip = tripsRepo.getTripById(tripId);
	if (!trip) {
		removeSearchDocument('trip', tripId);
		return;
	}
	await writeSearchDocument(tripSearchDoc(trip));
	const segs = segmentsRepo.listSegmentsForTrip(tripId);
	const keep = new Set(segs.map((s) => s.id));
	// Drop segment docs that no longer exist for this trip.
	const existingSegs = kit
		.selectFrom(searchDocuments)
		.where(eq(searchDocuments.entity_type, 'segment'))
		.executeSync()
		.filter((r) => Number(r.owner_id) === trip.ownerId);
	for (const row of existingSegs) {
		const seg = segmentsRepo.getSegmentById(Number(row.entity_id));
		if (!seg || seg.tripId !== tripId) continue;
		if (!keep.has(seg.id)) removeSearchDocument('segment', seg.id);
	}
	for (const s of segs) {
		await writeSearchDocument(segmentSearchDoc(s, trip.ownerId));
	}
}

export async function reindexAll(): Promise<{ trips: number; segments: number }> {
	const cfg = getEmbeddingsConfig();
	if (!cfg.enabled) return { trips: 0, segments: 0 };

	// Wipe corpus so deletes/renames do not leave orphans.
	for (const row of kit.selectFrom(searchDocuments).executeSync()) {
		kit.deleteFrom(searchDocuments).where(eq(searchDocuments.id, row.id)).executeSync();
	}

	const allTrips = kit
		.selectFrom(tripsTable)
		.executeSync()
		.map((row) => tripsRepo.toTrip(row));

	let tripCount = 0;
	let segmentCount = 0;
	for (const trip of allTrips) {
		await writeSearchDocument(tripSearchDoc(trip));
		tripCount++;
		for (const s of segmentsRepo.listSegmentsForTrip(trip.id)) {
			await writeSearchDocument(segmentSearchDoc(s, trip.ownerId));
			segmentCount++;
		}
	}
	return { trips: tripCount, segments: segmentCount };
}

/**
 * Semantic ANN search filtered by trip visibility. Empty when embeddings off.
 */
export async function semanticSearch(
	userId: number,
	query: string,
	limit = 40
): Promise<SearchHit[]> {
	if (!embeddingsReady()) return [];
	const q = query.trim();
	if (!q) return [];
	const cfg = getEmbeddingsConfig();
	const vector = await embedText(q, cfg.model);
	const candidates = kit
		.selectFrom(searchDocuments)
		.annSearch(searchDocuments.vector, vector, Math.min(Math.max(limit * 4, 20), 200))
		.executeSync();

	const hits: SearchHit[] = [];
	const seen = new Set<string>();
	for (const row of candidates) {
		const entityType = row.entity_type as SearchEntityType;
		const entityId = Number(row.entity_id);
		const key = `${entityType}:${entityId}`;
		if (seen.has(key)) continue;

		if (entityType === 'trip') {
			const trip = tripsRepo.getTripById(entityId);
			if (!trip || !canView(userId, trip)) continue;
		} else if (entityType === 'segment') {
			const seg = segmentsRepo.getSegmentById(entityId);
			if (!seg) continue;
			const trip = tripsRepo.getTripById(seg.tripId);
			if (!trip || !canView(userId, trip)) continue;
		} else {
			continue;
		}

		seen.add(key);
		hits.push({
			entityType,
			entityId,
			ownerId: Number(row.owner_id),
			title: row.title as string,
			body: row.body as string,
			href: row.href as string
		});
		if (hits.length >= limit) break;
	}
	return hits;
}

export { parseEmbeddingsConfig, serializeEmbeddingsConfig, DEFAULT_EMBEDDINGS_CONFIG };
export type { EmbeddingsConfig };
