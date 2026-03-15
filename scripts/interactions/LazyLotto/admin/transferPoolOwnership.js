/**
 * LazyLotto Transfer Pool Ownership Script
 *
 * Allows pool owner (or admin) to transfer ownership of a community pool to a new owner.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/transferPoolOwnership.js [--pool <id>] [--newowner <accountId>]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/transferPoolOwnership.js [--pool <id>] [--newowner <accountId>] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/transferPoolOwnership.js --multisig-help
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

// Helper: Convert EVM address to Hedera ID
async function convertToHederaId(evmAddress) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return '0.0.0 (Zero Address)';
	return await homebrewPopulateAccountNum(env, evmAddress);
}

async function transferPoolOwnership() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Parse command line arguments
		const args = process.argv.slice(2);
		let poolIdInput = null;
		let newOwnerInput = null;

		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--pool' && args[i + 1]) {
				poolIdInput = args[i + 1];
				i++;
			}
			else if (args[i] === '--newowner' && args[i + 1]) {
				newOwnerInput = args[i + 1];
				i++;
			}
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Transfer Pool Ownership                 ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`👤 Operator: ${operatorId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load PoolManager ABI
		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		// Prompt for pool ID if not provided
		if (!poolIdInput) {
			poolIdInput = await prompt('Enter pool ID: ');
		}

		const poolId = parseInt(poolIdInput);
		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		// Get current pool owner
		console.log('🔍 Fetching current pool owner...\n');
		const currentOwnerResult = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolOwner', [poolId], operatorId);
		const currentOwnerAddress = currentOwnerResult[0];
		const currentOwner = await convertToHederaId(currentOwnerAddress);

		// Check if it's a global pool (no owner)
		if (currentOwnerAddress === '0x0000000000000000000000000000000000000000') {
			console.error('❌ Cannot transfer ownership of global pools (they have no owner)');
			process.exit(1);
		}

		// Resolve LazyLotto address from PoolManager for isAdmin check
		const lazyLottoAddrResult = await queryContract(env, poolManagerId, poolManagerIface, 'lazyLotto', [], operatorId);
		const lazyLottoAddr = lazyLottoAddrResult[0];
		const lazyLottoHederaId = await homebrewPopulateAccountNum(env, lazyLottoAddr, EntityType.CONTRACT);
		const lazyLottoId = ContractId.fromString(lazyLottoHederaId);

		// Load LazyLotto ABI for isAdmin check
		const lazyLottoIface = loadInterface('LazyLotto');

		// Check if operator is current owner or admin
		const isCurrentOwner = currentOwnerAddress.toLowerCase() === operatorId.toSolidityAddress().toLowerCase();

		const isAdminResult = await queryContract(env, lazyLottoId, lazyLottoIface, 'isAdmin', [operatorId.toSolidityAddress()], operatorId);
		const isAdmin = isAdminResult[0];

		if (!isCurrentOwner && !isAdmin) {
			console.error('❌ You are not the pool owner or an admin');
			console.error(`Current owner: ${currentOwner}`);
			process.exit(1);
		}

		console.log(`✅ Current owner: ${currentOwner}`);
		console.log(`✅ Authorization: ${isCurrentOwner ? 'Owner' : 'Admin'}\n`);

		// Prompt for new owner if not provided
		if (!newOwnerInput) {
			newOwnerInput = await prompt('Enter new owner account ID (e.g., 0.0.1234): ');
		}

		// Parse new owner ID
		let newOwnerId;
		try {
			newOwnerId = AccountId.fromString(newOwnerInput);
		}
		catch {
			console.error('❌ Invalid account ID format. Use format like 0.0.1234');
			process.exit(1);
		}

		const newOwnerAddress = newOwnerId.toSolidityAddress();

		// Check if new owner is same as current
		if (newOwnerAddress.toLowerCase() === currentOwnerAddress.toLowerCase()) {
			console.error('❌ New owner is the same as current owner');
			process.exit(1);
		}

		// Display summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  OWNERSHIP TRANSFER');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool ID:          #${poolId}`);
		console.log(`  Current Owner:    ${currentOwner}`);
		console.log(`  New Owner:        ${newOwnerId.toString()}`);
		console.log(`  Initiated By:     ${operatorId.toString()} (${isCurrentOwner ? 'Owner' : 'Admin'})`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('⚠️  Warning: This action is irreversible!');
		console.log('   The new owner will have full control over the pool, including:');
		console.log('   - Withdrawing proceeds');
		console.log('   - Transferring ownership again');
		console.log('   - Any other pool management actions\n');

		// Confirm action
		const confirmation = await prompt('Transfer pool ownership? (yes/no): ');
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
			'transferPoolOwnership',
			[poolId, newOwnerAddress],
			150000,
		);
		const gasEstimate = gasInfo.gasLimit;

		console.log(`Estimated gas: ${gasEstimate}`);

		// Execute transaction with 20% buffer
		const gasToUse = Math.floor(gasEstimate * 1.2);
		console.log(`Using gas: ${gasToUse} (20% buffer)\n`);

		console.log('📤 Transferring pool ownership...\n');

		const executionResult = await executeContractFunction({
			contractId: poolManagerId,
			iface: poolManagerIface,
			client: client,
			functionName: 'transferPoolOwnership',
			params: [poolId, newOwnerAddress],
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

		// Verify new owner
		console.log('🔍 Verifying new owner...\n');
		const verifyResult = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolOwner', [poolId], operatorId);
		const verifyOwnerAddress = verifyResult[0];
		const verifyOwner = await convertToHederaId(verifyOwnerAddress);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  TRANSFER COMPLETE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool ID:          #${poolId}`);
		console.log(`  New Owner:        ${verifyOwner}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		if (verifyOwnerAddress.toLowerCase() === newOwnerAddress.toLowerCase()) {
			console.log('✨ Pool ownership transferred successfully!\n');
		}
		else {
			console.log('⚠️  Warning: Owner verification mismatch. This may be a timing issue with the mirror node.\n');
			console.log(`Expected: ${newOwnerId.toString()}`);
			console.log(`Got: ${verifyOwner}\n`);
		}

	}
	catch (error) {
		console.error('\n❌ Error transferring pool ownership:', error.message);
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
transferPoolOwnership();
