<script lang="ts">
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';

	const tabs = [
		{ id: 'password', label: m.security_tabs_password() },
		{ id: '2fa', label: m.security_tabs_2fa() },
		{ id: 'passkeys', label: m.security_tabs_passkeys() }
	];

	const activeTab = $derived(page.url.searchParams.get('tab') ?? tabs[0].id);
</script>

<nav class="tab-list visited-tab-list mt-6" aria-label={m.security_tabs_label()}>
	{#each tabs as t (t.id)}
		<a href="/profile/security?tab={t.id}" aria-current={activeTab === t.id ? 'page' : undefined} class="tab-link {activeTab === t.id ? 'tab-link-active' : ''}">{t.label}</a>
	{/each}
</nav>
