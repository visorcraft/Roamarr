<script lang="ts">
	let { data } = $props();
</script>

{#if data.owner === true}
	<h1 class="text-2xl font-bold p-4">{data.trip.name}</h1>
	<a href={`/trips/${data.trip.id}/edit`} class="text-blue-600 px-4">Edit</a>
	<ul class="p-4">
		{#each data.segments as s (s.id)}
			<li>{s.type}: {s.title} — {s.startAt} @ {s.location}</li>
		{/each}
	</ul>
{:else}
	<h1 class="text-2xl font-bold p-4">{data.trip.name}</h1>
	<ul class="p-4">
		{#each data.trip.segments as s}
			<li>{s.type}: {s.title} — {s.startAt} @ {s.location}</li>
		{/each}
	</ul>
{/if}
