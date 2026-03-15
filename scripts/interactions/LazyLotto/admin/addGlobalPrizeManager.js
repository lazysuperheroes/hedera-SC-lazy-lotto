/**
 * LazyLotto Add Global Prize Manager Script
 *
 * Allows admin to grant another account the ability to manage prizes for global pools.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/addGlobalPrizeManager.js [--manager <accountId>]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/addGlobalPrizeManager.js [--manager <accountId>] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/addGlobalPrizeManager.js --multisig-help
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
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');

// Helper: Sleep
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function addGlobalPrizeManager() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Parse command line arguments
		const args = process.argv.slice(2);
		let managerInput = null;

		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--manager' && args[i + 1]) {
				managerInput = args[i + 1];
				i++;
			}
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Add Global Prize Manager (Admin)        ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load PoolManager ABI
		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		// Resolve LazyLotto address from PoolManager
		console.log('🔍 Resolving LazyLotto contract from PoolManager...\n');
		const lazyLottoAddrResult = await queryContract(env, poolManagerId, poolManagerIface, 'lazyLotto', [], operatorId);
		const lazyLottoAddr = lazyLottoAddrResult[0];
		const lazyLottoHederaId = await homebrewPopulateAccountNum(env, lazyLottoAddr, EntityType.CONTRACT);
		const lazyLottoId = ContractId.fromString(lazyLottoHederaId);

		// Load LazyLotto ABI for isAdmin check
		const lazyLottoIface = loadInterface('LazyLotto');

		// Check if operator is admin via LazyLotto
		console.log('🔍 Verifying admin permissions...\n');
		const isAdminResult = await queryContract(env, lazyLottoId, lazyLottoIface, 'isAdmin', [operatorId.toSolidityAddress()], operatorId);
		const isAdmin = isAdminResult[0];

		if (!isAdmin) {
			console.error('❌ You are not an admin of the LazyLotto contract');
			process.exit(1);
		}

		console.log('✅ Admin status confirmed\n');

		// Prompt for manager address if not provided
		if (!managerInput) {
			managerInput = await prompt('Enter manager account ID (e.g., 0.0.1234): ');
		}

		// Parse manager ID
		let managerId;
		try {
			managerId = AccountId.fromString(managerInput);
		}
		catch {
			console.error('❌ Invalid account ID format. Use format like 0.0.1234:', managerInput);
			process.exit(1);
		}

		const managerAddress = managerId.toSolidityAddress();

		// Check if already a manager
		console.log('🔍 Checking if already a global prize manager...\n');
		const isAlreadyManagerResult = await queryContract(env, poolManagerId, poolManagerIface, 'isGlobalPrizeManager', [managerAddress], operatorId);
		const isAlreadyManager = isAlreadyManagerResult[0];

		if (isAlreadyManager) {
			console.log('⚠️  This account is already a global prize manager');
			const continueAnyway = await prompt('Continue anyway? (yes/no): ');
			if (continueAnyway.toLowerCase() !== 'yes' && continueAnyway.toLowerCase() !== 'y') {
				console.log('❌ Operation cancelled by user');
				process.exit(0);
			}
		}

		// Display summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  MANAGER DETAILS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Manager ID:       ${managerId.toString()}`);
		console.log(`  Current Status:   ${isAlreadyManager ? 'Already Manager' : 'Not Manager'}`);
		console.log('  New Status:       Manager (can configure global pools)');
		console.log('═══════════════════════════════════════════════════════════\n');

		// Confirm action
		const confirmation = await prompt('Add this account as a global prize manager? (yes/no): ');
		if (confirmation.toLowerCase() !== 'yes' && confirmation.toLowerCase() !== 'y') {
			console.log('❌ Operation cancelled by user');
			process.exit(0);
		}

		// Estimate gas
		console.log('\n⛽ Estimating gas...\n');
		const gasInfo = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			operatorId,
			'addGlobalPrizeManager',
			[managerAddress],
			150000,
		);
		const gasEstimate = gasInfo.gasLimit;

		console.log(`Estimated gas: ${gasEstimate}`);

		// Execute transaction with 20% buffer
		const gasToUse = Math.floor(gasEstimate * 1.2);
		console.log(`Using gas: ${gasToUse} (20% buffer)\n`);

		console.log('📤 Adding global prize manager...\n');

		const executionResult = await executeContractFunction({
			contractId: poolManagerId,
			iface: poolManagerIface,
			client: client,
			functionName: 'addGlobalPrizeManager',
			params: [managerAddress],
			gas: gasToUse,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log('✅ Transaction successful!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

		// Wait for mirror node to sync
		console.log('⏳ Waiting 5 seconds for mirror node to sync...\n');
		await sleep(5000);

		// Verify manager status
		console.log('🔍 Verifying manager status...\n');
		const verifyResult = await queryContract(env, poolManagerId, poolManagerIface, 'isGlobalPrizeManager', [managerAddress], operatorId);
		const verifyManager = verifyResult[0];

		if (verifyManager) {
			console.log('✅ Manager status verified!\n');
			console.log(`${managerId.toString()} is now a global prize manager\n`);
		}
		else {
			console.log('⚠️  Warning: Manager status not confirmed. This may be a timing issue with the mirror node.\n');
		}

		console.log('✨ Global prize manager added successfully!\n');
		console.log('💡 This account can now configure prizes for global pools using prize management scripts.\n');

	}
	catch (error) {
		console.error('\n❌ Error adding global prize manager:', error.message);
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
addGlobalPrizeManager();
