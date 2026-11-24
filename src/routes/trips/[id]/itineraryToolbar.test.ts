import { expect, test } from 'vitest';
import { sortToggleState } from './itineraryToolbar';

test('sortToggleState pairs the earliest-first label with the up-down glyph', () => {
	expect(sortToggleState(true)).toEqual({ label: 'Sort: earliest first', glyph: '↑↓' });
});

test('sortToggleState pairs the latest-first label with the down-up glyph', () => {
	expect(sortToggleState(false)).toEqual({ label: 'Sort: latest first', glyph: '↓↑' });
});
