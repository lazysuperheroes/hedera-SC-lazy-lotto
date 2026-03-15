/**
 * LazyLotto Set Bonuses Script
 *
 * Configure win rate boost bonuses:
 * - Time-based bonuses (start/end/bps)
 * - NFT holder bonuses (token/bps)
 * - LAZY balance bonuses (threshold/bps)
 *
 * Requires ADMIN role.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/setBonuses.js
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/setBonuses.js --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/setBonuses.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 */

const { ethers } = require('ethers');
const { TokenId } = require('@hashgraph/sdk');
require('dotenv').config();

const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { convertToHederaId, EntityType } = require('../../../../utils/addressHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const lazyDecimals = parseInt(process.env.LAZY_DECIMALS ?? '1');

async function setBonuses() {
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║           LazyLotto Set Bonuses (Admin)                   ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 LazyLotto: ${contractId.toString()}\n`);

		displayMultiSigBanner();

		const lazyLottoIface = loadInterface('LazyLotto');

		// Resolve PoolManager address from LazyLotto
		console.log('🔍 Resolving PoolManager contract from LazyLotto...\n');
		const pmResult = await queryContract(env, contractId, lazyLottoIface, 'poolManager', [], operatorId);
		const poolManagerHederaId = await convertToHederaId(env, pmResult[0], EntityType.CONTRACT);
		const { ContractId } = require('@hashgraph/sdk');
		const poolManagerId = ContractId.fromString(poolManagerHederaId);
		console.log(`📄 PoolManager: ${poolManagerId.toString()}\n`);

		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		// Menu
		console.log('Select bonus type to configure:');
		console.log('1. Time Bonus (start time, end time, BPS)');
		console.log('2. NFT Holder Bonus (token, BPS)');
		console.log('3. LAZY Balance Bonus (threshold, BPS)');

		const choice = await prompt('\nEnter choice (1-3): ');

		let functionName, params;

		switch (choice) {
		case '1': {
			// Time bonus
			console.log('\n⏰ Configure Time Bonus\n');
			console.log('Enter 0 for start/end to disable bonus\n');

			const startStr = await prompt('Enter start timestamp (seconds): ');
			const endStr = await prompt('Enter end timestamp (seconds): ');
			const bpsStr = await prompt('Enter bonus BPS (0-10000, e.g., 100 = 1%): ');

			const start = BigInt(startStr);
			const end = BigInt(endStr);
			const bps = parseInt(bpsStr);

			if (bps < 0 || bps > 10000) {
				console.error('❌ BPS must be between 0 and 10000');
				process.exit(1);
			}

			functionName = 'setTimeBonus';
			params = [start, end, bps];

			console.log('\nConfiguration:');
			console.log(`  Start: ${start === 0n ? 'Disabled' : new Date(Number(start) * 1000).toISOString()}`);
			console.log(`  End: ${end === 0n ? 'Disabled' : new Date(Number(end) * 1000).toISOString()}`);
			console.log(`  Bonus: ${bps / 100}%\n`);
			break;
		}

		case '2': {
			// NFT bonus
			console.log('\n🎨 Configure NFT Holder Bonus\n');
			console.log('Enter 0x0 for token to disable bonus\n');

			const tokenInput = await prompt('Enter NFT token ID (0.0.xxxxx) or EVM address: ');
			const bpsStr = await prompt('Enter bonus BPS (0-10000, e.g., 100 = 1%): ');

			let tokenAddress;
			if (tokenInput.startsWith('0x')) {
				tokenAddress = tokenInput;
			}
			else {
				try {
					const tokenId = TokenId.fromString(tokenInput);
					tokenAddress = tokenId.toSolidityAddress();
				}
				catch {
					console.error('❌ Invalid token ID format');
					process.exit(1);
				}
			}

			const bps = parseInt(bpsStr);

			if (bps < 0 || bps > 10000) {
				console.error('❌ BPS must be between 0 and 10000');
				process.exit(1);
			}

			functionName = 'setNFTBonus';
			params = [tokenAddress, bps];

			console.log('\nConfiguration:');
			console.log(`  Token: ${tokenInput}`);
			console.log(`  Bonus: ${bps / 100}%\n`);
			break;
		}

		case '3': {
			// LAZY balance bonus
			console.log('\n💎 Configure LAZY Balance Bonus\n');
			console.log('Enter 0 for threshold to disable bonus\n');

			const thresholdStr = await prompt('Enter LAZY balance threshold (tokens): ');
			const bpsStr = await prompt('Enter bonus BPS (0-10000, e.g., 100 = 1%): ');

			let threshold;
			try {
				threshold = ethers.parseUnits(thresholdStr, lazyDecimals);
			}
			catch {
				console.error('❌ Invalid threshold format');
				process.exit(1);
			}

			const bps = parseInt(bpsStr);

			if (bps < 0 || bps > 10000) {
				console.error('❌ BPS must be between 0 and 10000');
				process.exit(1);
			}

			functionName = 'setLazyBalanceBonus';
			params = [threshold, bps];

			console.log('\nConfiguration:');
			console.log(`  Threshold: ${ethers.formatUnits(threshold, lazyDecimals)} LAZY`);
			console.log(`  Bonus: ${bps / 100}%\n`);
			break;
		}

		default:
			console.error('❌ Invalid choice');
			process.exit(1);
		}

		// Confirm
		const answer = await prompt('Apply bonus configuration? (yes/no): ');
		if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute on PoolManager (bonus functions live there, not on LazyLotto)
		console.log('\n🔄 Setting bonus...');

		const executionResult = await executeContractFunction({
			contractId: poolManagerId,
			iface: poolManagerIface,
			client: client,
			functionName: functionName,
			params: params,
			gas: 150000,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log('\n✅ Bonus configured successfully!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

	}
	catch (error) {
		console.error('\n❌ Error setting bonus:', error.message);
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

setBonuses();
