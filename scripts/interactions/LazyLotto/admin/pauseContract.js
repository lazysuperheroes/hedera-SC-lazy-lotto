/**
 * LazyLotto Contract Pause/Unpause Script
 *
 * Pause or unpause the entire LazyLotto contract (emergency stop).
 * This is different from pool-level pause - this affects ALL operations.
 * Requires ADMIN role.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/pauseContract.js
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/pauseContract.js --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/pauseContract.js --multisig-help
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
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

async function pauseContract() {
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║        LazyLotto Contract Pause/Unpause (Admin)           ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		displayMultiSigBanner();

		const lazyLottoIface = loadInterface('LazyLotto');

		// Menu
		console.log('⚠️  Contract-level pause affects ALL operations globally.\n');
		console.log('Select action:');
		console.log('1. Pause Contract (Emergency Stop)');
		console.log('2. Unpause Contract');

		const choice = await prompt('\nEnter choice (1-2): ');

		let functionName, actionDesc;

		switch (choice) {
		case '1':
			functionName = 'pause';
			actionDesc = 'Pause';
			console.log('\n🛑 Pause Contract (Emergency Stop)\n');
			break;
		case '2':
			functionName = 'unpause';
			actionDesc = 'Unpause';
			console.log('\n✅ Unpause Contract\n');
			break;
		default:
			console.error('❌ Invalid choice');
			process.exit(1);
		}

		// Confirm
		const answer = await prompt(`${actionDesc} the entire LazyLotto contract? (yes/no): `);
		if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log(`\n🔄 ${actionDesc}ing contract...`);

		const executionResult = await executeContractFunction({
			contractId: contractId,
			iface: lazyLottoIface,
			client: client,
			functionName: functionName,
			params: [],
			gas: 100000,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log(`\n✅ Contract ${actionDesc.toLowerCase()} successfully!`);
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

	}
	catch (error) {
		console.error('\n❌ Error managing contract pause state:', error.message);
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

pauseContract();
