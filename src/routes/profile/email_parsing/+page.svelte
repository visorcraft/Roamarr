<script lang="ts">
	import { onMount } from 'svelte';
	import EmailProcessingTabs from '$lib/components/EmailProcessingTabs.svelte';
	let { data, form } = $props();
	const config = $derived(data.config);
	let aiEnabled = $state(false);
	let aiAuthMode = $state<'token' | 'oauth'>('token');
	onMount(() => {
		aiEnabled = config?.aiEnabled ?? false;
		aiAuthMode = config?.aiTokenUrl || config?.aiClientId ? 'oauth' : 'token';
	});
</script>

<header class="page-header"><div><h1 class="page-title">Email Settings</h1><p class="page-subtitle">Import travel confirmations and control notification delivery.</p></div></header>
<EmailProcessingTabs />
{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

{#if data.allowUserParsingProviders}
	<form method="POST" action="?/save" class="mt-6">
		<input type="hidden" name="section" value="parsing" />
		<section class="card p-5 sm:p-6">
			<h2 class="section-title">Parsing</h2>
			<p class="field-help mt-1">API base URL, model, and one authentication method are required when enabled.</p>
			<label class="checkbox-label mt-4"><input bind:checked={aiEnabled} name="aiEnabled" type="checkbox" class="checkbox" />Use an OpenAI-compatible API</label>
			{#if aiEnabled}
				<div class="settings-rows mt-4">
					<div class="settings-row"><div><label class="label" for="aiBaseUrl">API base URL <span aria-hidden="true">*</span></label><p class="field-help">Provider root ending before <code>/chat/completions</code>.</p></div><input id="aiBaseUrl" name="aiBaseUrl" type="url" class="input" value={config?.aiBaseUrl ?? ''} placeholder="https://api.example.com/v1" /></div>
					<div class="settings-row"><div><label class="label" for="aiModel">Model <span aria-hidden="true">*</span></label><p class="field-help">Exact model ID documented by the provider.</p></div><input id="aiModel" name="aiModel" class="input" value={config?.aiModel ?? ''} /></div>
					<div class="settings-row items-start"><div><span class="label">Authentication <span aria-hidden="true">*</span></span><p class="field-help">Choose the credential type issued by your provider.</p></div><div class="space-y-2"><label class="checkbox-label"><input bind:group={aiAuthMode} name="aiAuthMode" type="radio" value="token" />API/Subscription Key</label><label class="checkbox-label"><input bind:group={aiAuthMode} name="aiAuthMode" type="radio" value="oauth" />OAuth Credentials</label></div></div>
					{#if aiAuthMode === 'token'}
						<div class="settings-row"><div><label class="label" for="aiToken">API/Subscription Key</label><p class="field-help">API key or subscription key issued by the provider.</p></div><div><input id="aiToken" name="aiToken" type="password" class="input" value={config?.aiTokenSet ? '********' : ''} />{#if config?.aiTokenSet}<label class="checkbox-label mt-2 text-xs"><input type="checkbox" name="clearAiToken" class="checkbox" />Clear stored key</label>{/if}</div></div>
					{:else}
						<div class="settings-row"><div><label class="label" for="aiTokenUrl">OAuth token URL</label><p class="field-help">Required with client ID and client secret.</p></div><input id="aiTokenUrl" name="aiTokenUrl" type="url" class="input" value={config?.aiTokenUrl ?? ''} /></div>
						<div class="settings-row"><div><label class="label" for="aiClientId">OAuth client ID</label><p class="field-help">Issued by the provider.</p></div><input id="aiClientId" name="aiClientId" class="input" value={config?.aiClientId ?? ''} /></div>
						<div class="settings-row"><div><label class="label" for="aiClientSecret">OAuth client secret</label><p class="field-help">Issued with the client ID.</p></div><div><input id="aiClientSecret" name="aiClientSecret" type="password" class="input" value={config?.aiClientSecretSet ? '********' : ''} />{#if config?.aiClientSecretSet}<label class="checkbox-label mt-2 text-xs"><input type="checkbox" name="clearAiClientSecret" class="checkbox" />Clear stored client secret</label>{/if}</div></div>
						<div class="settings-row"><div><label class="label" for="aiScope">OAuth scope</label><p class="field-help">Optional. Leave blank unless required by the provider.</p></div><input id="aiScope" name="aiScope" class="input" value={config?.aiScope ?? ''} /></div>
					{/if}
				</div>
			{:else}<p class="field-help mt-3">Without AI, parsing matches are best effort but may fall short on accuracy.</p>{/if}
			<div class="mt-6 flex justify-end"><button class="btn btn-primary">Save</button></div>
		</section>
	</form>
{:else}<p class="notice mt-6">Per-user parsing providers are disabled. Global or default parsing will be used.</p>{/if}
