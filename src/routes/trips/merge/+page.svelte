<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	let { data, form } = $props();
</script>

<header class="page-header"><div><h1 class="page-title">Merge trips</h1><p class="page-subtitle">Move everything from one trip into another, then delete the donor.</p></div></header>
{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

<form method="POST" class="card mt-6 space-y-5 p-5 sm:p-6">
	<div class="field"><label class="label" for="donorId">Donor trip</label><p class="field-help">This trip is deleted after its contents move.</p><select id="donorId" name="donorId" class="input" required><option value="">Choose donor</option>{#each data.trips as trip}<option value={trip.id}>{trip.name}</option>{/each}</select></div>
	<div class="field"><label class="label" for="recipientId">Recipient trip</label><p class="field-help">This trip remains.</p><select id="recipientId" name="recipientId" class="input" required><option value="">Choose recipient</option>{#each data.trips as trip}<option value={trip.id}>{trip.name}</option>{/each}</select></div>
	<div class="flex justify-end"><ConfirmButton class="btn btn-danger" message="Merge these trips? The donor trip will be deleted.">Merge trips</ConfirmButton></div>
</form>
