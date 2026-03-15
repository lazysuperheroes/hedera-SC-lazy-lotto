/**
 * Manage Global Prize Managers
 *
 * Allows admin to:
 * - View all global prize managers
 * - Add a new global prize manager
 * - Remove an existing global prize manager
 * - Check if an account is a global prize manager
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/manageGlobalPrizeManagers.js
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/manageGlobalPrizeManagers.js --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/manageGlobalPrizeManagers.js --multisig-help
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
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');

async function convertToEvmAddress(accountId) {
	// Convert Hedera account ID to EVM address format
	const account = AccountId.fromString(accountId);
	const accountNum = account.num;
	const evmAddress = '0x' + accountNum.toString(16).padStart(40, '0');
	return evmAddress;
}

async function manageGlobalPrizeManagers() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║        Manage Global Prize Managers (Admin)               ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Pool Manager: ${poolManagerId.toString()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load interface
		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		// Show menu
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('🎯 Options');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
		console.log('   1. View all global prize managers');
		console.log('   2. Add a global prize manager');
		console.log('   3. Remove a global prize manager');
		console.log('   4. Check if account is a global prize manager\n');

		const choice = await prompt('Select option (1-4): ');

		if (choice === '1') {
			// View count (no enumeration function exists on-chain)
			console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
			console.log('📋 Global Prize Managers');
			console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

			const countResult = await queryContract(env, poolManagerId, poolManagerIface, 'getGlobalPrizeManagerCount', [], operatorId);
			const count = countResult[0];

			console.log(`   Total global prize managers: ${Number(count)}\n`);
			if (Number(count) === 0) {
				console.log('   No global prize managers configured.\n');
			}
			else {
				console.log('   Note: The contract does not provide an enumeration function.');
				console.log('   Use option 4 to check if a specific account is a global prize manager.\n');
			}
		}
		else if (choice === '2') {
			// Add
			const accountInput = await prompt('\nEnter account ID to add (e.g., 0.0.12345): ');

			let accountId;
			try {
				accountId = AccountId.fromString(accountInput);
			}
			catch (error) {
				console.error('❌ Invalid account ID format.', error.message);
				return;
			}

			const evmAddress = await convertToEvmAddress(accountId.toString());

			// Check if already a manager
			const isManager = await queryContract(env, poolManagerId, poolManagerIface, 'isGlobalPrizeManager', [evmAddress], operatorId);

			if (isManager[0]) {
				console.log(`\n⚠️  ${accountId.toString()} is already a global prize manager.\n`);
				return;
			}

			const confirmAnswer = await prompt(`\n❓ Confirm adding ${accountId.toString()} as global prize manager? (yes/no): `);
			if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
				console.log('\n❌ Operation cancelled.\n');
				return;
			}

			console.log('\n⏳ Adding global prize manager...\n');

			const executionResult = await executeContractFunction({
				contractId: poolManagerId,
				iface: poolManagerIface,
				client: client,
				functionName: 'addGlobalPrizeManager',
				params: [evmAddress],
				gas: 300000,
				payableAmount: 0,
			});

			if (!executionResult.success) {
				throw new Error(executionResult.error || 'Transaction execution failed');
			}

			const { receipt, record } = executionResult;

			console.log('✅ Global prize manager added successfully!\n');
			console.log(`   Account: ${accountId.toString()}`);
			const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
			console.log(`   Transaction: ${txId}`);
			console.log(`   Status: ${receipt.status.toString()}\n`);
		}
		else if (choice === '3') {
			// Remove
			const accountInput = await prompt('\nEnter account ID to remove (e.g., 0.0.12345): ');

			let accountId;
			try {
				accountId = AccountId.fromString(accountInput);
			}
			catch (error) {
				console.error('❌ Invalid account ID format.', error.message);
				return;
			}

			const evmAddress = await convertToEvmAddress(accountId.toString());

			// Check if is a manager
			const isManager = await queryContract(env, poolManagerId, poolManagerIface, 'isGlobalPrizeManager', [evmAddress], operatorId);

			if (!isManager[0]) {
				console.log(`\n⚠️  ${accountId.toString()} is not a global prize manager.\n`);
				return;
			}

			const confirmAnswer = await prompt(`\n❓ Confirm removing ${accountId.toString()} as global prize manager? (yes/no): `);
			if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
				console.log('\n❌ Operation cancelled.\n');
				return;
			}

			console.log('\n⏳ Removing global prize manager...\n');

			const executionResult = await executeContractFunction({
				contractId: poolManagerId,
				iface: poolManagerIface,
				client: client,
				functionName: 'removeGlobalPrizeManager',
				params: [evmAddress],
				gas: 300000,
				payableAmount: 0,
			});

			if (!executionResult.success) {
				throw new Error(executionResult.error || 'Transaction execution failed');
			}

			const { receipt, record } = executionResult;

			console.log('✅ Global prize manager removed successfully!\n');
			console.log(`   Account: ${accountId.toString()}`);
			const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
			console.log(`   Transaction: ${txId}`);
			console.log(`   Status: ${receipt.status.toString()}\n`);
		}
		else if (choice === '4') {
			// Check
			const accountInput = await prompt('\nEnter account ID to check (e.g., 0.0.12345): ');

			let accountId;
			try {
				accountId = AccountId.fromString(accountInput);
			}
			catch (error) {
				console.error('❌ Invalid account ID format.', error.message);
				return;
			}

			const evmAddress = await convertToEvmAddress(accountId.toString());

			const isManager = await queryContract(env, poolManagerId, poolManagerIface, 'isGlobalPrizeManager', [evmAddress], operatorId);

			console.log(`\n${isManager[0] ? '✅' : '❌'} ${accountId.toString()} ${isManager[0] ? 'IS' : 'IS NOT'} a global prize manager.\n`);
		}
		else {
			console.log('\n❌ Invalid option.\n');
		}

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	}
	catch (error) {
		console.error('\n❌ Error managing global prize managers:');
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

// Run the script
manageGlobalPrizeManagers();
