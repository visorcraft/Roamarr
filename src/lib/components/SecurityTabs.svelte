<script lang="ts">
	import { page } from '$app/state';

	const tabs = [
		{ id: 'password', label: 'Password' },
		{ id: '2fa', label: '2FA' },
		{ id: 'passkeys', label: 'Passkeys' }
	];

	const activeTab = $derived(page.url.searchParams.get('tab') ?? tabs[0].id);
</script>

<nav class="tab-list visited-tab-list mt-6" aria-label="Security sections">
	{#each tabs as t (t.id)}
		<a href="/profile/security?tab={t.id}" aria-current={activeTab === t.id ? 'page' : undefined} class="tab-link {activeTab === t.id ? 'tab-link-active' : ''}">{t.label}</a>
	{/each}
</nav>
