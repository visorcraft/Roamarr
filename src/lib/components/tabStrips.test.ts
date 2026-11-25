import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import { checkA11y, formatViolations } from '../../../tests/a11y';
// Same import shape as the components (`import { m }`), so the tests cover the namespace the app uses.
import { m } from '$lib/paraglide/messages';

// Mutable stand-in so each test can point $app/state at a different route.
const route = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({
	get page() {
		return { url: route.url };
	}
}));

import ProfileTabs from './ProfileTabs.svelte';
import SecurityTabs from './SecurityTabs.svelte';
import EmailProcessingTabs from './EmailProcessingTabs.svelte';
import AdminEmailTabs from './AdminEmailTabs.svelte';

/** Opening <a …> tags in render order, each paired with its exact href. */
const links = (html: string) =>
	[...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => ({
		tag,
		href: tag.match(/\bhref="([^"]*)"/)?.[1]
	}));
/** hrefs whose opening tag contains `needle`. */
const withAttr = (html: string, needle: string) =>
	links(html).filter((l) => l.tag.includes(needle)).map((l) => l.href);

test('ProfileTabs marks /profile active', () => {
	route.url = new URL('http://localhost/profile');
	const { body } = render(ProfileTabs);
	expect(withAttr(body, 'aria-current=')).toEqual(['/profile']);
	expect(withAttr(body, 'tab-link-active')).toEqual(['/profile']);
	expect(body.match(/aria-current/g)).toHaveLength(1);
});

test('ProfileTabs prefix match marks /profile/email active on nested paths', () => {
	route.url = new URL('http://localhost/profile/email/some-nested-path');
	const { body } = render(ProfileTabs);
	expect(withAttr(body, 'aria-current=')).toEqual(['/profile/email']);
	expect(withAttr(body, 'tab-link-active')).toEqual(['/profile/email']);
	expect(body.match(/aria-current/g)).toHaveLength(1);
});

test('SecurityTabs without a tab param defaults to password', () => {
	route.url = new URL('http://localhost/profile/security');
	const { body } = render(SecurityTabs);
	expect(withAttr(body, 'aria-current=')).toEqual(['/profile/security?tab=password']);
	expect(withAttr(body, 'tab-link-active')).toEqual(['/profile/security?tab=password']);
	expect(body.match(/aria-current/g)).toHaveLength(1);
});

test('SecurityTabs marks the ?tab=passkeys link active', () => {
	route.url = new URL('http://localhost/profile/security?tab=passkeys');
	const { body } = render(SecurityTabs);
	expect(withAttr(body, 'aria-current=')).toEqual(['/profile/security?tab=passkeys']);
	expect(withAttr(body, 'tab-link-active')).toEqual(['/profile/security?tab=passkeys']);
	expect(body.match(/aria-current/g)).toHaveLength(1);
});

test('SecurityTabs with an unknown ?tab= marks no link active', () => {
	route.url = new URL('http://localhost/profile/security?tab=nope');
	const { body } = render(SecurityTabs);
	expect(withAttr(body, 'aria-current=')).toEqual([]);
	expect(withAttr(body, 'tab-link-active')).toEqual([]);
	expect(body.match(/aria-current/g) ?? []).toHaveLength(0);
});

test('EmailProcessingTabs marks the exact-matching tab active', () => {
	route.url = new URL('http://localhost/profile/email_sender');
	const { body } = render(EmailProcessingTabs);
	expect(withAttr(body, 'aria-current=')).toEqual(['/profile/email_sender']);
	expect(withAttr(body, 'tab-link-active')).toEqual(['/profile/email_sender']);
	expect(body.match(/aria-current/g)).toHaveLength(1);
});

test('AdminEmailTabs marks the active section active', () => {
	route.url = new URL('http://localhost/general/email?section=parsing');
	const { body } = render(AdminEmailTabs, { props: { active: 'parsing' } });
	expect(withAttr(body, 'aria-current=')).toEqual(['/general/email?section=parsing']);
	expect(withAttr(body, 'tab-link-active')).toEqual(['/general/email?section=parsing']);
	expect(body.match(/aria-current/g)).toHaveLength(1);
});

test('ProfileTabs and SecurityTabs render labelled nav landmarks', () => {
	route.url = new URL('http://localhost/profile');
	const profile = render(ProfileTabs).body;
	expect(profile).toContain('<nav class="tab-list visited-tab-list mt-6" aria-label="Profile sections">');
	expect(profile).not.toContain('<div');
	expect(links(profile)).toHaveLength(5);

	route.url = new URL('http://localhost/profile/security');
	const security = render(SecurityTabs).body;
	expect(security).toContain('<nav class="tab-list visited-tab-list mt-6" aria-label="Security sections">');
	expect(security).not.toContain('<div');
	expect(links(security)).toHaveLength(3);
});

