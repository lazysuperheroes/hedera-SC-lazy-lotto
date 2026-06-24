/**
 * LazyLotto Admin Grant Entry Script
 *
 * Grant free entries to users (as in-memory entries, not NFTs).
 * Useful for promotions, airdrops, or compensation.
 * Requires ADMIN role.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/grantEntry.js
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/grantEntry.js --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/grantEntry.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 */

require('dotenv').config();
const { default: axios } = require('axios');
const { AccountId } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const { getBaseURL } = require('../../../../utils/hederaMirrorHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

// Long-zero EVM address for a plain (non-aliased) Hedera account.
function longZeroAddress(accountId) {
	return '0x' + AccountId.fromString(accountId).toSolidityAddress();
}

/**
 * Validate that a recipient input resolves to a real, plain USER account on the
 * mirror node before we hand it a free entry.
 *
 * Why this exists: adminGrantEntry stores the entry under whatever address it is
 * given. If that address belongs to no one (a mistyped ID, a wrong-network
 * address, or — the classic foot-gun — a shard/realm typo like `0.9.136327`
 * instead of `0.0.136327`, which encodes the `9` into the realm byte and yields
 * a phantom EVM address), the free entry is stranded forever with no way to roll
 * or redeem it. Granting to a contract is equally useless.
 *
 * Returns { ok, input, accountId, address, reason }. On success `address` is the
 * mirror-confirmed canonical EVM address (matches the account's msg.sender when
 * it later rolls/redeems) — we grant to THAT, so a manual 0x→entry conversion can
 * never re-introduce a typo.
 *
 * @param {string} network network name (mainnet/testnet/...)
 * @param {string} input   recipient as typed — `0.0.xxxxx` or `0x...`
 */
async function validateRecipient(network, input) {
	const baseUrl = getBaseURL(network);

	// 1. Pre-flight: for a Hedera ID, reject non-zero shard/realm BEFORE we build
	//    any address from it. This is exactly the 0.9.x / 9.0.x typo class.
	let lookupKey = input;
	if (!input.startsWith('0x')) {
		let accountId;
		try {
			accountId = AccountId.fromString(input);
		}
		catch {
			return { ok: false, input, reason: 'not a valid account ID or 0x address' };
		}
		if (accountId.shard.toString() !== '0' || accountId.realm.toString() !== '0') {
			return {
				ok: false,
				input,
				reason: `shard/realm must be 0 — got shard=${accountId.shard}, realm=${accountId.realm} (typo? did you mean 0.0.${accountId.num}?)`,
			};
		}
		lookupKey = accountId.toString();
	}

	// 2. Must exist as an ACCOUNT on the mirror node.
	let acct;
	try {
		const { data } = await axios.get(`${baseUrl}/api/v1/accounts/${lookupKey}`);
		acct = data;
	}
	catch (err) {
		const status = err.response && err.response.status;
		// 404 = not found; 400 = malformed / out-of-range id — both mean "not a real account".
		if (status === 404 || status === 400) {
			return { ok: false, input, reason: `no such account on the ${network} mirror node (${status}) — wrong ID, wrong network, or never created` };
		}
		return { ok: false, input, reason: `mirror lookup failed: ${err.message}` };
	}

	const accountId = acct.account;
	if (!accountId) {
		return { ok: false, input, reason: 'mirror returned no account id for this address' };
	}
	if (acct.deleted) {
		return { ok: false, input, reason: `account ${accountId} is deleted` };
	}

	// 3. Must NOT be a contract — /accounts/ returns 200 for contracts too, so the
	//    /contracts/ probe is the reliable discriminator (404 => plain account).
	try {
		await axios.get(`${baseUrl}/api/v1/contracts/${accountId}`);
		return { ok: false, input, reason: `${accountId} is a CONTRACT, not a user account` };
	}
	catch (err) {
		if (!(err.response && err.response.status === 404)) {
			return { ok: false, input, reason: `could not confirm ${accountId} is not a contract: ${err.message}` };
		}
		// 404 => not a contract => good
	}

	// Canonical EVM address straight from mirror (the account's real msg.sender).
	// Fall back to long-zero if mirror omits it.
	let address = acct.evm_address;
	if (!address || address === '0x') {
		address = longZeroAddress(accountId);
	}

	return { ok: true, input, accountId, address };
}

async function grantEntry() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║          LazyLotto Admin Grant Entry (Admin)              ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Get total pools
		const decoded = await queryContract(env, contractId, lazyLottoIface, 'totalPools', [], operatorId);
		const totalPools = Number(decoded[0]);

		if (totalPools === 0) {
			console.error('❌ No pools exist in the contract');
			process.exit(1);
		}

		console.log(`📊 Total pools: ${totalPools}\n`);

		// Get pool ID
		const poolIdStr = await prompt(`Enter pool ID (0-${totalPools - 1}): `);

		let poolId;
		try {
			poolId = parseInt(poolIdStr);
			if (isNaN(poolId) || poolId < 0 || poolId >= totalPools) {
				console.error(`❌ Pool ID must be between 0 and ${totalPools - 1}`);
				process.exit(1);
			}
		}
		catch {
			console.error('❌ Invalid pool ID format');
			process.exit(1);
		}

		// Get recipient addresses (comma-separated)
		const recipientInput = await prompt('Enter recipient(s) (comma-separated, 0.0.xxxxx or 0x...): ');
		const recipientInputs = recipientInput.split(',').map(r => r.trim()).filter(r => r.length > 0);

		if (recipientInputs.length === 0) {
			console.error('❌ No recipients provided');
			process.exit(1);
		}

		// Validate every recipient against the mirror node BEFORE granting. This
		// catches mistyped IDs, wrong-network addresses, contract addresses, and the
		// shard/realm foot-gun (e.g. 0.9.136327 → a phantom address nobody controls)
		// that would otherwise silently strand a free entry forever.
		console.log(`\n🔎 Validating ${recipientInputs.length} recipient(s) against the ${env} mirror node...`);
		const recipients = [];
		const invalid = [];
		for (const input of recipientInputs) {
			const v = await validateRecipient(env, input);
			if (v.ok) {
				const aliasNote = v.address.toLowerCase() !== longZeroAddress(v.accountId).toLowerCase()
					? ' (ECDSA alias)' : '';
				console.log(`   ✅ ${input} → ${v.accountId}${aliasNote}`);
				recipients.push({ input, accountId: v.accountId, address: v.address });
			}
			else {
				console.log(`   ❌ ${input} → ${v.reason}`);
				invalid.push(v);
			}
		}

		if (invalid.length) {
			console.log(`\n⚠️  ${invalid.length} recipient(s) failed validation and will NOT receive entries:`);
			for (const v of invalid) console.log(`      • ${v.input} — ${v.reason}`);
			if (recipients.length === 0) {
				console.error('\n❌ No valid recipients remain. Aborting.');
				process.exit(1);
			}
			const cont = await prompt(`\nProceed with only the ${recipients.length} valid recipient(s) and skip the invalid one(s)? (yes/no): `);
			if (cont.toLowerCase() !== 'yes' && cont.toLowerCase() !== 'y') {
				console.log('\n❌ Operation cancelled — fix the invalid recipient(s) and re-run.');
				process.exit(0);
			}
		}

		console.log(`\n✅ ${recipients.length} recipient(s) validated`);

		// Get ticket counts
		const ticketCountStr = await prompt(`Enter ticket count(s):\n  - Single number for all users\n  - Comma-separated list (must match ${recipients.length} recipients)\n  Count(s): `);
		const ticketCountInputs = ticketCountStr.split(',').map(t => t.trim()).filter(t => t.length > 0);

		let ticketCounts = [];
		if (ticketCountInputs.length === 1) {
			// Single count - apply to all
			const count = parseInt(ticketCountInputs[0]);
			if (isNaN(count) || count <= 0) {
				console.error('❌ Ticket count must be positive');
				process.exit(1);
			}
			ticketCounts = new Array(recipients.length).fill(count);
			console.log(`\n✅ Applying ${count} entries to all ${recipients.length} recipient(s)`);
		}
		else if (ticketCountInputs.length === recipients.length) {
			// Individual counts
			for (const countStr of ticketCountInputs) {
				const count = parseInt(countStr);
				if (isNaN(count) || count <= 0) {
					console.error(`❌ Invalid ticket count: ${countStr}`);
					process.exit(1);
				}
				ticketCounts.push(count);
			}
			console.log('\n✅ Using individual entry counts for each recipient');
		}
		else {
			console.error(`❌ Ticket count mismatch: provided ${ticketCountInputs.length} counts for ${recipients.length} recipients`);
			console.error('   Provide either 1 count (for all) or exactly matching counts');
			process.exit(1);
		}

		// Calculate total
		const totalTickets = ticketCounts.reduce((sum, count) => sum + count, 0);

		// Display summary
		console.log('\n═══════════════════════════════════════════════════════════');
		console.log('  GRANT ENTRIES SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool: #${poolId}`);
		console.log(`  Recipients: ${recipients.length}`);
		console.log(`  Total Entries: ${totalTickets}`);
		console.log('');
		for (let i = 0; i < recipients.length; i++) {
			const r = recipients[i];
			// Show the mirror-resolved account so the admin confirms the real target,
			// not just what they typed.
			const resolved = r.accountId && r.accountId !== r.input ? ` (${r.accountId})` : '';
			console.log(`  ${i + 1}. ${r.input}${resolved} → ${ticketCounts[i]} entries`);
		}
		console.log('═══════════════════════════════════════════════════════════');

		// Confirm
		const confirmAnswer = await prompt(`\n⚠️  Proceed with granting ${totalTickets} total entries to ${recipients.length} recipient(s)? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute grants for each recipient
		console.log('\n🔄 Granting entries...\n');
		let successCount = 0;

		for (let i = 0; i < recipients.length; i++) {
			const recipient = recipients[i];
			const count = ticketCounts[i];

			console.log(`📦 ${i + 1}/${recipients.length}: ${recipient.input} (${count} entries)`);

			try {
				// Estimate gas
				const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'adminGrantEntry', [
					poolId,
					count,
					recipient.address,
				], 200000);
				const gasEstimate = gasInfo.gasLimit;
				const gasLimit = Math.floor(gasEstimate * 1.2);

				// Execute
				const executionResult = await executeContractFunction({
					contractId: contractId,
					iface: lazyLottoIface,
					client: client,
					functionName: 'adminGrantEntry',
					params: [poolId, count, recipient.address],
					gas: gasLimit,
					payableAmount: 0,
				});

				if (!executionResult.success) {
					console.error(`   ❌ Failed: ${executionResult.error || 'Transaction execution failed'}`);
				}
				else {
					const { receipt, record } = executionResult;
					const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
					console.log(`   ✅ Success - TX: ${txId}`);
					successCount++;
				}
			}
			catch (error) {
				console.error(`   ❌ Error: ${error.message}`);
			}

			console.log('');
		}

		// Final summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  RESULTS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Successful: ${successCount}/${recipients.length}`);
		console.log(`  Failed: ${recipients.length - successCount}/${recipients.length}`);
		if (successCount === recipients.length) {
			console.log('  ✅ All entries granted successfully!');
			console.log(`  🎁 Total: ${totalTickets} entries to ${recipients.length} recipients`);
		}
		else {
			console.log('  ⚠️  Some grants failed - see errors above');
		}
		console.log('═══════════════════════════════════════════════════════════\n');

	}
	catch (error) {
		console.error('\n❌ Error granting entries:', error.message);
		if (error.status) {
			console.error('Status:', error.status.toString());
		}
		process.exit(1);
	}
	finally {
		if (client) {
			client.close();
		}
	}
}

// Run the script when invoked directly; stay importable (e.g. for tests/reuse).
if (require.main === module) {
	grantEntry();
}

module.exports = { validateRecipient, longZeroAddress };
