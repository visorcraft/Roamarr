<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	let { active }: { active: string } = $props();
	const tabs = [
		{ id: 'access', label: m.admin_email_tabs_access },
		{ id: 'inbound', label: m.admin_email_tabs_inbound },
		{ id: 'parsing', label: m.admin_email_tabs_parsing },
		{ id: 'outbound', label: m.admin_email_tabs_outbound }
	];
</script>

<nav class="tab-list visited-tab-list" aria-label={m.admin_email_tabs_label()}>
	{#each tabs as tab}
		<a href="/general/email?section={tab.id}" aria-current={active === tab.id ? 'page' : undefined} class="tab-link {active === tab.id ? 'tab-link-active' : ''}">{tab.label()}</a>
	{/each}
</nav>
