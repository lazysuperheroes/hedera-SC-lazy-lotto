/**
 * LazyLotto Set Creation Fees Script
 *
 * Allows admin to update the HBAR and LAZY fees required to create community pools.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/setCreationFees.js [--hbar <amount>] [--lazy <amount>]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/setCreationFees.js [--hbar <amount>] [--lazy <amount>] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/setCreationFees.js --multisig-help
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
const { ContractId, Hbar } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { homebrewPopulateAccountNum, EntityType, getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');
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

async function setCreationFees() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Parse command line arguments
		const args = process.argv.slice(2);
		let hbarFeeInput = null;
		let lazyFeeInput = null;

		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--hbar' && args[i + 1]) {
				hbarFeeInput = args[i + 1];
				i++;
			}
			else if (args[i] === '--lazy' && args[i + 1]) {
				lazyFeeInput = args[i + 1];
				i++;
			}
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Set Creation Fees (Admin)               ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load PoolManager ABI
		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		// Check if operator is admin (isAdmin lives on LazyLotto, not PoolManager)
		console.log('🔍 Verifying admin permissions...\n');
		const lazyLottoAddrResult = await queryContract(env, poolManagerId, poolManagerIface, 'lazyLotto', [], operatorId);
		const lazyLottoAddr = lazyLottoAddrResult[0];
		const lazyLottoId = ContractId.fromString(await homebrewPopulateAccountNum(env, lazyLottoAddr, EntityType.CONTRACT));

		const lazyLottoIface = loadInterface('LazyLotto');

		const isAdminResult = await queryContract(env, lazyLottoId, lazyLottoIface, 'isAdmin', [operatorId.toSolidityAddress()], operatorId);
		const isAdmin = isAdminResult[0];

		if (!isAdmin) {
			console.error('❌ You are not an admin of the PoolManager contract');
			process.exit(1);
		}

		console.log('✅ Admin status confirmed\n');

		// Get LAZY token address and decimals from mirror node
		const lazyTokenAddrResult = await queryContract(env, poolManagerId, poolManagerIface, 'lazyToken', [], operatorId);
		const lazyTokenAddr = lazyTokenAddrResult[0];
		const lazyTokenId = await homebrewPopulateAccountNum(env, lazyTokenAddr, EntityType.TOKEN);

		const lazyTokenDetails = await getTokenDetails(env, lazyTokenId);
		const lazyDecimals = Number(lazyTokenDetails.decimals);
		const lazySymbol = lazyTokenDetails.symbol || 'LAZY';

		// Get current fees
		console.log('🔍 Fetching current fees...\n');
		const currentFeesResult = await queryContract(env, poolManagerId, poolManagerIface, 'getCreationFees', [], operatorId);
		const [currentHbarFee, currentLazyFee] = currentFeesResult;

		const currentLazyDisplay = Number(currentLazyFee) / (10 ** lazyDecimals);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  CURRENT FEES');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  HBAR Fee:         ${Hbar.fromTinybars(currentHbarFee).toString()}`);
		console.log(`  ${lazySymbol} Fee:         ${currentLazyDisplay} ${lazySymbol} (${lazyDecimals} decimals)`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Prompt for new fees if not provided
		if (hbarFeeInput === null) {
			hbarFeeInput = await prompt(`Enter new HBAR fee in whole HBAR (current: ${Hbar.fromTinybars(currentHbarFee).toString()}): `);
		}

		if (lazyFeeInput === null) {
			lazyFeeInput = await prompt(`Enter new ${lazySymbol} fee in whole ${lazySymbol} (current: ${currentLazyDisplay}): `);
		}

		// Parse and validate fees - convert whole units to base units
		const newHbarFee = Hbar.from(parseFloat(hbarFeeInput));
		const newLazyFeeBaseUnits = BigInt(Math.floor(parseFloat(lazyFeeInput) * (10 ** lazyDecimals)));

		if (BigInt(newHbarFee.toTinybars().toString()) < 0) {
			console.error('❌ HBAR fee cannot be negative');
			process.exit(1);
		}

		if (newLazyFeeBaseUnits < 0n) {
			console.error(`❌ ${lazySymbol} fee cannot be negative`);
			process.exit(1);
		}

		// Display new fees
		const newLazyDisplay = Number(newLazyFeeBaseUnits) / (10 ** lazyDecimals);
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  NEW FEES');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  HBAR Fee:         ${newHbarFee.toString()} (${BigInt(newHbarFee.toTinybars().toString())} tinybars)`);
		console.log(`  ${lazySymbol} Fee:         ${newLazyDisplay} ${lazySymbol} (${newLazyFeeBaseUnits} base units)`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Confirm action
		const confirmation = await prompt('Update creation fees? (yes/no): ');
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
			'setCreationFees',
			[BigInt(newHbarFee.toTinybars().toString()), newLazyFeeBaseUnits],
			150000,
		);
		const gasEstimate = gasInfo.gasLimit;

		console.log(`Estimated gas: ${gasEstimate}`);

		// Execute transaction with 20% buffer
		const gasToUse = Math.floor(gasEstimate * 1.2);
		console.log(`Using gas: ${gasToUse} (20% buffer)\n`);

		console.log('📤 Updating creation fees...\n');

		const executionResult = await executeContractFunction({
			contractId: poolManagerId,
			iface: poolManagerIface,
			client: client,
			functionName: 'setCreationFees',
			params: [BigInt(newHbarFee.toTinybars().toString()), newLazyFeeBaseUnits],
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

		// Verify new fees
		console.log('🔍 Verifying updated fees...\n');
		const verifyResult = await queryContract(env, poolManagerId, poolManagerIface, 'getCreationFees', [], operatorId);
		const [verifyHbarFee, verifyLazyFee] = verifyResult;

		const verifyLazyDisplay = Number(verifyLazyFee) / (10 ** lazyDecimals);
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  UPDATED FEES');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  HBAR Fee:         ${Hbar.fromTinybars(verifyHbarFee).toString()}`);
		console.log(`  ${lazySymbol} Fee:         ${verifyLazyDisplay} ${lazySymbol}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('✨ Creation fees updated successfully!\n');

	}
	catch (error) {
		console.error('\n❌ Error updating creation fees:', error.message);
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
setCreationFees();
