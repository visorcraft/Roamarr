import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import Icon, { ICON_PATHS, type IconName } from './Icon.svelte';

const NAMES = Object.keys(ICON_PATHS) as IconName[];

test.each(NAMES)('renders an svg for icon "%s"', (name) => {
	const { body } = render(Icon, { props: { name } });
	expect(body).toContain('<svg');
	expect(body).toContain('</svg>');
	expect(body).toContain('aria-hidden="true"');
	expect(body).toContain('viewBox="0 0 24 24"');
});

test('applies the provided class', () => {
	const { body } = render(Icon, { props: { name: 'plus', class: 'h-6 w-6 text-indigo-400' } });
	expect(body).toContain('h-6');
	expect(body).toContain('w-6');
	expect(body).toContain('text-indigo-400');
});

test('renders default size when class is omitted', () => {
	const { body } = render(Icon, { props: { name: 'check' } });
	expect(body).toContain('h-5');
	expect(body).toContain('w-5');
});

test('icon path content is present for known icons', () => {
	const { body } = render(Icon, { props: { name: 'plus' } });
	expect(body).toContain('M5 12h14');
	expect(body).toContain('M12 5v14');
});
