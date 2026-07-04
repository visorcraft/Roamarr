<script lang="ts">
	import { page } from '$app/state';

	let { data, children } = $props();

	const adminTabs = [
		{ href: '/settings', label: 'General' },
		{ href: '/settings/users', label: 'Users' },
		{ href: '/settings/fare-providers', label: 'Fare providers' },
		{ href: '/settings/jobs', label: 'Jobs' },
		{ href: '/settings/audit-logs', label: 'Audit log' },
		{ href: '/settings/backup', label: 'Backup' },
		{ href: '/settings/maintenance', label: 'Maintenance' },
		{ href: '/settings/seed', label: 'Seed' },
		{ href: '/settings/about', label: 'About' }
	];
	const aboutTabs = [{ href: '/settings/about', label: 'About' }];

	const path = $derived(page.url.pathname);
	const tabs = $derived(data.user?.role === 'admin' ? adminTabs : aboutTabs);
	// General is the index route, so match it exactly; sub-tabs match by prefix.
	const isActive = (href: string) =>
		href === '/settings' ? path === '/settings' : path.startsWith(href);
</script>

<nav class="tab-list">
	{#each tabs as tab (tab.href)}
		<a
			href={tab.href}
			aria-current={isActive(tab.href) ? 'page' : undefined}
			class="tab-link {isActive(tab.href) ? 'tab-link-active' : ''}"
		>
			{tab.label}
		</a>
	{/each}
</nav>

<div class="mt-8">
	{@render children()}
</div>
