import { describe, it, expect } from 'vitest';
import { isActive, activeChildHref, activeItemHref } from './navActive';

describe('isActive', () => {
	it('matches the root route exactly', () => {
		expect(isActive('/', '/')).toBe(true);
		expect(isActive('/trips', '/')).toBe(false);
	});

	it('matches exact routes', () => {
		expect(isActive('/trips', '/trips')).toBe(true);
		expect(isActive('/trips/new', '/trips')).toBe(true);
		expect(isActive('/profile', '/profile/contacts')).toBe(false);
	});
});

describe('activeChildHref', () => {
	const children = [
		{ href: '/profile', label: 'Account' },
		{ href: '/profile/contacts', label: 'Emergency Contacts' },
		{ href: '/profile/visited/countries', label: 'Countries' },
		{ href: '/profile/visited/states', label: 'U.S. States' }
	];

	it('selects the exact child on /profile', () => {
		expect(activeChildHref('/profile', children)).toBe('/profile');
	});

	it('selects the most specific child on /profile/contacts', () => {
		expect(activeChildHref('/profile/contacts', children)).toBe('/profile/contacts');
	});

	it('does not fall back to the parent-equivalent child on a sibling page', () => {
		const href = activeChildHref('/profile/contacts', children);
		expect(href).not.toBe('/profile');
	});

	it('selects the deepest matching child on /profile/visited/countries', () => {
		expect(activeChildHref('/profile/visited/countries', children)).toBe('/profile/visited/countries');
	});

	it('returns null when no child matches', () => {
		expect(activeChildHref('/trips', children)).toBeNull();
	});

	it('matches alternate paths to one child', () => {
		expect(activeChildHref('/profile/email_parsing', [
			{ href: '/profile/email_processing', label: 'Email Settings', activePaths: ['/profile/email_parsing', '/profile/email_sender'] }
		])).toBe('/profile/email_processing');
	});
});

describe('activeItemHref', () => {
	const items = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/trips', label: 'Trips' },
		{ href: '/profile', label: 'Profile', children: [{ href: '/profile', label: 'Account' }] },
		{ href: '/profile/loyalty', label: 'Loyalty' },
		{ href: '/profile/visited', label: 'Visited', children: [{ href: '/profile/visited/countries', label: 'Countries' }] },
		{ href: '/maintenance', label: 'Maintenance', children: [{ href: '/jobs', label: 'Scheduled Jobs' }] }
	];

	it('selects the exact item on /profile', () => {
		expect(activeItemHref('/profile', items)).toBe('/profile');
	});

	it('selects the more specific sibling on /profile/loyalty', () => {
		expect(activeItemHref('/profile/loyalty', items)).toBe('/profile/loyalty');
	});

	it('does not mark Profile active on /profile/loyalty', () => {
		const href = activeItemHref('/profile/loyalty', items);
		expect(href).not.toBe('/profile');
	});

	it('selects the deepest matching item on /profile/visited/countries', () => {
		expect(activeItemHref('/profile/visited/countries', items)).toBe('/profile/visited');
	});

	it('selects parent items from child-only route matches', () => {
		expect(activeItemHref('/jobs', items)).toBe('/maintenance');
	});

	it('returns null when no item matches', () => {
		expect(activeItemHref('/notifications', [{ href: '/trips', label: 'Trips' }])).toBeNull();
	});
});
