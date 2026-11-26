import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import SegmentIcon from './SegmentIcon.svelte';
import { SEG, SEGMENT_TYPES, type SegmentType } from '$lib/segmentLabels';

test.each(SEGMENT_TYPES)('renders an svg for segment type "%s"', (type) => {
	const { body } = render(SegmentIcon, { props: { type } });
	expect(body).toContain('<svg');
	expect(body).toContain('</svg>');
	expect(body).toContain('aria-hidden="true"');
	expect(body).toContain('viewBox="0 0 24 24"');
	expect(body).toContain(SEG[type as SegmentType].icon);
});

test('applies the provided class alongside shrink-0', () => {
	const { body } = render(SegmentIcon, { props: { type: 'flight', class: 'h-4 w-4' } });
	expect(body).toContain('shrink-0 h-4 w-4');
});

test('omits trailing space when class is omitted', () => {
	const { body } = render(SegmentIcon, { props: { type: 'flight' } });
	expect(body).toContain('class="shrink-0"');
	expect(body).not.toContain('class="shrink-0 ');
});

test('safely renders an empty svg for unknown segment types', () => {
	const { body } = render(SegmentIcon, { props: { type: 'not-a-segment-type' } });
	expect(body).toContain('<svg');
	expect(body).toContain('aria-hidden="true"');
	expect(body).not.toContain('<path');
	expect(body).not.toContain('<rect');
});
