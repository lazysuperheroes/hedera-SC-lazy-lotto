/**
 * LazyLotto Set Burn Percentage Script
 *
 * Update the burn percentage applied to LAZY token entry fees.
 * Percentage must be between 0-100 (where 100 = 100% burn).
 * Requires ADMIN role.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/setBurnPercentage.js
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/setBurnPercentage.js --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/setBurnPercentage.js --multisig-help
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
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

async function setBurnPercentage() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║        LazyLotto Set Burn Percentage (Admin)              ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Get current burn percentage
		try {
			const decoded = await queryContract(env, contractId, lazyLottoIface, 'burnPercentage', [], operatorId);
			const currentBurnPercentage = decoded[0];
			console.log(`📊 Current burn percentage: ${currentBurnPercentage}%\n`);
		}
		catch {
			console.log('⚠️  Could not fetch current burn percentage');
		}

		// Get new burn percentage
		const percentageStr = await prompt('Enter new burn percentage (0-100): ');

		let burnPercentage;
		try {
			burnPercentage = parseInt(percentageStr);
			if (isNaN(burnPercentage) || burnPercentage < 0 || burnPercentage > 100) {
				console.error('❌ Burn percentage must be between 0 and 100');
				process.exit(1);
			}
		}
		catch {
			console.error('❌ Invalid percentage format');
			process.exit(1);
		}

		console.log(`\n🔥 New burn percentage: ${burnPercentage}%`);

		// Confirm
		const confirmAnswer = await prompt(`Set burn percentage to ${burnPercentage}%? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Setting burn percentage...');

		const executionResult = await executeContractFunction({
			contractId: contractId,
			iface: lazyLottoIface,
			client: client,
			functionName: 'setBurnPercentage',
			params: [burnPercentage],
			gas: 100000,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log('\n✅ Burn percentage updated successfully!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

	}
	catch (error) {
		console.error('\n❌ Error setting burn percentage:', error.message);
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
setBurnPercentage();