test('ProfileTabs has no axe violations', async () => {
	route.url = new URL('http://localhost/profile');
	const violations = await checkA11y(ProfileTabs, {});
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('SecurityTabs has no axe violations', async () => {
	route.url = new URL('http://localhost/profile/security');
	const violations = await checkA11y(SecurityTabs, {});
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('EmailProcessingTabs has no axe violations', async () => {
	route.url = new URL('http://localhost/profile/email_sender');
	const violations = await checkA11y(EmailProcessingTabs, {});
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('AdminEmailTabs has no axe violations', async () => {
	const violations = await checkA11y(AdminEmailTabs, { active: 'access' });
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

const expectedEmailTabsMessages: Record<string, string> = {
	email_tabs_label: 'Email settings',
	email_tabs_inbound: 'Inbound Emails',
	email_tabs_parsing: 'AI Parsing',
	email_tabs_outbound: 'Outbound Emails'
};

const expectedAdminEmailTabsMessages: Record<string, string> = {
	admin_email_tabs_label: 'Email configuration',
	admin_email_tabs_access: 'User Access',
	admin_email_tabs_inbound: 'Inbound Emails',
	admin_email_tabs_parsing: 'AI Parsing',
	admin_email_tabs_outbound: 'Outbound Emails'
};

test.each(Object.entries({ ...expectedEmailTabsMessages, ...expectedAdminEmailTabsMessages }))(
	'catalog message %s matches the English string',
	(key, expected) => {
		const fn = (m as Record<string, (i?: unknown) => string>)[key];
		expect(typeof fn).toBe('function');
		expect(fn()).toBe(expected);
	}
);

/** Anchor texts in render order, each paired with its exact href. */
const anchorTexts = (html: string) =>
	[...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map(([, attrs, text]) => ({
		href: attrs.match(/\bhref="([^"]*)"/)?.[1],
		text
	}));

test('EmailProcessingTabs renders its labels and landmark label from the catalog', () => {
	route.url = new URL('http://localhost/profile/email_parsing');
	const { body } = render(EmailProcessingTabs);
	expect(body).toContain('<nav class="tab-list visited-tab-list mt-6" aria-label="Email settings">');
	const anchors = anchorTexts(body);
	expect(anchors.map((a) => a.text)).toEqual(['Inbound Emails', 'AI Parsing', 'Outbound Emails']);
	expect(anchors.map((a) => a.href)).toEqual([
		'/profile/email_processing',
		'/profile/email_parsing',
		'/profile/email_sender'
	]);
});

test('AdminEmailTabs renders its labels and landmark label from the catalog', () => {
	const { body } = render(AdminEmailTabs, { props: { active: 'access' } });
	expect(body).toContain('<nav class="tab-list visited-tab-list" aria-label="Email configuration">');
	const anchors = anchorTexts(body);
	expect(anchors.map((a) => a.text)).toEqual(['User Access', 'Inbound Emails', 'AI Parsing', 'Outbound Emails']);
	expect(anchors.map((a) => a.href)).toEqual([
		'/general/email?section=access',
		'/general/email?section=inbound',
		'/general/email?section=parsing',
		'/general/email?section=outbound'
	]);
});

test('EmailProcessingTabs and AdminEmailTabs read their strings from the catalog, not literals', () => {
	const cases = [
		{ name: 'EmailProcessingTabs', table: expectedEmailTabsMessages, prefix: 'email_tabs_' },
		{ name: 'AdminEmailTabs', table: expectedAdminEmailTabsMessages, prefix: 'admin_email_tabs_' }
	];
	for (const { name, table, prefix } of cases) {
		const source = readFileSync(new URL(`./${name}.svelte`, import.meta.url), 'utf8');
		expect(source).toContain('from \'$lib/paraglide/messages\'');
		const matched = [...source.matchAll(new RegExp(`m\\.(${prefix}[a-z_]+)`, 'g'))].map(([, key]) => key);
		expect([...new Set(matched)].sort()).toEqual(Object.keys(table).sort());
		expect(source).not.toMatch(/label:\s*['"`]/);
		expect(source).not.toMatch(/aria-label="[^"]*"/);
	}
});
