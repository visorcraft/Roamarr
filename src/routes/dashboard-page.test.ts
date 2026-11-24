import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://x/') } }));

const fixture = {
	user: { displayName: 'Ada Lovelace' },
	stats: { upcoming: 3, unread: 2, expiring: 1, watches: 4 },
	agenda: [],
	upcoming: [],
	expiring: [],
	paymentsDue: [],
	activity: []
};

function cardBlocks(body: string) {
	return body.match(/<a [^>]*class="metric-card group"[^>]*>[\s\S]*?<\/a>/g) ?? [];
}

test('dashboard stat cards keep their href, label and value', () => {
	const { body } = render(Page, { props: { data: fixture } as any });
	const blocks = cardBlocks(body);
	expect(blocks).toHaveLength(4);
	const expected = [
		{ href: '/trips', label: 'Upcoming trips', value: '3' },
		{ href: '/notifications', label: 'Unread alerts', value: '2' },
		{ href: '/profile/documents', label: 'Docs expiring', value: '1' },
		{ href: '/fare-providers', label: 'Fare watches', value: '4' }
	];
	for (const [i, { href, label, value }] of expected.entries()) {
		expect(blocks[i]).toContain(`href="${href}"`);
		expect(blocks[i]).toContain(`>${value}</div>`);
		expect(blocks[i]).toContain(label);
		expect(blocks[i].indexOf(`href="${href}"`)).toBeLessThan(blocks[i].indexOf(`>${value}</div>`));
		expect(blocks[i].indexOf(`>${value}</div>`)).toBeLessThan(blocks[i].indexOf(label));
	}
});

test('dashboard stat values use readable theme tokens', () => {
	const { body } = render(Page, { props: { data: fixture } as any });
	const blocks = cardBlocks(body);
	expect(blocks).toHaveLength(4);
	expect(blocks[0]).toContain('text-indigo-300');
	expect(blocks[1]).toContain('text-[var(--theme-readable-warning)]');
	expect(blocks[2]).toContain('text-[var(--theme-readable-success)]');
	expect(blocks[3]).toContain('text-fuchsia-500');
});

test('dashboard renders no fixed pastel accent classes', () => {
	const { body } = render(Page, { props: { data: fixture } as any });
	expect(body).not.toMatch(/(?:text|bg|border)-(?:amber|emerald|fuchsia)-300/);
});
