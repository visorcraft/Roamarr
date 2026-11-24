import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import { checkA11y, formatViolations } from '../../../tests/a11y';

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
