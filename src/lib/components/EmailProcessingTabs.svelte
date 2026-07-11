<script lang="ts">
	import { page } from '$app/state';

	const tabs = [
		{ href: '/profile/email_processing', label: 'Inbound Emails' },
		{ href: '/profile/email_parsing', label: 'AI Parsing' },
		{ href: '/profile/email_sender', label: 'Outbound Emails' }
	];
</script>

<nav class="tab-list visited-tab-list mt-6" aria-label="Email processing settings">
	{#each tabs as tab}
		<a href={tab.href} class="tab-link {page.url.pathname === tab.href ? 'tab-link-active' : ''}">{tab.label}</a>
	{/each}
</nav>
