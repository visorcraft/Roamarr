<script lang="ts">
	import { onMount } from 'svelte';
	let { data, form } = $props();
	const config = $derived(data.config);
	let useImapForSmtp = $state(true);
	let aiEnabled = $state(false);
	onMount(() => {
		useImapForSmtp = config?.useImapForSmtp ?? true;
		aiEnabled = config?.aiEnabled ?? false;
	});
</script>

<header class="page-header">
	<div><h1 class="page-title">Email processing</h1><p class="page-subtitle">Import travel confirmations from your inbox and send notifications.</p></div>
</header>

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

<form method="POST" action="?/save" class="mt-6 space-y-6">
	{#if data.allowUserImap}
	<section class="card p-5 sm:p-6">
		<h2 class="section-title">IMAP settings for trip processing</h2>
		<div class="settings-rows mt-4">
			<div class="settings-row"><div><label class="checkbox-label" for="enabled"><input id="enabled" name="enabled" type="checkbox" class="checkbox" checked={config?.enabled ?? false} />Enable processing</label><p class="field-help mt-1">Poll this inbox using the administrator schedule.</p></div></div>
			<div class="settings-row"><label class="label" for="imapHost">IMAP host</label><input id="imapHost" name="imapHost" class="input" value={config?.imapHost ?? ''} placeholder="imap.example.com" /></div>
			<div class="settings-row"><label class="label" for="imapPort">IMAP port</label><input id="imapPort" name="imapPort" type="number" class="input" value={config?.imapPort ?? ''} placeholder="993" /></div>
			<div class="settings-row"><label class="label" for="imapSecurity">Security</label><select id="imapSecurity" name="imapSecurity" class="input"><option value="ssl/tls" selected={!config || config.imapSecurity === 'ssl/tls'}>SSL/TLS</option><option value="starttls" selected={config?.imapSecurity === 'starttls'}>STARTTLS</option><option value="none" selected={config?.imapSecurity === 'none'}>None</option></select></div>
			<div class="settings-row"><label class="label" for="imapUsername">Username</label><input id="imapUsername" name="imapUsername" class="input" value={config?.imapUsername ?? ''} autocomplete="username" /></div>
			<div class="settings-row"><div><label class="label" for="imapPassword">Password</label>{#if config?.imapPasswordSet}<p class="field-help">Stored. Leave unchanged to keep it.</p>{/if}</div><input id="imapPassword" name="imapPassword" type="password" class="input" value={config?.imapPasswordSet ? '********' : ''} autocomplete="current-password" /></div>
			<div class="settings-row"><label class="label" for="imapMailbox">Mailbox</label><input id="imapMailbox" name="imapMailbox" class="input" value={config?.imapMailbox ?? 'INBOX'} /></div>
		</div>
		{#if config?.lastPolledAt}<p class="field-help mt-3">Last checked: {config.lastPolledAt}. {config.lastError ? `Error: ${config.lastError}` : 'No error.'}</p>{/if}
	</section>
	{:else}<p class="notice">Per-user IMAP is disabled. The administrator may provide a global monitored inbox.</p>{/if}

	{#if data.allowUserSmtp}
	<section class="card p-5 sm:p-6">
		<h2 class="section-title">Notifications</h2>
		{#if data.allowUserImap}
		<label class="checkbox-label mt-4"><input bind:checked={useImapForSmtp} name="useImapForSmtp" type="checkbox" class="checkbox" />Use the same server credentials to send notifications to me</label>
		{/if}
		{#if !data.allowUserImap || !useImapForSmtp}
			<div class="settings-rows mt-4">
				<div class="settings-row"><label class="label" for="smtpHost">SMTP host</label><input id="smtpHost" name="smtpHost" class="input" value={config?.smtpHost ?? ''} /></div>
				<div class="settings-row"><label class="label" for="smtpPort">SMTP port</label><input id="smtpPort" name="smtpPort" type="number" class="input" value={config?.smtpPort ?? ''} placeholder="587" /></div>
				<div class="settings-row"><label class="label" for="smtpSecurity">Security</label><select id="smtpSecurity" name="smtpSecurity" class="input"><option value="starttls" selected={!config || config.smtpSecurity === 'starttls'}>STARTTLS</option><option value="ssl/tls" selected={config?.smtpSecurity === 'ssl/tls'}>SSL/TLS</option><option value="none" selected={config?.smtpSecurity === 'none'}>None</option></select></div>
				<div class="settings-row"><label class="label" for="smtpUsername">Username</label><input id="smtpUsername" name="smtpUsername" class="input" value={config?.smtpUsername ?? ''} /></div>
				<div class="settings-row"><label class="label" for="smtpPassword">Password</label><input id="smtpPassword" name="smtpPassword" type="password" class="input" value={config?.smtpPasswordSet ? '********' : ''} /></div>
				<div class="settings-row"><label class="label" for="smtpFrom">From address</label><input id="smtpFrom" name="smtpFrom" type="email" class="input" value={config?.smtpFrom ?? ''} /></div>
			</div>
		{/if}
	</section>
	{/if}

	{#if data.allowUserParsingProviders}
	<section class="card p-5 sm:p-6">
		<h2 class="section-title">Parsing</h2>
		<label class="checkbox-label mt-4"><input bind:checked={aiEnabled} name="aiEnabled" type="checkbox" class="checkbox" />Use an OpenAI-compatible API</label>
		{#if aiEnabled}
			<div class="settings-rows mt-4">
				<div class="settings-row"><label class="label" for="aiBaseUrl">API base URL</label><input id="aiBaseUrl" name="aiBaseUrl" type="url" class="input" value={config?.aiBaseUrl ?? ''} placeholder="https://api.example.com/v1" /></div>
				<div class="settings-row"><label class="label" for="aiModel">Model</label><input id="aiModel" name="aiModel" class="input" value={config?.aiModel ?? ''} /></div>
				<div class="settings-row"><label class="label" for="aiToken">Bearer token</label><input id="aiToken" name="aiToken" type="password" class="input" value={config?.aiTokenSet ? '********' : ''} /></div>
				<div class="settings-row"><div><label class="label" for="aiTokenUrl">OAuth token URL</label><p class="field-help">Optional client-credentials flow instead of a static bearer token.</p></div><input id="aiTokenUrl" name="aiTokenUrl" type="url" class="input" value={config?.aiTokenUrl ?? ''} /></div>
				<div class="settings-row"><label class="label" for="aiClientId">OAuth client ID</label><input id="aiClientId" name="aiClientId" class="input" value={config?.aiClientId ?? ''} /></div>
				<div class="settings-row"><label class="label" for="aiClientSecret">OAuth client secret</label><input id="aiClientSecret" name="aiClientSecret" type="password" class="input" value={config?.aiClientSecretSet ? '********' : ''} /></div>
				<div class="settings-row"><label class="label" for="aiScope">OAuth scope</label><input id="aiScope" name="aiScope" class="input" value={config?.aiScope ?? ''} /></div>
			</div>
		{:else}<p class="field-help mt-3">Default no-AI processing uses dates, confirmation codes, travel terms, destinations, and trip overlap.</p>{/if}
	</section>
	{/if}

	<div class="flex flex-wrap justify-end gap-2"><button class="btn btn-primary">Save settings</button>{#if data.allowUserImap}<button class="btn btn-ghost" formaction="?/pollNow">Check inbox now</button>{/if}<button class="btn btn-ghost" formaction="?/testEmail">Send test email</button></div>
</form>
