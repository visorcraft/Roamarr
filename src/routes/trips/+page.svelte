<script lang="ts">
	let { data } = $props();
</script>

<main class="p-4">
	<div class="flex items-center justify-between max-w-2xl">
		<h1 class="text-2xl font-bold">Trips</h1>
		<a href="/trips/new" class="bg-blue-600 text-white px-3 py-2 rounded">New trip</a>
	</div>
	<ul class="mt-4 max-w-2xl">
		{#each data.trips as t (t.id)}
			<li class="border-b py-2">
				<a href={`/trips/${t.id}`} class="text-blue-600">{t.name}</a>
				{#if t.startDate}<span class="text-gray-500 text-sm ml-2">from {t.startDate}</span>{/if}
			</li>
		{/each}
	</ul>
</main>
