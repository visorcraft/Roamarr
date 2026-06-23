<script lang="ts">
	let { form } = $props();
</script>

<form method="POST" class="grid gap-3 max-w-md p-4">
	<h1 class="text-xl font-bold">New trip</h1>
	<input name="name" placeholder="Trip name" class="border p-2" required />
	<input name="destination" placeholder="Destination" class="border p-2" />
	<input name="startDate" type="date" class="border p-2" />
	<input name="endDate" type="date" class="border p-2" />
	<select name="defaultVisibility" class="border p-2">
		<option value="private">Private</option>
		<option value="groups">Groups</option>
		<option value="public">Public</option>
	</select>
	<textarea name="notes" placeholder="Notes" class="border p-2"></textarea>
	<button class="bg-blue-600 text-white p-2 rounded">Create</button>
</form>
