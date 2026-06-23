<script lang="ts">
	let { data } = $props();
</script>

<main class="p-4 max-w-2xl">
	<h1 class="text-2xl font-bold mb-4">Insurance policies</h1>
	<ul>
		{#each data.policies as p (p.id)}
			<li class="border-b py-2 flex justify-between">
				<span>{p.provider}: {#if p.coverageAmount}{p.coverageAmount} {p.currency}{/if} {#if p.tripId}<span class="text-gray-500 text-sm">(trip {p.tripId})</span>{/if}</span>
				<form method="POST" action="?/delete">
					<input type="hidden" name="id" value={p.id} />
					<button class="text-red-600 text-sm">delete</button>
				</form>
			</li>
		{/each}
	</ul>
	<form method="POST" action="?/add" class="grid gap-2 mt-4 border-t pt-4">
		<input name="provider" placeholder="Provider" class="border p-2" required />
		<input name="policyNumber" placeholder="Policy #" class="border p-2" />
		<textarea name="coverageSummary" placeholder="Coverage summary" class="border p-2"></textarea>
		<input name="coverageAmount" type="number" placeholder="Coverage (cents)" class="border p-2" />
		<input name="startDate" type="date" class="border p-2" />
		<input name="endDate" type="date" class="border p-2" />
		<select name="tripId" class="border p-2">
			<option value="">No trip</option>
			{#each data.trips as t (t.id)}
				<option value={t.id}>{t.name}</option>
			{/each}
		</select>
		<button class="bg-blue-600 text-white p-2 rounded">Add policy</button>
	</form>
</main>
