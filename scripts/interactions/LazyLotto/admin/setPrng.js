/**
 * LazyLotto Set PRNG Contract Script
 *
 * Update the PRNG (Pseudo-Random Number Generator) contract address.
 * Used for VRF randomness in roll outcomes.
 * Requires ADMIN role.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/setPrng.js
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/setPrng.js --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/setPrng.js --multisig-help
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
const { ContractId } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

async function setPrng() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║          LazyLotto Set PRNG Contract (Admin)              ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Get current PRNG contract
		try {
			const decoded = await queryContract(env, contractId, lazyLottoIface, 'prng', [], operatorId);
			const currentPrng = decoded[0];

			// Try to convert to Hedera ID
			const hederaId = await homebrewPopulateAccountNum(env, currentPrng);

			console.log(`📊 Current PRNG contract: ${currentPrng}`);
			if (hederaId) {
				console.log(`   (Hedera ID: ${hederaId.toString()})\n`);
			}
			else {
				console.log('');
			}
		}
		catch {
			console.log('⚠️  Could not fetch current PRNG contract\n');
		}

		// Get new PRNG address
		const prngInput = await prompt('Enter new PRNG contract (0.0.xxxxx or 0x...): ');

		let prngAddress;
		if (prngInput.startsWith('0x')) {
			// EVM address
			prngAddress = prngInput;
		}
		else {
			// Hedera ID - convert to EVM
			try {
				const prngContractId = ContractId.fromString(prngInput);
				prngAddress = prngContractId.toSolidityAddress();
			}
			catch {
				console.error('❌ Invalid contract ID format');
				process.exit(1);
			}
		}

		console.log(`\n🎲 New PRNG contract: ${prngAddress}`);

		// Confirm
		const confirmAnswer = await prompt(`Set PRNG contract to ${prngInput}? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Setting PRNG contract...');

		const executionResult = await executeContractFunction({
			contractId: contractId,
			iface: lazyLottoIface,
			client: client,
			functionName: 'setPrng',
			params: [prngAddress],
			gas: 100000,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log('\n✅ PRNG contract updated successfully!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

	}
	catch (error) {
		console.error('\n❌ Error setting PRNG contract:', error.message);
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
setPrng();
