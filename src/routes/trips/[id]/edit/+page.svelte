<script lang="ts">
	let { data } = $props();
</script>

<form method="POST" class="grid gap-3 max-w-md p-4">
	<h1 class="text-xl font-bold">Edit trip</h1>
	<input name="name" value={data.trip.name} class="border p-2" required />
	<input name="destination" value={data.trip.destination ?? ''} placeholder="Destination" class="border p-2" />
	<input name="startDate" type="date" value={data.trip.startDate ?? ''} class="border p-2" />
	<input name="endDate" type="date" value={data.trip.endDate ?? ''} class="border p-2" />
	<textarea name="notes" placeholder="Notes" class="border p-2">{data.trip.notes ?? ''}</textarea>
	<button class="bg-blue-600 text-white p-2 rounded">Save</button>
</form>
