/**
 * LazyLotto Withdraw Tokens Script
 *
 * Withdraw excess HBAR or fungible tokens from storage contract.
 * Includes safety checks to prevent withdrawing tokens allocated for prizes.
 * Requires ADMIN role.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/withdrawTokens.js
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/withdrawTokens.js --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/withdrawTokens.js --multisig-help
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
const {
	AccountId,
	TokenId,
	Hbar,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { homebrewPopulateAccountNum, checkMirrorHbarBalance, checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const storageContractId = getContractId('LAZY_LOTTO_STORAGE');

// Helper: Convert EVM address to Hedera ID
async function convertToHederaId(evmAddress) {
	if (evmAddress === '0x0000000000000000000000000000000000000000') {
		return 'HBAR';
	}

	const hederaId = await homebrewPopulateAccountNum(env, evmAddress);
	return hederaId ? hederaId.toString() : evmAddress;
}

async function withdrawTokens() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║          LazyLotto Withdraw Tokens (Admin)                ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`💾 Storage: ${storageContractId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Menu
		console.log('Select token type to withdraw:');
		console.log('1. HBAR');
		console.log('2. Fungible Token');

		const choice = await prompt('\nEnter choice (1-2): ');

		let functionName, params, tokenType;

		if (choice === '1') {
			// HBAR withdrawal
			console.log('\n💰 Withdraw HBAR\n');

			// Get storage contract HBAR balance (returns tinybars)
			const storageBalanceTinybars = await checkMirrorHbarBalance(env, storageContractId.toString());
			const storageBalanceHbar = Hbar.fromTinybars(storageBalanceTinybars);
			console.log(`Storage contract balance: ${storageBalanceHbar.toString()} \n`);

			const amountStr = await prompt('Enter amount to withdraw (HBAR): ');

			let amount;
			try {
				// Convert HBAR to tinybars (8 decimals)
				amount = ethers.parseUnits(amountStr, 8);
			}
			catch {
				console.error('❌ Invalid amount format');
				process.exit(1);
			}

			if (amount > BigInt(storageBalanceTinybars)) {
				console.error(`❌ Insufficient balance in storage. Available: ${storageBalanceHbar.toString()}`);
				process.exit(1);
			}

			// Get recipient
			const recipientInput = await prompt('Enter recipient account (0.0.xxxxx) or EVM address: ');

			let recipientAddress;
			if (recipientInput.startsWith('0x')) {
				recipientAddress = recipientInput;
			}
			else {
				try {
					const accountId = AccountId.fromString(recipientInput);
					recipientAddress = accountId.toSolidityAddress();
				}
				catch {
					console.error('❌ Invalid account ID format');
					process.exit(1);
				}
			}

			functionName = 'transferHbarFromStorage';
			params = [recipientAddress, amount];
			tokenType = 'HBAR';

			console.log('\nWithdrawal:');
			console.log(`  Amount: ${Hbar.fromTinybars(amount.toString()).toString()}`);
			console.log(`  To: ${recipientInput}\n`);
		}
		else if (choice === '2') {
			// Fungible token withdrawal
			console.log('\n🪙 Withdraw Fungible Token\n');

			const tokenInput = await prompt('Enter token ID (0.0.xxxxx) or EVM address: ');

			let tokenAddress;
			let tokenId;
			if (tokenInput.startsWith('0x')) {
				tokenAddress = tokenInput;
				const hederaId = await convertToHederaId(tokenAddress);
				tokenId = TokenId.fromString(hederaId);
			}
			else {
				try {
					tokenId = TokenId.fromString(tokenInput);
					tokenAddress = tokenId.toSolidityAddress();
				}
				catch {
					console.error('❌ Invalid token ID format');
					process.exit(1);
				}
			}

			// Get token info from storage contract
			const storageBalance = await checkMirrorBalance(env, storageContractId.toString(), tokenId.toString());
			console.log(`Storage contract balance: ${storageBalance.toString()} units`);

			// Note: The contract's transferFungible function has built-in safety checks
			// to ensure prize obligations are maintained
			console.log('⚠️  Contract will verify prize obligations before allowing withdrawal\n');

			const amountStr = await prompt('Enter amount to withdraw: ');

			let amount;
			try {
				amount = BigInt(amountStr);
			}
			catch {
				console.error('❌ Invalid amount format');
				process.exit(1);
			}

			if (amount > storageBalance) {
				console.error(`❌ Amount exceeds available balance. Max: ${storageBalance.toString()}`);
				process.exit(1);
			}

			// Get recipient
			const recipientInput = await prompt('Enter recipient account (0.0.xxxxx) or EVM address: ');

			let recipientAddress;
			if (recipientInput.startsWith('0x')) {
				recipientAddress = recipientInput;
			}
			else {
				try {
					const accountId = AccountId.fromString(recipientInput);
					recipientAddress = accountId.toSolidityAddress();
				}
				catch {
					console.error('❌ Invalid account ID format');
					process.exit(1);
				}
			}

			functionName = 'transferFungible';
			params = [tokenAddress, recipientAddress, amount];
			tokenType = tokenId.toString();

			console.log('\nWithdrawal:');
			console.log(`  Token: ${tokenType}`);
			console.log(`  Amount: ${amount.toString()} units`);
			console.log(`  To: ${recipientInput}\n`);
		}
		else {
			console.error('❌ Invalid choice');
			process.exit(1);
		}

		// Confirm
		console.log('⚠️  Ensure this will not affect prize fulfillment!');
		const confirmAnswer = await prompt('Proceed with withdrawal? (yes/no): ');
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Withdrawing tokens...');

		const executionResult = await executeContractFunction({
			contractId: contractId,
			iface: lazyLottoIface,
			client: client,
			functionName: functionName,
			params: params,
			gas: 200000,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log('\n✅ Tokens withdrawn successfully!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);

	}
	catch (error) {
		console.error('\n❌ Error withdrawing tokens:', error.message);
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
withdrawTokens();
