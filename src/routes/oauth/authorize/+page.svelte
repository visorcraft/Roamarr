<script lang="ts">
	import { SCOPE_DESCRIPTIONS } from '$lib/oauthScopes';
	let { data } = $props();
</script>

<div class="mx-auto mt-16 max-w-md">
	<div class="card p-7">
		<h1 class="auth-title">Authorize {data.client.clientName}</h1>
		<p class="page-subtitle mt-1">
			<strong>{data.client.clientName}</strong> is requesting access to your Roamarr account
			(<code>{data.userEmail}</code>).
		</p>

		<div class="mt-5 space-y-2">
			<p class="text-sm font-medium text-slate-300">This will allow the application to:</p>
			<ul class="space-y-1.5">
				{#each data.scopes as scope (scope)}
					<li class="flex items-start gap-2 text-sm text-slate-400">
						<span class="mt-0.5 text-indigo-400">›</span>
						<span>{SCOPE_DESCRIPTIONS[scope] ?? scope}</span>
					</li>
				{/each}
			</ul>
		</div>

		{#if data.privateDetailsRequested}
			<label class="checkbox-label mt-5 items-start rounded-lg border p-3" style="border-color: var(--theme-line)">
				<input type="checkbox" name="scopes" value="private-details:read" form="approve-connection" class="checkbox mt-0.5" />
				<span>
					<span class="block font-medium">Share private travel details</span>
					<span class="field-help block">This client can view trip notes, confirmation numbers, and itinerary details. Payment card numbers and travel document numbers stay protected.</span>
				</span>
			</label>
		{/if}

		<div class="mt-6 flex gap-3">
			<form method="POST" action="?/deny" class="flex-1">
				<input type="hidden" name="redirect_uri" value={data.redirectUri} />
				<input type="hidden" name="state" value={data.state ?? ''} />
				<button class="btn btn-ghost w-full">Deny</button>
			</form>
			<form id="approve-connection" method="POST" action="?/approve" class="flex-1">
				<input type="hidden" name="client_id" value={data.client.clientId} />
				<input type="hidden" name="redirect_uri" value={data.redirectUri} />
				<input type="hidden" name="code_challenge" value={data.codeChallenge} />
				<input type="hidden" name="state" value={data.state ?? ''} />
				<input type="hidden" name="scopes" value={data.scopes.join(' ')} />
				<button class="btn btn-primary w-full">Authorize</button>
			</form>
		</div>
	</div>
</div>
