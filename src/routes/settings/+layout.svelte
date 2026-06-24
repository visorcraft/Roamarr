<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();

	const tabs = [
		{ href: '/settings', label: 'General' },
		{ href: '/settings/users', label: 'Users' },
		{ href: '/settings/fare-providers', label: 'Fare providers' },
		{ href: '/settings/jobs', label: 'Jobs' },
		{ href: '/settings/audit-logs', label: 'Audit log' },
		{ href: '/settings/backup', label: 'Backup' },
		{ href: '/settings/seed', label: 'Seed' }
	];

	const path = $derived(page.url.pathname);
	// General is the index route, so match it exactly; sub-tabs match by prefix.
	const isActive = (href: string) =>
		href === '/settings' ? path === '/settings' : path.startsWith(href);
</script>

<nav class="-mb-px flex gap-6 overflow-x-auto border-b border-white/10 text-sm font-medium">
	{#each tabs as tab (tab.href)}
		<a
			href={tab.href}
			aria-current={isActive(tab.href) ? 'page' : undefined}
			class="whitespace-nowrap border-b-2 px-1 pb-3 transition {isActive(tab.href)
				? 'border-indigo-400 text-indigo-300'
				: 'border-transparent text-slate-400 hover:border-white/20 hover:text-white'}"
		>
			{tab.label}
		</a>
	{/each}
</nav>

<div class="mt-8">
	{@render children()}
</div>
