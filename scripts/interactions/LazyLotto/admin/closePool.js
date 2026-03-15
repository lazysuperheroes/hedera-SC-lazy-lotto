/**
 * LazyLotto Close Pool Script
 *
 * Permanently closes a pool. Pool must have no outstanding entries or pending prizes.
 * Requires ADMIN role.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/closePool.js [poolId]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/closePool.js [poolId] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/closePool.js --multisig-help
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

async function closePool() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		let poolIdStr = process.argv[2];

		// Filter out flag arguments
		if (poolIdStr && poolIdStr.startsWith('--')) {
			poolIdStr = null;
		}

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID to close: ');
		}

		const poolId = parseInt(poolIdStr);
		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║             LazyLotto Close Pool (Admin)                  ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Check pool status first
		console.log('🔍 Checking pool status...');

		const poolBasicInfo = await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);
		// Destructure: (ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenId, paused, closed, feeToken)
		const [, , , , , outstandingEntries, , , closed] = poolBasicInfo;

		if (!poolBasicInfo) {
			console.error('\n❌ Pool does not exist');
			process.exit(1);
		}

		if (closed) {
			console.log('\n⚠️  Pool is already closed');
			process.exit(0);
		}

		console.log(`Outstanding Entries: ${outstandingEntries.toString()}\n`);

		// Warn if there are outstanding entries
		if (Number(outstandingEntries) > 0) {
			console.log('⚠️  WARNING: Pool has outstanding entries!');
			console.log('   Users should roll and claim prizes before closing.\n');
		}

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'closePool', [poolId], 150000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm
		console.log('⚠️  This action is PERMANENT and cannot be undone!');
		const confirmAnswer = await prompt(`Close pool #${poolId} PERMANENTLY? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Closing pool...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const executionResult = await executeContractFunction({
			contractId: contractId,
			iface: lazyLottoIface,
			client: client,
			functionName: 'closePool',
			params: [poolId],
			gas: gasLimit,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			console.error('\n❌ Transaction failed');
			console.error('   Possible reasons:');
			console.error('   - Pool has outstanding entries');
			console.error('   - Pool has unclaimed prizes');
			console.error('   - Not authorized (requires ADMIN)');
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log('\n✅ Pool closed successfully!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

		console.log('🔒 Pool is now permanently closed.');
		console.log('   - No further ticket purchases');
		console.log('   - No further prize additions');
		console.log('   - Can remove remaining prizes with removePrizes.js\n');

	}
	catch (error) {
		console.error('\n❌ Error closing pool:', error.message);
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
closePool();
