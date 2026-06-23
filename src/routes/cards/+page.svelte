<script lang="ts">
	let { data } = $props();
</script>

<main class="p-4 max-w-2xl">
	<h1 class="text-2xl font-bold mb-4">Cards</h1>
	{#each data.cards as c (c.id)}
		<section class="border-b py-3">
			<div class="flex justify-between">
				<span class="font-semibold">{c.nickname} ({c.network}) {#if c.last4}<span class="text-gray-500 text-sm">…{c.last4}</span>{/if}</span>
				<form method="POST" action="?/deleteCard">
					<input type="hidden" name="id" value={c.id} />
					<button class="text-red-600 text-sm">delete</button>
				</form>
			</div>
			<ul class="text-sm text-gray-600 ml-4">
				{#each c.benefits as b (b.id)}
					<li>{b.benefitType}: {b.coverageAmount ?? '—'} {b.currency}</li>
				{/each}
			</ul>
			<form method="POST" action="?/addBenefit" class="grid grid-cols-2 gap-2 mt-2">
				<input type="hidden" name="cardId" value={c.id} />
				<select name="benefitType" class="border p-1">
					<option value="trip_delay">Trip delay</option>
					<option value="baggage_delay">Baggage delay</option>
					<option value="trip_cancellation">Trip cancellation</option>
					<option value="other">Other</option>
				</select>
				<input name="coverageAmount" type="number" placeholder="Coverage (cents)" class="border p-1" />
				<button class="bg-blue-600 text-white px-2 rounded text-sm col-span-2">Add benefit</button>
			</form>
		</section>
	{/each}
	<form method="POST" action="?/addCard" class="grid gap-2 mt-4 border-t pt-4">
		<input name="nickname" placeholder="Nickname" class="border p-2" required />
		<select name="network" class="border p-2">
			<option value="visa">Visa</option><option value="mc">Mastercard</option>
			<option value="amex">Amex</option><option value="disc">Discover</option>
			<option value="other">Other</option>
		</select>
		<input name="last4" placeholder="Last 4" class="border p-2" />
		<input name="notes" placeholder="Notes" class="border p-2" />
		<button class="bg-blue-600 text-white p-2 rounded">Add card</button>
	</form>
</main>
