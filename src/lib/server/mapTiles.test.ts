import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { tileCspOrigins } from './mapTiles';
import { settings } from './db/schema';
import { eq } from 'drizzle-orm';

function setProvider(patch: Record<string, unknown>) {
	(ctx as { db: import('./db').DB }).db.update(settings).set(patch).where(eq(settings.id, 1)).run();
}

beforeEach(() => {
	setProvider({ mapsTileProvider: 'openstreetmap', mapsTileUrl: null });
});

test('returns the default provider origin', () => {
	expect(tileCspOrigins()).toEqual(['https://tile.openstreetmap.org']);
});

test('expands {s} subdomains into distinct origins', () => {
	setProvider({ mapsTileProvider: 'carto', mapsTileUrl: null });
	const origins = tileCspOrigins();
	expect(origins).toContain('https://a.basemaps.cartocdn.com');
	expect(origins).toContain('https://d.basemaps.cartocdn.com');
});

test('returns origin only and never leaks an embedded API key', () => {
	setProvider({
		mapsTileProvider: 'custom',
		mapsTileUrl: 'https://tiles.example.com/{z}/{x}/{y}.png?key=SECRET123'
	});
	const origins = tileCspOrigins();
	expect(origins).toEqual(['https://tiles.example.com']);
	expect(origins.join(' ')).not.toContain('SECRET123');
});
