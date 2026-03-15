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
const { AccountId } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

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

		// Convert all recipients to EVM addresses
		const recipients = [];
		for (const input of recipientInputs) {
			let recipientAddress;
			if (input.startsWith('0x')) {
				// EVM address
				recipientAddress = input;
			}
			else {
				// Hedera ID - convert to EVM
				try {
					const accountId = AccountId.fromString(input);
					recipientAddress = '0x' + accountId.toSolidityAddress();
				}
				catch {
					console.error(`❌ Invalid account ID format: ${input}`);
					process.exit(1);
				}
			}
			recipients.push({ input, address: recipientAddress });
		}

		console.log(`\n✅ Parsed ${recipients.length} recipient(s)`);

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
			console.log(`  ${i + 1}. ${recipients[i].input} → ${ticketCounts[i]} entries`);
		}
		console.log('═══════════════════════════════════════════════════════════');

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

// Run the script
grantEntry();
