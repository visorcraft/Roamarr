<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';

	let { data } = $props();
	const s = $derived(data.settings);
</script>

<header>
	<h1 class="text-3xl font-extrabold text-white">General</h1>
	<p class="mt-1 text-sm text-muted">Configure your Roamarr instance and outgoing email.</p>
</header>

<form method="POST" class="mt-8 grid max-w-4xl gap-6">
	<section class="card p-5 sm:p-6">
		<h2 class="section-title">General</h2>
		<div class="settings-rows">
			<div class="settings-row">
				<div>
					<label class="label" for="instanceName">Instance name</label>
					<p class="field-help">The display name for this Roamarr instance.</p>
				</div>
				<input id="instanceName" name="instanceName" value={s.instanceName} class="input" />
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="defaultTimezone">Default timezone</label>
					<p class="field-help">Used when a trip or segment has no timezone set.</p>
				</div>
				<TimezoneSelect id="defaultTimezone" name="defaultTimezone" value={s.defaultTimezone} class="input" />
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="allowRegistration">Allow self-registration</label>
					<p class="field-help">Let new users create their own accounts.</p>
				</div>
				<label class="flex items-center gap-2 text-sm text-slate-300">
					<input
						id="allowRegistration"
						type="checkbox"
						name="allowRegistration"
						checked={s.allowRegistration}
						class="h-4 w-4 rounded border-white/20 bg-white/5 text-indigo-500 accent-indigo-500"
					/>
					Enabled
				</label>
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="defaultFlightCheckinLeadHours">Default flight check-in lead (hours)</label>
					<p class="field-help">Default notice period for flight check-in reminders.</p>
				</div>
				<input
					id="defaultFlightCheckinLeadHours"
					name="defaultFlightCheckinLeadHours"
					type="number"
					min="0"
					step="1"
					value={s.defaultFlightCheckinLeadHours}
					class="input"
				/>
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="defaultDocumentExpiryLeadDays">Default document expiry lead (days)</label>
					<p class="field-help">Default notice period for travel-document expiry reminders.</p>
				</div>
				<input
					id="defaultDocumentExpiryLeadDays"
					name="defaultDocumentExpiryLeadDays"
					type="number"
					min="0"
					step="1"
					value={s.defaultDocumentExpiryLeadDays}
					class="input"
				/>
			</div>
		</div>
	</section>

	<section class="card p-5 sm:p-6">
		<h2 class="section-title">Email (SMTP)</h2>
		<div class="settings-rows">
			<div class="settings-row">
				<div>
					<label class="label" for="smtpHost">Host</label>
					<p class="field-help">SMTP server hostname.</p>
				</div>
				<input id="smtpHost" name="smtpHost" value={s.smtpHost ?? ''} placeholder="smtp.example.com" class="input" />
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="smtpPort">Port</label>
					<p class="field-help">Typically 587 (STARTTLS) or 465 (TLS).</p>
				</div>
				<input id="smtpPort" name="smtpPort" type="number" value={s.smtpPort ?? ''} placeholder="587" class="input" />
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="smtpUser">Username</label>
					<p class="field-help">SMTP authentication username.</p>
				</div>
				<input id="smtpUser" name="smtpUser" value={s.smtpUser ?? ''} placeholder="apikey" class="input" />
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="smtpPass">Password</label>
					<p class="field-help">Leave the masked value to keep the stored secret.</p>
				</div>
				<input id="smtpPass" name="smtpPass" type="password" value={s.smtpPass} placeholder="Password" class="input" />
			</div>

			<div class="settings-row">
				<div>
					<label class="label" for="smtpFrom">From address</label>
					<p class="field-help">The sender address used for outgoing email.</p>
				</div>
				<input id="smtpFrom" name="smtpFrom" value={s.smtpFrom ?? ''} placeholder="roamarr@example.com" class="input" />
			</div>
		</div>
	</section>

	<section class="card p-5 sm:p-6">
		<h2 class="section-title">Webhook</h2>
		<div class="settings-rows">
			<div class="settings-row">
				<div>
					<label class="label" for="webhookUrl">Webhook URL</label>
					<p class="field-help">POSTs JSON {`{title, body, link}`} when notifications are sent.</p>
				</div>
				<input
					id="webhookUrl"
					name="webhookUrl"
					type="url"
					value={s.webhookUrl ?? ''}
					placeholder="https://example.com/webhook"
					class="input"
				/>
			</div>
		</div>
	</section>

	<div class="flex justify-end">
		<button class="btn btn-primary">Save settings</button>
	</div>
</form>
