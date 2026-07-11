<script lang="ts">
	import { onMount } from 'svelte';
	import EmailProcessingTabs from '$lib/components/EmailProcessingTabs.svelte';
	let { data, form } = $props();
	const config = $derived(data.config);
	let enabled = $state(false);
	onMount(() => enabled = config?.enabled ?? false);
</script>

<header class="page-header"><div><h1 class="page-title">Email processing</h1><p class="page-subtitle">Import travel confirmations and control notification delivery.</p></div></header>
<EmailProcessingTabs />
{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

{#if data.allowUserImap}
	<form method="POST" action="?/save" class="mt-6">
		<input type="hidden" name="section" value="inbound" />
		<section class="card p-5 sm:p-6">
			<h2 class="section-title">IMAP settings for trip processing</h2>
			<div class="settings-rows mt-4">
				<div class="settings-row"><div><label class="checkbox-label" for="enabled"><input id="enabled" name="enabled" type="checkbox" class="checkbox" bind:checked={enabled} />Enable processing</label><p class="field-help mt-1">Poll this inbox using the administrator schedule.</p></div></div>
				{#if enabled}
				<div class="settings-row"><label class="label" for="imapHost">IMAP host</label><input id="imapHost" name="imapHost" class="input" value={config?.imapHost ?? ''} placeholder="imap.example.com" /></div>
				<div class="settings-row"><label class="label" for="imapPort">IMAP port</label><input id="imapPort" name="imapPort" type="number" class="input" value={config?.imapPort ?? ''} placeholder="993" /></div>
				<div class="settings-row"><label class="label" for="imapSecurity">Security</label><select id="imapSecurity" name="imapSecurity" class="input"><option value="ssl/tls" selected={!config || config.imapSecurity === 'ssl/tls'}>SSL/TLS</option><option value="starttls" selected={config?.imapSecurity === 'starttls'}>STARTTLS</option><option value="none" selected={config?.imapSecurity === 'none'}>None</option></select></div>
				<div class="settings-row"><label class="label" for="imapUsername">Username</label><input id="imapUsername" name="imapUsername" class="input" value={config?.imapUsername ?? ''} autocomplete="username" /></div>
				<div class="settings-row"><div><label class="label" for="imapPassword">Password</label>{#if config?.imapPasswordSet}<p class="field-help">Stored. Leave unchanged to keep it.</p>{/if}</div><input id="imapPassword" name="imapPassword" type="password" class="input" value={config?.imapPasswordSet ? '********' : ''} autocomplete="current-password" /></div>
				<div class="settings-row"><label class="label" for="imapMailbox">Mailbox</label><input id="imapMailbox" name="imapMailbox" class="input" value={config?.imapMailbox ?? 'INBOX'} /></div>
				{/if}
			</div>
			{#if enabled && config?.lastPolledAt}<p class="field-help mt-3">Last checked: {config.lastPolledAt}. {config.lastError ? `Error: ${config.lastError}` : 'No error.'}</p>{/if}
			<div class="mt-6 flex justify-end gap-2">{#if enabled}<button class="btn btn-ghost" formaction="?/pollNow">Check inbox now</button>{/if}<button class="btn btn-primary">Save</button></div>
		</section>
	</form>
{:else}<p class="notice mt-6">Per-user IMAP is disabled. The administrator may provide a global monitored inbox.</p>{/if}
