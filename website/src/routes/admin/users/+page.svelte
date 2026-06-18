<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		LegalHammerIcon,
		UserCheck01Icon,
		Cancel01Icon,
		Dollar02Icon,
		GemIcon,
		Loading03Icon
	} from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';
	import { formatValue } from '$lib/utils';

	interface BannedUser {
		id: number;
		name: string;
		username: string;
		banReason: string;
	}

	interface AdminUser {
		id: number;
		name: string;
		username: string;
		email: string;
		isAdmin: boolean;
		isBanned: boolean;
		baseCurrencyBalance: string;
		gems: string;
		createdAt: string;
	}

	let bannedUsers = $state<BannedUser[]>([]);
	let loading = $state(true);
	let actionLoading = $state(false);
	let banDialogOpen = $state(false);
	let usernameToAction = $state('');
	let banReason = $state('');

	// Economy controls state
	let allUsers = $state<AdminUser[]>([]);
	let usersLoading = $state(true);
	let searchQuery = $state('');

	let economyDialogOpen = $state(false);
	let economyUser = $state<AdminUser | null>(null);
	let ecoField = $state<'cash' | 'gems'>('cash');
	let ecoAction = $state<'set' | 'add' | 'remove'>('set');
	let ecoAmount = $state('');
	let ecoLoading = $state(false);

	async function loadBannedUsers() {
		loading = true;
		try {
			const response = await fetch('/api/admin/users/banned-list');
			if (response.ok) {
				bannedUsers = await response.json();
			}
		} catch (e) {
			toast.error('Failed to load banned users');
		} finally {
			loading = false;
		}
	}

	async function loadUsers() {
		usersLoading = true;
		try {
			const response = await fetch('/api/admin/users');
			if (response.ok) {
				allUsers = await response.json();
			}
		} catch (e) {
			toast.error('Failed to load users');
		} finally {
			usersLoading = false;
		}
	}

	async function banUser() {
		if (!usernameToAction.trim() || !banReason.trim()) return;

		actionLoading = true;
		try {
			const response = await fetch('/api/admin/users/ban', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: usernameToAction.trim(), reason: banReason.trim() })
			});

			if (response.ok) {
				toast.success('User banned successfully');
				await loadBannedUsers();
				await loadUsers();
				banDialogOpen = false;
				usernameToAction = '';
				banReason = '';
			} else {
				const error = await response.json();
				toast.error(error.message || 'Failed to ban user');
			}
		} catch (e) {
			toast.error('Failed to ban user');
		} finally {
			actionLoading = false;
		}
	}

	async function unbanUser(userId: number) {
		actionLoading = true;
		try {
			const response = await fetch('/api/admin/users/unban', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});

			if (response.ok) {
				toast.success('User unbanned successfully');
				await loadBannedUsers();
				await loadUsers();
			} else {
				const error = await response.json();
				toast.error(error.message || 'Failed to unban user');
			}
		} catch (e) {
			toast.error('Failed to unban user');
		} finally {
			actionLoading = false;
		}
	}

	function openBanDialog() {
		usernameToAction = '';
		banReason = '';
		banDialogOpen = true;
	}

	function openEconomyDialog(u: AdminUser) {
		economyUser = u;
		ecoField = 'cash';
		ecoAction = 'set';
		ecoAmount = '';
		economyDialogOpen = true;
	}

	// Live preview of the resulting value for the current selection.
	let ecoPreview = $derived.by(() => {
		if (!economyUser) return null;
		const amt = parseFloat(ecoAmount);
		if (!Number.isFinite(amt) || amt < 0) return null;
		const current = ecoField === 'cash'
			? Number(economyUser.baseCurrencyBalance)
			: Number(economyUser.gems);
		let next: number;
		if (ecoAction === 'set') next = amt;
		else if (ecoAction === 'add') next = current + amt;
		else next = current - amt;
		return Math.max(0, ecoField === 'gems' ? Math.floor(next) : next);
	});

	let ecoCurrent = $derived(
		economyUser
			? ecoField === 'cash'
				? Number(economyUser.baseCurrencyBalance)
				: Number(economyUser.gems)
			: 0
	);

	let filteredUsers = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return allUsers;
		return allUsers.filter(
			(u) =>
				u.username.toLowerCase().includes(q) ||
				u.name.toLowerCase().includes(q) ||
				u.email.toLowerCase().includes(q)
		);
	});

	async function submitEconomy() {
		if (!economyUser || ecoPreview === null) return;

		ecoLoading = true;
		try {
			const response = await fetch(`/api/admin/users/${economyUser.id}/economy`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					field: ecoField,
					action: ecoAction,
					amount: parseFloat(ecoAmount)
				})
			});

			if (response.ok) {
				const updated = await response.json();
				toast.success(`Updated @${updated.username}'s ${ecoField}`);
				// Update the local list without a full refetch.
				allUsers = allUsers.map((u) =>
					u.id === updated.id
						? {
								...u,
								baseCurrencyBalance: String(updated.baseCurrencyBalance),
								gems: String(updated.gems)
							}
						: u
				);
				economyUser = {
					...economyUser,
					baseCurrencyBalance: String(updated.baseCurrencyBalance),
					gems: String(updated.gems)
				};
				economyDialogOpen = false;
			} else {
				const err = await response.json();
				toast.error(err.error || 'Failed to update economy');
			}
		} catch (e) {
			toast.error('Failed to update economy');
		} finally {
			ecoLoading = false;
		}
	}

	onMount(() => {
		loadBannedUsers();
		loadUsers();
	});
