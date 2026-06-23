<script lang="ts">
	let { data } = $props();
</script>

<header class="p-4 text-sm text-gray-500">{data.instanceName}</header>
<h1 class="text-2xl font-bold px-4">{data.trip.name}</h1>
<p class="px-4 text-gray-600">
	{data.trip.destination} · {data.trip.startDate} – {data.trip.endDate}
</p>
<ul class="p-4">
	{#each data.trip.segments as s}
		<li>{s.type}: {s.title} — {s.startAt} @ {s.location}</li>
	{/each}
</ul>
