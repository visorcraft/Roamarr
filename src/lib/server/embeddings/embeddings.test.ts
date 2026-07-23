import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { eq } from '@visorcraft/mongreldb-kit';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const context = vi.hoisted(() => ({ kit: null as never }));
vi.mock('../db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(context, freshDb());
	return context;
});

import { searchDocuments } from '../db/mongrelSchema';
import { makeUser, makeTrip, makeSegment } from '../../../../tests/helpers';
import {
	disableEmbeddings,
	enableEmbeddings,
	embeddingsReady,
	getEmbeddingsConfig,
	semanticSearch,
	setEmbeddingsConfig,
	DEFAULT_EMBEDDINGS_CONFIG
} from './index';
import { hashEmbed, setTestEmbedFn } from './model';
import { globalSearch } from './search';

const db = () => (context as { kit: KitDatabase }).kit;

beforeEach(() => {
	setTestEmbedFn(async (text) => hashEmbed(text));
	setEmbeddingsConfig({ ...DEFAULT_EMBEDDINGS_CONFIG });
	for (const row of db().selectFrom(searchDocuments).executeSync()) {
		db().deleteFrom(searchDocuments).where(eq(searchDocuments.id, row.id)).executeSync();
	}
});

afterEach(() => {
	setTestEmbedFn(null);
	setEmbeddingsConfig({ ...DEFAULT_EMBEDDINGS_CONFIG });
});

test('embeddings default to disabled', () => {
	expect(getEmbeddingsConfig().enabled).toBe(false);
	expect(embeddingsReady()).toBe(false);
});

test('enableEmbeddings indexes trips and powers semantic search', async () => {
	const user = makeUser(db(), { email: 'emb-a@x.c' });
	const trip = makeTrip(db(), user.id, {
		name: 'Kyoto Cherry Blossom Week',
		destinationCityName: 'Kyoto'
	});
	makeSegment(db(), trip.id, {
		title: 'Train to Gion',
		type: 'train',
		location: 'Gion'
	});

	const cfg = await enableEmbeddings();
	expect(cfg.status).toBe('ready');
	expect(embeddingsReady()).toBe(true);

	const hits = await semanticSearch(user.id, 'japan spring flowers temple district', 10);
	expect(hits.length).toBeGreaterThan(0);
	const types = new Set(hits.map((h) => h.entityType));
	expect(types.has('trip') || types.has('segment')).toBe(true);

	const global = await globalSearch(user.id, 'cherry blossom japan');
	expect(global.semantic).toBe(true);
	expect(global.trips.some((t) => t.id === trip.id)).toBe(true);
});

test('disableEmbeddings turns off semantic ranking', async () => {
	const user = makeUser(db(), { email: 'emb-b@x.c' });
	makeTrip(db(), user.id, { name: 'Paris Weekend' });
	await enableEmbeddings();
	expect(embeddingsReady()).toBe(true);
	disableEmbeddings();
	expect(embeddingsReady()).toBe(false);
	const global = await globalSearch(user.id, 'Paris');
	expect(global.semantic).toBe(false);
	expect(global.trips.some((t) => t.name.includes('Paris'))).toBe(true);
});