</script>

<div class="container mx-auto max-w-4xl space-y-6 py-6">
	<!-- Economy Controls -->
	<Card.Root>
		<Card.Header class="flex flex-row items-center justify-between">
			<Card.Title class="flex items-center gap-2">
				<HugeiconsIcon icon={Dollar02Icon} class="h-5 w-5" />
				Economy Controls
			</Card.Title>
		</Card.Header>
		<Card.Content>
			<Input
				type="text"
				placeholder="Search by username, name, or email…"
				bind:value={searchQuery}
				class="mb-4"
			/>

			{#if usersLoading}
				<div class="space-y-3">
					{#each Array(5) as _}
						<div class="flex items-center justify-between p-3 border rounded">
							<div class="space-y-2 flex-1">
								<Skeleton class="h-4 w-40" />
								<Skeleton class="h-3 w-24" />
							</div>
							<Skeleton class="h-8 w-20" />
						</div>
					{/each}
				</div>
			{:else if filteredUsers.length === 0}
				<div class="text-center py-8">
					<p class="text-muted-foreground">No users found.</p>
				</div>
			{:else}
				<div class="max-h-[28rem] space-y-2 overflow-y-auto">
					{#each filteredUsers as u (u.id)}
						<div class="flex items-center justify-between gap-3 p-3 border rounded">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="truncate font-medium">{u.name}</span>
									<span class="text-muted-foreground text-sm truncate">@{u.username}</span>
									{#if u.isAdmin}
										<span class="text-primary text-[10px] font-semibold uppercase">Admin</span>
									{/if}
									{#if u.isBanned}
										<span class="text-destructive text-[10px] font-semibold uppercase">Banned</span>
									{/if}
								</div>
								<div class="text-muted-foreground mt-1 flex items-center gap-3 text-xs font-mono">
									<span class="text-green-500">${formatValue(Number(u.baseCurrencyBalance))}</span>
									<span class="flex items-center gap-0.5" style="color: #ca00ff">
										<HugeiconsIcon icon={GemIcon} size={12} />
										{Number(u.gems).toLocaleString()}
									</span>
								</div>
							</div>
							<Button size="sm" variant="outline" onclick={() => openEconomyDialog(u)}>
								Adjust
							</Button>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Banned Users -->
	<Card.Root>
		<Card.Header class="flex flex-row items-center justify-between">
			<Card.Title class="flex items-center gap-2">
				<HugeiconsIcon icon={LegalHammerIcon} class="h-5 w-5" />
				Banned Users ({bannedUsers.length})
			</Card.Title>
			<Button onclick={openBanDialog}>
				<HugeiconsIcon icon={Cancel01Icon} class="h-4 w-4" />
				Ban User
			</Button>
		</Card.Header>
		<Card.Content>
			{#if loading}
				<div class="space-y-4">
					{#each Array(5) as _}
						<div class="flex items-center justify-between p-4 border rounded">
							<div class="space-y-2 flex-1">
								<Skeleton class="h-4 w-48" />
								<Skeleton class="h-3 w-32" />
								<Skeleton class="h-3 w-64" />
							</div>
							<Skeleton class="h-8 w-16" />
						</div>
					{/each}
				</div>
			{:else if bannedUsers.length === 0}
				<div class="text-center py-8">
					<p class="text-muted-foreground">No banned users found.</p>
				</div>
			{:else}
				<div class="space-y-4">
					{#each bannedUsers as user}
						<div class="flex items-center justify-between p-4 border rounded">
							<div class="space-y-1 flex-1">
								<div class="font-medium">{user.name}</div>
								<div class="text-sm text-muted-foreground">@{user.username}</div>
								<div class="text-sm">
									<span class="font-medium">Reason:</span> {user.banReason}
								</div>
							</div>
							<Button
								size="sm"
								variant="outline"
								onclick={() => unbanUser(user.id)}
								disabled={actionLoading}
							>
								<HugeiconsIcon icon={UserCheck01Icon} class="h-4 w-4" />
								Unban
							</Button>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<!-- Ban Dialog -->
<Dialog.Root bind:open={banDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Ban User</Dialog.Title>
			<Dialog.Description>
				Enter the username and reason to ban a user.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4">
			<div>
				<label for="username" class="block text-sm font-medium mb-2">Username</label>
				<Input
					id="username"
					bind:value={usernameToAction}
					placeholder="Enter username (without @)"
					required
				/>
			</div>
			<div>
				<label for="reason" class="block text-sm font-medium mb-2">Reason for ban</label>
				<Textarea
					id="reason"
					bind:value={banReason}
					placeholder="Enter the reason for banning this user..."
					required
				/>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (banDialogOpen = false)}>Cancel</Button>
			<Button
				variant="destructive"
				onclick={banUser}
				disabled={!usernameToAction.trim() || !banReason.trim() || actionLoading}
			>
				Ban User
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Economy Adjust Dialog -->
<Dialog.Root bind:open={economyDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>
				Adjust economy{#if economyUser}
					<span class="text-muted-foreground font-normal"> — @{economyUser.username}</span>{/if}
			</Dialog.Title>
			<Dialog.Description>Set, add, or remove cash or gems. Results clamp at 0.</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<div>
				<div class="mb-2 text-sm font-medium">Field</div>
				<div class="grid grid-cols-2 gap-2">
					<Button
						variant={ecoField === 'cash' ? 'default' : 'outline'}
						onclick={() => (ecoField = 'cash')}
						class="h-10"
					>
						<HugeiconsIcon icon={Dollar02Icon} class="h-4 w-4" />
						Cash
					</Button>
					<Button
						variant={ecoField === 'gems' ? 'default' : 'outline'}
						onclick={() => (ecoField = 'gems')}
						class="h-10"
					>
						<HugeiconsIcon icon={GemIcon} class="h-4 w-4" />
						Gems
					</Button>
				</div>
			</div>

			<div>
				<div class="mb-2 text-sm font-medium">Action</div>
				<div class="grid grid-cols-3 gap-2">
					<Button
						size="sm"
						variant={ecoAction === 'set' ? 'default' : 'outline'}
						onclick={() => (ecoAction = 'set')}>Set</Button
					>
					<Button
						size="sm"
						variant={ecoAction === 'add' ? 'default' : 'outline'}
						onclick={() => (ecoAction = 'add')}
						class="text-green-500">Add</Button
					>
					<Button
						size="sm"
						variant={ecoAction === 'remove' ? 'default' : 'outline'}
						onclick={() => (ecoAction = 'remove')}
						class="text-red-500">Remove</Button
					>
				</div>
			</div>

			<div>
				<label for="eco-amount" class="mb-2 block text-sm font-medium">Amount</label>
				<Input
					id="eco-amount"
					type="number"
					min="0"
					step={ecoField === 'cash' ? '0.01' : '1'}
					bind:value={ecoAmount}
					placeholder="0"
				/>
			</div>

			<div class="bg-muted/50 rounded-lg p-3 text-sm">
				<div class="flex items-center justify-between">
					<span class="text-muted-foreground">Current {ecoField}</span>
					<span class="font-mono font-medium">
						{ecoField === 'cash'
							? `$${formatValue(ecoCurrent)}`
							: ecoCurrent.toLocaleString()}
					</span>
				</div>
				{#if ecoPreview !== null}
					<div class="mt-1 flex items-center justify-between">
						<span class="text-muted-foreground">After</span>
						<span class="font-mono font-bold {ecoField === 'cash' ? '' : ''}" style={ecoField === 'cash' ? '' : 'color: #ca00ff'}>
							{ecoField === 'cash'
								? `$${formatValue(ecoPreview)}`
								: ecoPreview.toLocaleString()}
						</span>
					</div>
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (economyDialogOpen = false)}>Cancel</Button>
			<Button onclick={submitEconomy} disabled={ecoPreview === null || ecoLoading}>
				{#if ecoLoading}
					<HugeiconsIcon icon={Loading03Icon} class="h-4 w-4 animate-spin" />
					Applying…
				{:else}
					Apply
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
