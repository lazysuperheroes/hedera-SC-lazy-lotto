/**
 * LazyLotto Manage Roles Script
 *
 * Add or remove admin and prize manager roles.
 * Requires ADMIN role to execute.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/manageRoles.js
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/manageRoles.js --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/manageRoles.js --multisig-help
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
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');
const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

async function manageRoles() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║            LazyLotto Manage Roles (Admin)                 ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load LazyLotto ABI (admin operations)
		const lazyLottoIface = loadInterface('LazyLotto');

		// Load PoolManager ABI (prize manager operations)
		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		// Resolve PoolManager address from LazyLotto
		const pmResult = await queryContract(env, contractId, lazyLottoIface, 'poolManager', [], operatorId);
		const poolManagerAddr = pmResult[0];
		const poolManagerHederaId = await homebrewPopulateAccountNum(env, poolManagerAddr, EntityType.CONTRACT);
		const poolManagerId = ContractId.fromString(poolManagerHederaId);

		// Menu
		console.log('Select action:');
		console.log('1. Add Admin (on LazyLotto)');
		console.log('2. Remove Admin (on LazyLotto)');
		console.log('3. Add Global Prize Manager (on PoolManager)');
		console.log('4. Remove Global Prize Manager (on PoolManager)');

		const choice = await prompt('\nEnter choice (1-4): ');

		let operation, functionName, targetContractId, targetIface, roleType;

		switch (choice) {
		case '1':
			operation = 'add';
			functionName = 'addAdmin';
			targetContractId = contractId;
			targetIface = lazyLottoIface;
			roleType = 'Admin';
			console.log('\n➕ Add Admin\n');
			break;
		case '2':
			operation = 'remove';
			functionName = 'removeAdmin';
			targetContractId = contractId;
			targetIface = lazyLottoIface;
			roleType = 'Admin';
			console.log('\n➖ Remove Admin\n');
			break;
		case '3':
			operation = 'add';
			functionName = 'addGlobalPrizeManager';
			targetContractId = poolManagerId;
			targetIface = poolManagerIface;
			roleType = 'Global Prize Manager';
			console.log('\n➕ Add Global Prize Manager\n');
			break;
		case '4':
			operation = 'remove';
			functionName = 'removeGlobalPrizeManager';
			targetContractId = poolManagerId;
			targetIface = poolManagerIface;
			roleType = 'Global Prize Manager';
			console.log('\n➖ Remove Global Prize Manager\n');
			break;
		default:
			console.error('❌ Invalid choice');
			process.exit(1);
		}

		// Get address
		const addressInput = await prompt('Enter Hedera account ID (0.0.xxxxx) or EVM address: ');

		let targetAddress;
		if (addressInput.startsWith('0x')) {
			// EVM address
			targetAddress = addressInput;
		}
		else {
			// Hedera ID - convert to EVM
			try {
				const accountId = AccountId.fromString(addressInput);
				targetAddress = accountId.toSolidityAddress();
			}
			catch {
				console.error('❌ Invalid account ID format');
				process.exit(1);
			}
		}

		console.log(`\nTarget address: ${targetAddress}`);
		console.log(`Target contract: ${targetContractId.toString()}`);

		// Confirm
		const confirmAnswer = await prompt(`${operation === 'add' ? 'Add' : 'Remove'} ${roleType} role ${operation === 'add' ? 'to' : 'from'} ${addressInput}? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log(`\n🔄 ${operation === 'add' ? 'Adding' : 'Removing'} ${roleType.toLowerCase()}...`);

		const executionResult = await executeContractFunction({
			contractId: targetContractId,
			iface: targetIface,
			client: client,
			functionName: functionName,
			params: [targetAddress],
			gas: 100000,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log(`\n✅ ${roleType} role ${operation === 'add' ? 'added' : 'removed'} successfully!`);
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

	}
	catch (error) {
		console.error('\n❌ Error managing roles:', error.message);
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
manageRoles();
