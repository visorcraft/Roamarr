<script lang="ts">
	let { active }: { active: string } = $props();
	const tabs = [
		{ id: 'access', label: 'User Access' },
		{ id: 'inbound', label: 'Inbound Emails' },
		{ id: 'parsing', label: 'AI Parsing' },
		{ id: 'outbound', label: 'Outbound Emails' }
	];
</script>

<nav class="tab-list visited-tab-list" aria-label="Email configuration">
	{#each tabs as tab}
		<a href="/general/email?section={tab.id}" class="tab-link {active === tab.id ? 'tab-link-active' : ''}">{tab.label}</a>
	{/each}
</nav>
