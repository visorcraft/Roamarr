<script lang="ts">
	import { page } from '$app/state';

	const tabs = [
		{ href: '/profile', label: 'Profile' },
		{ href: '/profile/email', label: 'Email' },
		{ href: '/profile/sessions', label: 'Sessions' },
		{ href: '/profile/calendar', label: 'Calendar' },
		{ href: '/profile/theme', label: 'Theme' }
	];

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/profile') return path === '/profile';
		return path === href || path.startsWith(href + '/');
	}
</script>

<div class="tab-list visited-tab-list mt-6">
	{#each tabs as t (t.href)}
		<a href={t.href} class="tab-link {isActive(t.href) ? 'tab-link-active' : ''}">{t.label}</a>
	{/each}
</div>
