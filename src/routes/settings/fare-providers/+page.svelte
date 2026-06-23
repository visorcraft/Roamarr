<script lang="ts">
	let { data } = $props();
	const enabledKeys = $derived(new Set(data.saved.map((s) => s.providerKey)));
</script>

<main class="p-4 max-w-xl">
	<h1 class="text-2xl font-bold mb-4">Fare-watch providers</h1>
	{#each data.providers as p (p.key)}
		<form method="POST" action="?/save" class="border-b py-3 grid gap-2">
			<input type="hidden" name="providerKey" value={p.key} />
			<div class="flex items-center justify-between">
				<span class="font-semibold">{p.label}</span>
				<label class="text-sm">
					<input type="checkbox" name="enabled" checked={enabledKeys.has(p.key)} /> enabled
				</label>
			</div>
			<input name="apiKey" placeholder="API key" class="border p-2" />
			<button class="bg-blue-600 text-white p-2 rounded text-sm">Save</button>
		</form>
	{/each}
</main>
