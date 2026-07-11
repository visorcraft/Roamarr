<script lang="ts">
	import { onMount } from 'svelte';
	import EmailProcessingTabs from '$lib/components/EmailProcessingTabs.svelte';
	let { data, form } = $props();
	const config = $derived(data.config);
	let useImapForSmtp = $state(true);
	onMount(() => useImapForSmtp = config?.useImapForSmtp ?? true);
</script>

<header class="page-header"><div><h1 class="page-title">Email Settings</h1><p class="page-subtitle">Import travel confirmations and control notification delivery.</p></div></header>
<EmailProcessingTabs />
{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

{#if data.allowUserSmtp}
	<form method="POST" action="?/save" class="mt-6">
		<input type="hidden" name="section" value="sender" />
		<section class="card p-5 sm:p-6">
			<h2 class="section-title">SMTP settings for email notifications</h2>
			{#if data.allowUserImap}<label class="checkbox-label mt-4"><input bind:checked={useImapForSmtp} name="useImapForSmtp" type="checkbox" class="checkbox" />Use the same server credentials as Inbound Emails</label>{/if}
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
			<div class="mt-6 flex justify-end gap-2"><button class="btn btn-ghost" formaction="?/testEmail">Send test email</button><button class="btn btn-primary">Save</button></div>
		</section>
	</form>
{:else}<p class="notice mt-6">Per-user SMTP is disabled. Global outbound email settings will be used.</p>{/if}
