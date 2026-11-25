<script lang="ts">
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';

	const tabs = [
		{ href: '/profile', label: m.profile_tabs_profile() },
		{ href: '/profile/email', label: m.profile_tabs_email() },
		{ href: '/profile/sessions', label: m.profile_tabs_sessions() },
		{ href: '/profile/calendar', label: m.profile_tabs_calendar() },
		{ href: '/profile/theme', label: m.profile_tabs_theme() }
	];

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/profile') return path === '/profile';
		return path === href || path.startsWith(href + '/');
	}
</script>

<nav class="tab-list visited-tab-list mt-6" aria-label={m.profile_tabs_label()}>
	{#each tabs as t (t.href)}
		<a href={t.href} aria-current={isActive(t.href) ? 'page' : undefined} class="tab-link {isActive(t.href) ? 'tab-link-active' : ''}">{t.label}</a>
	{/each}
</nav>
