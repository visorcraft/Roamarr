<script lang="ts">
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';

	let { data, form } = $props();
	const s = $derived(data.settings);
	const m = $derived(data.mapSettings);

	const currencyOptions = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'NZD', 'MXN'];

	const tileProviders = [
		{ value: 'openstreetmap', label: 'OpenStreetMap' },
		{ value: 'carto', label: 'CARTO Voyager' },
		{ value: 'maptiler', label: 'MapTiler' },
		{ value: 'stadia', label: 'Stadia Maps' },
		{ value: 'thunderforest', label: 'Thunderforest' },
		{ value: 'jawg', label: 'Jawg Maps' },
		{ value: 'protomaps', label: 'Protomaps' },
		{ value: 'custom', label: 'Custom' }
	];

	function getInitialTiles() {
		const ms = data.mapSettings;
		return {
			provider: ms.mapsTileProvider,
			url: ms.mapsTileUrl ?? '',
			attribution: ms.mapsTileAttribution ?? '',
			apiKey: ms.mapsTileApiKey ?? ''
		};
	}
	const initialTiles = getInitialTiles();
	let selectedProvider = $state(initialTiles.provider);
	let tileUrl = $state(initialTiles.url);
	let tileAttribution = $state(initialTiles.attribution);
	let tileApiKey = $state(initialTiles.apiKey);

	const apiKeyVisible = $derived(
		['maptiler', 'stadia', 'thunderforest', 'jawg', 'protomaps'].includes(selectedProvider)
	);
	const customVisible = $derived(selectedProvider === 'custom');
</script>

<header>
	<h1 class="page-title">General</h1>
	<p class="page-subtitle">Configure your Roamarr instance and outgoing email.</p>
</header>

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

