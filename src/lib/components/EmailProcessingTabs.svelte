<script lang="ts">
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';

	const tabs = [
		{ href: '/profile/email_processing', label: m.email_tabs_inbound },
		{ href: '/profile/email_parsing', label: m.email_tabs_parsing },
		{ href: '/profile/email_sender', label: m.email_tabs_outbound }
	];
</script>

<nav class="tab-list visited-tab-list mt-6" aria-label={m.email_tabs_label()}>
	{#each tabs as tab}
		<a href={tab.href} aria-current={page.url.pathname === tab.href ? 'page' : undefined} class="tab-link {page.url.pathname === tab.href ? 'tab-link-active' : ''}">{tab.label()}</a>
	{/each}
</nav>
