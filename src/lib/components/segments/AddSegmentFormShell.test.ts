import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import type { Snippet } from 'svelte';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import AddSegmentFormShell from './AddSegmentFormShell.svelte';

const children = (() => 'child content') as unknown as Snippet;

const expectedMessages: Record<string, string> = {
	segment_new_back_to_trip: 'Back to x',
	segment_new_title: 'Add x',
	segment_new_subtitle: 'Fill in the details below.',
	segment_new_back: 'Back',
	segment_new_documents_label: 'Documents (optional)',
	segment_new_documents_hint: 'Attach PDFs or images such as QR codes, vouchers, or booking confirmations (JPEG, PNG, WebP, or PDF, max 10\u00a0MB each).',
	segment_new_save: 'Save',
	common_cancel: 'Cancel'
};

test('catalog messages match the English strings', () => {
	const fn = (m as Record<string, (i?: unknown) => string>)['segment_new_back_to_trip'];
	expect(fn({ name: 'x' })).toBe(expectedMessages.segment_new_back_to_trip);
	const title = (m as Record<string, (i?: unknown) => string>)['segment_new_title'];
	expect(title({ label: 'x' })).toBe(expectedMessages.segment_new_title);
	for (const [key, expected] of Object.entries(expectedMessages)) {
		if (key === 'segment_new_back_to_trip' || key === 'segment_new_title') continue;
		const fn = (m as Record<string, (i?: unknown) => string>)[key];
		expect(typeof fn).toBe('function');
		expect(fn()).toBe(expected);
	}
});

test('shell renders catalog strings and preserves attributes', () => {
	const { body } = render(AddSegmentFormShell, {
		props: { trip: { id: 7, name: 'R&D Summit' }, label: 'Flight', children }
	});
	expect(body).toContain('Back to R&amp;D Summit');
	expect(body).not.toContain('R&amp;amp;D');
	expect(body).toContain(' Back to R&amp;D Summit');
	expect(body).not.toContain('>Back to');
	expect(body).toContain('Add flight</h1>');
	expect(body).toContain('Fill in the details below.');
	expect(body).toContain('Documents (optional)');
	expect(body.replaceAll('&nbsp;', '\u00a0')).toContain('max 10\u00a0MB each).');
	expect(body.match(/>Back<\/a>/g)).toHaveLength(2);
	expect(body.match(/>Cancel<\/a>/g)).toHaveLength(1);
	expect(body.match(/>Save<\/button>/g)).toHaveLength(1);
	expect(body).toContain('href="/trips/7/segments/new"');
	expect(body).toContain('id="segment-documents"');
	expect(body).toContain('name="documents"');
	expect(body).toContain('accept="image/jpeg,image/png,image/webp,application/pdf,.gpx,application/gpx+xml"');
});

test('shell lower-cases the label in the title', () => {
	const { body } = render(AddSegmentFormShell, {
		props: { trip: { id: 7, name: 'Trip' }, label: 'Rental Car', children }
	});
	expect(body).toContain('Add rental car</h1>');
});

test('shell forwards form errors untouched', () => {
	const { body } = render(AddSegmentFormShell, {
		props: { trip: { id: 7, name: 'Trip' }, label: 'Flight', form: { error: 'Boom' }, children }
	});
	expect(body).toContain('notice-error');
	expect(body).toContain('Boom');
});

test('shell source reads its strings from the catalog', () => {
	const source = readFileSync(new URL('./AddSegmentFormShell.svelte', import.meta.url), 'utf8');
	expect(source).toContain("from '$lib/paraglide/messages'");
	const used = [...new Set([...source.matchAll(/m\.([a-z0-9_]+)\(/g)].map(([, key]) => key))].sort();
	expect(used).toEqual([...Object.keys(expectedMessages)].sort());
	expect(source).not.toContain('Back to {trip.name}');
	expect(source).not.toContain('Fill in the details below.');
	expect(source).not.toContain('Documents (optional)');
	expect(source).not.toContain('>Back</a>');
	expect(source).not.toContain('>Cancel</a>');
	expect(source).not.toContain('>Save</button>');
	expect(source).not.toContain('&nbsp;');
});

test('catalog declares the new keys without literal &nbsp;', () => {
	const raw = readFileSync(new URL('../../../../messages/en.json', import.meta.url), 'utf8');
	expect(raw).not.toContain('&nbsp;');
	const catalog = JSON.parse(raw);
	expect(catalog.segment_new_documents_hint).toContain('\u00a0');
});