<section class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
	<div class="metric-card">
		<p class="metric-label">Users</p>
		<p class="metric-value">{data.stats.users}</p>
	</div>
	<div class="metric-card">
		<p class="metric-label">Trips</p>
		<p class="metric-value">{data.stats.trips}</p>
	</div>
	<div class="metric-card">
		<p class="metric-label">Segments</p>
		<p class="metric-value">{data.stats.segments}</p>
	</div>
	<div class="metric-card">
		<p class="metric-label">Groups</p>
		<p class="metric-value">{data.stats.groups}</p>
	</div>
	<div class="metric-card">
		<p class="metric-label">Notifications</p>
		<p class="metric-value">{data.stats.notifications}</p>
	</div>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Notification channels</h2>
	<p class="mt-1 text-sm text-slate-400">Send a test notification to yourself to verify SMTP/webhook configuration.</p>
	<form method="POST" action="?/testNotification" class="mt-4">
		<button class="btn btn-primary">Send test notification</button>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Recent activity</h2>
	{#if data.recentLogs.length === 0}
		<p class="empty-text mt-2">No audit log entries yet.</p>
	{:else}
		<ul class="mt-3 list-stack">
			{#each data.recentLogs as log}
				<li class="list-item text-sm">
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span class="font-medium text-white">{log.action}</span>
						<span class="text-slate-400">{log.entityType}:{log.entityId}</span>
						<span class="text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</span>
					</div>
					<p class="mt-1 text-slate-400">{log.user.displayName ?? log.user.email}</p>
				</li>
			{/each}
		</ul>
		<div class="mt-4">
			<a href="/settings/audit-logs" class="btn btn-secondary">View full audit log</a>
		</div>
	{/if}
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Maps</h2>
	<p class="mt-1 text-sm text-slate-400">
		Show a map of the next upcoming city on each trip page. City data comes from GeoNames.
	</p>

	{#if m.mapsEnabled && m.cityCount > 0}
		<p class="notice notice-success mt-4">
			Maps are enabled. City database: {m.cityCount.toLocaleString()} cities imported
			{#if m.mapsGeonamesImportedAt}
				on {new Date(m.mapsGeonamesImportedAt).toLocaleString()}.
			{/if}
		</p>
		<form method="POST" action="?/enableMaps" class="mt-4">
			<button class="btn btn-secondary" type="submit">Re-import city database</button>
		</form>
	{:else}
		<p class="notice mt-4">No city database imported.</p>
		<form method="POST" action="?/enableMaps" class="mt-4">
			<button class="btn btn-primary" type="submit">Enable Maps</button>
		</form>
		<p class="mt-4 text-sm text-slate-400">
			Automatic download not working? Download
			<a
				class="link"
				href="https://download.geonames.org/export/dump/cities1000.zip"
				target="_blank"
				rel="noopener">cities1000.zip</a>
			and upload it below.
		</p>
		<form
			method="POST"
			action="?/importGeonames"
			enctype="multipart/form-data"
			class="mt-3 flex flex-wrap items-end gap-3">
			<div class="field">
				<label class="label" for="cities1000">cities1000.zip</label>
				<input id="cities1000" name="cities1000" type="file" accept=".zip" class="input" required />
			</div>
			<button class="btn btn-secondary" type="submit">Import from file</button>
		</form>
	{/if}
	<p class="mt-4 text-xs text-slate-500">
		Map data © <a class="underline" href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames.org</a>, CC-BY 4.0.
		Tile provider attribution is shown on each map.
	</p>
</section>

<form method="POST" action="?/save" class="mt-6 grid gap-6">
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
					<label class="label" for="defaultCurrency">Default currency</label>
					<p class="field-help">Default currency for expenses and budgets.</p>
				</div>
				<select id="defaultCurrency" name="defaultCurrency" value={s.defaultCurrency} class="input" required>
					{#each currencyOptions as currency}
						<option value={currency}>{currency}</option>
					{/each}
				</select>
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
				<label class="checkbox-label">
					<input
						id="allowRegistration"
						type="checkbox"
						name="allowRegistration"
						checked={s.allowRegistration}
						class="checkbox"
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
					<p class="field-help">POSTs JSON {`{title, body, link}`} with X-Roamarr-Signature (HMAC-SHA256) and X-Roamarr-Timestamp headers.</p>
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

	<section class="card p-5 sm:p-6">
		<h2 class="section-title">Map Tiles</h2>
		<div class="settings-rows">
			<div class="settings-row">
				<div>
					<label class="label" for="mapsTileProvider">Provider</label>
					<p class="field-help">Tile provider used for maps on trip pages.</p>
				</div>
				<select id="mapsTileProvider" name="mapsTileProvider" bind:value={selectedProvider} class="input" required>
					{#each tileProviders as provider}
						<option value={provider.value}>{provider.label}</option>
					{/each}
				</select>
			</div>

			{#if apiKeyVisible}
				<div class="settings-row">
					<div>
						<label class="label" for="mapsTileApiKey">API key</label>
						<p class="field-help">Required by this provider for map tiles.</p>
					</div>
					<input
						id="mapsTileApiKey"
						name="mapsTileApiKey"
						type="password"
						bind:value={tileApiKey}
						placeholder="API key"
						class="input"
					/>
				</div>
			{/if}

			{#if customVisible}
				<div class="settings-row">
					<div>
						<label class="label" for="mapsTileUrl">Tile URL template</label>
						<p class="field-help">Tile URL template with `{'{z}'}`, `{'{x}'}`, and `{'{y}'}` placeholders.</p>
					</div>
					<input
						id="mapsTileUrl"
						name="mapsTileUrl"
						type="url"
						bind:value={tileUrl}
						placeholder={'https://example.com/tiles/{z}/{x}/{y}.png'}
						class="input"
					/>
				</div>

				<div class="settings-row">
					<div>
						<label class="label" for="mapsTileAttribution">Attribution</label>
						<p class="field-help">Attribution HTML shown on the map.</p>
					</div>
					<input
						id="mapsTileAttribution"
						name="mapsTileAttribution"
						bind:value={tileAttribution}
						placeholder="&copy; Map data contributors"
						class="input"
					/>
				</div>
			{/if}
		</div>
	</section>

	<div class="flex justify-end">
		<button class="btn btn-primary">Save settings</button>
	</div>
</form>
