<script lang="ts">
	let { data } = $props();
</script>

{#if data.owner === true}
	<h1 class="text-2xl font-bold p-4">{data.trip.name}</h1>
	<div class="px-4 flex gap-3">
		<a href={`/trips/${data.trip.id}/edit`} class="text-blue-600">Edit</a>
		<a href={`/trips/${data.trip.id}/share`} class="text-blue-600">Share</a>
	</div>
	<ul class="p-4">
		{#each data.segments as s (s.id)}
			<li>
				{s.type}: {s.title} — {s.startAt} @ {s.location}
				<form method="POST" action={`/trips/${data.trip.id}/segments?/delete`} class="inline">
					<input type="hidden" name="segmentId" value={s.id} />
					<button class="text-red-600 text-sm ml-2">delete</button>
				</form>
			</li>
		{/each}
	</ul>
	<form method="POST" action={`/trips/${data.trip.id}/segments?/add`} class="grid gap-2 max-w-md p-4 border-t">
		<select name="type" class="border p-2">
			<option value="flight">Flight</option>
			<option value="lodging">Lodging</option>
		</select>
		<input name="title" placeholder="Title (e.g. UA123 / Hotel)" class="border p-2" required />
		<input name="localStart" type="datetime-local" class="border p-2" required />
		<input name="startTz" placeholder="Timezone" value="UTC" class="border p-2" />
		<input name="location" placeholder="Location" class="border p-2" />
		<input name="confirmationNumber" placeholder="Confirmation #" class="border p-2" />
		<button class="bg-blue-600 text-white p-2 rounded">Add segment</button>
	</form>
	{#if data.providers?.length}
		<form method="POST" action={`/trips/${data.trip.id}/fare-watch?/enable`} class="flex items-center gap-2 p-4 border-t">
			<span class="text-sm text-gray-600">Enable fare watch via</span>
			<select name="providerId" class="border p-1">
				{#each data.providers as p (p.id)}
					<option value={p.id}>{p.providerKey}</option>
				{/each}
			</select>
			<button class="bg-blue-600 text-white px-2 py-1 rounded text-sm">Enable</button>
		</form>
	{/if}
{:else}
	<h1 class="text-2xl font-bold p-4">{data.trip.name}</h1>
	<ul class="p-4">
		{#each data.trip.segments as s}
			<li>{s.type}: {s.title} — {s.startAt} @ {s.location}</li>
		{/each}
	</ul>
{/if}
