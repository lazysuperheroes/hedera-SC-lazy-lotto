/**
 * Set Platform Fee Percentage
 *
 * Allows admin to set the platform's percentage of pool proceeds (0-25%).
 * Pool owners receive the remaining percentage (75-100%).
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/setPlatformFee.js [percentage]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/setPlatformFee.js [percentage] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/setPlatformFee.js --multisig-help
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
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');

async function setPlatformFee(percentage) {
	let client;

	try {
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         Set Platform Fee Percentage (Admin)               ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

		displayMultiSigBanner();

		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		// Get current percentage
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📋 Current Platform Fee');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const currentPercentage = await queryContract(env, poolManagerId, poolManagerIface, 'platformProceedsPercentage', [], operatorId);

		const currentPercent = Number(currentPercentage[0]);
		const currentOwnerPercent = 100 - currentPercent;

		console.log(`   Platform: ${currentPercent}%`);
		console.log(`   Pool Owner: ${currentOwnerPercent}%\n`);

		const ownerPercent = 100 - percentage;

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🆕 New Platform Fee');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		console.log(`   Platform: ${percentage}%`);
		console.log(`   Pool Owner: ${ownerPercent}%\n`);

		// Confirm
		const answer = await prompt('❓ Confirm setting new platform fee? (yes/no): ');
		if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled.\n');
			return;
		}

		console.log('\n⏳ Setting platform fee percentage...\n');

		const executionResult = await executeContractFunction({
			contractId: poolManagerId,
			iface: poolManagerIface,
			client: client,
			functionName: 'setPlatformProceedsPercentage',
			params: [percentage],
			gas: 300000,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt } = executionResult;

		console.log('✅ Platform fee updated successfully!\n');

		const txId = receipt.transactionId?.toString() || 'N/A';
		const status = receipt.status?.toString() || 'SUCCESS';

		console.log(`   Transaction: ${txId}`);
		console.log(`   Status: ${status}\n`);

		// Verify new percentage
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('✓ Verified New Fee');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		const newPercentage = await queryContract(env, poolManagerId, poolManagerIface, 'platformProceedsPercentage', [], operatorId);

		const newPercent = Number(newPercentage[0]);
		const newOwnerPercent = 100 - newPercent;

		console.log(`   Platform: ${newPercent}%`);
		console.log(`   Pool Owner: ${newOwnerPercent}%\n`);

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	}
	catch (error) {
		console.error('\n❌ Error setting platform fee:');
		console.error(error.message);
		if (error.stack) {
			console.error('\nStack trace:');
			console.error(error.stack);
		}
		process.exit(1);
	}
	finally {
		if (client) {
			client.close();
		}
	}
}

async function main() {
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let percentage = process.argv[2];

	if (percentage && percentage.startsWith('--')) {
		percentage = null;
	}

	if (!percentage) {
		percentage = await prompt('Enter platform fee percentage (0-25): ');
	}

	percentage = parseInt(percentage);

	if (isNaN(percentage) || percentage < 0 || percentage > 25) {
		console.error('❌ Invalid percentage. Must be between 0 and 25.');
		process.exit(1);
	}

	await setPlatformFee(percentage);
}

main();
