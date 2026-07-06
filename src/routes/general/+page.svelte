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

<form
	method="POST"
	action="?/save"
	enctype="multipart/form-data"
	class="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_17.5rem] xl:grid-cols-[minmax(0,1fr)_20rem]"
>
	<button type="submit" class="sr-only" tabindex="-1" aria-hidden="true">Save settings</button>

	<div class="space-y-6">
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
			<h2 class="section-title">Maps</h2>
			<p class="mt-1 text-sm muted">
				Show a 2D map of the next upcoming city on each trip page, plus a 3D globe you can open
				from it. City data comes from GeoNames; the Earth texture from NASA; borders from Natural Earth.
			</p>

			{#if m.mapsEnabled}
				<p class="notice notice-success mt-4">Maps are enabled.</p>
				<ul class="mt-3 space-y-1 text-sm muted">
					<li>
						City database: {m.cityCount.toLocaleString()} cities
						{#if m.mapsGeonamesImportedAt}(imported {new Date(m.mapsGeonamesImportedAt).toLocaleString()}){/if}
					</li>
					<li>
						Earth texture:
						{#if m.textureReady}
							ready{#if m.textureImportedAt} (downloaded {new Date(m.textureImportedAt).toLocaleString()}){/if}
						{:else}
							<span class="text-amber-400">not downloaded — use “Re-import textures”</span>
						{/if}
					</li>
					<li>Country borders: bundled (Natural Earth, public domain)</li>
				</ul>
				<div class="mt-4 flex flex-wrap gap-3">
					<button class="btn btn-primary" type="submit" formaction="?/reimportCities">Re-import city database</button>
					<button class="btn btn-primary" type="submit" formaction="?/reimportTexture">Re-import textures</button>
					<button class="btn btn-secondary" type="submit" formaction="?/disableMaps">Disable Maps</button>
				</div>
			{:else}
				<p class="notice mt-4">
					{#if m.cityCount > 0 || m.textureReady}
						Maps are disabled. Some data is already downloaded ({m.cityCount.toLocaleString()} cities{#if m.textureReady}, texture ready{/if}).
						Re-enabling re-checks and fetches anything missing.
					{:else}
						Maps are not set up yet. Enabling downloads the city database and Earth texture.
					{/if}
				</p>
				<button class="btn btn-primary mt-4" type="submit" formaction="?/enableMaps">Enable Maps</button>
				<p class="mt-4 text-sm muted">
					Automatic download not working? Download
					<a
						class="link"
						href="https://download.geonames.org/export/dump/cities1000.zip"
						target="_blank"
						rel="noopener">cities1000.zip</a>
					and upload it below.
				</p>
				<div class="mt-3 flex flex-wrap items-end gap-3">
					<div class="field">
						<label class="label" for="cities1000">cities1000.zip</label>
						<input id="cities1000" name="cities1000" type="file" accept=".zip" class="input" />
					</div>
					<button class="btn btn-primary" type="submit" formaction="?/importGeonames">Import from file</button>
				</div>
			{/if}
			<p class="mt-4 text-xs text-readable-faint">
				Map data © <a class="underline" href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames.org</a>, CC-BY 4.0.
				Tile provider attribution is shown on each map.
			</p>

			<div class="mt-6 border-t border-white/10 pt-6" style="border-color: var(--theme-line)">
				<h3 class="subsection-title mb-4">Map tiles</h3>
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
								<p class="field-help">Tile URL template with {'{z}'}, {'{x}'}, and {'{y}'} placeholders.</p>
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
					<label class="label" for="smtpSecurity">Transport security</label>
					<p class="field-help">Explicitly select STARTTLS (587) or implicit TLS (465) to match your server.</p>
				</div>
				<select id="smtpSecurity" name="smtpSecurity" class="input">
					<option value="starttls" selected={s.smtpSecurity === 'starttls' || !s.smtpSecurity}>STARTTLS (recommended)</option>
					<option value="ssl/tls" selected={s.smtpSecurity === 'ssl/tls'}>SSL/TLS (implicit, port 465)</option>
					<option value="none" selected={s.smtpSecurity === 'none'}>None (plaintext)</option>
				</select>
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
					<div>
						<input id="smtpPass" name="smtpPass" type="password" value={s.smtpPass} placeholder="Password" class="input" />
						{#if s.smtpPass}
							<label class="checkbox-label mt-2 text-xs">
								<input type="checkbox" name="clearSmtpPass" class="checkbox" />
								Clear the stored password
							</label>
						{/if}
					</div>
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
			<h2 class="section-title">OAuth clients</h2>
			<p class="mt-1 text-sm muted">
				When the allow-list is empty, users can register and authorize any OAuth client. When it
				contains one or more client IDs, only those clients may be authorized.
			</p>
			<div class="settings-rows mt-4">
				<div class="settings-row">
					<div>
						<label class="label" for="oauthClientAllowList">Allowed client IDs</label>
						<p class="field-help">One client ID per line. Leave empty to allow all clients.</p>
					</div>
					<textarea
						id="oauthClientAllowList"
						name="oauthClientAllowList"
						rows="4"
						class="input font-mono"
						value={(s.oauthClientAllowList ?? []).join('\n')}
					></textarea>
				</div>
			</div>
		</section>

		<div class="flex justify-end">
			<button class="btn btn-primary">Save settings</button>
		</div>
	</div>

	<aside class="space-y-8">
		<div class="trip-sidebar-card">
			<h2 class="subsection-title mb-3">Notification channels</h2>
			<p class="text-sm muted">Send a test notification to yourself to verify SMTP/webhook configuration.</p>
			<button class="btn btn-primary mt-4" type="submit" formaction="?/testNotification">Send test notification</button>
			<p class="text-sm muted mt-4">Send only a test email to verify SMTP delivery (bypasses webhooks and in-app).</p>
			<button class="btn btn-ghost mt-2" type="submit" formaction="?/testEmail">Send test email</button>
		</div>

		<div class="trip-sidebar-card">
			<h2 class="subsection-title mb-3">Recent activity</h2>
			{#if data.recentLogs.length === 0}
				<p class="empty-text mt-2">No audit log entries yet.</p>
			{:else}
				<ul class="mt-3 list-stack">
					{#each data.recentLogs as log}
						<li class="list-item text-sm">
							<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
								<span class="font-medium text-white">{log.action}</span>
								<span class="muted">{log.entityType}:{log.entityId}</span>
								<span class="text-xs text-readable-faint">{new Date(log.createdAt).toLocaleString()}</span>
							</div>
							<p class="mt-1 muted">{log.user.displayName ?? log.user.email}</p>
						</li>
					{/each}
				</ul>
				<div class="mt-4">
					<a href="/audit-logs" class="btn btn-primary">View full audit log</a>
				</div>
			{/if}
		</div>
	</aside>
</form>
