/**
 * LazyLotto Remove Prizes Script
 *
 * Remove prizes from CLOSED pools and return them to caller.
 * Requires ADMIN role. Pool must be closed.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/removePrizes.js [poolId]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/removePrizes.js [poolId] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/removePrizes.js --multisig-help
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
const { ethers } = require('ethers');
const {
	AccountAllowanceApproveTransaction,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

// Helper: Convert EVM address to Hedera ID
async function convertToHederaId(evmAddress) {
	if (evmAddress === '0x0000000000000000000000000000000000000000') {
		return 'HBAR';
	}

	const hederaId = await homebrewPopulateAccountNum(env, evmAddress);
	return hederaId ? hederaId.toString() : evmAddress;
}

async function removePrizes() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		let poolIdStr = process.argv[2];

		// Filter out flag arguments
		if (poolIdStr && poolIdStr.startsWith('--')) {
			poolIdStr = null;
		}

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID to remove prizes from: ');
		}

		const poolId = parseInt(poolIdStr);
		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║           LazyLotto Remove Prizes (Admin)                 ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Check pool status
		console.log('🔍 Checking pool status...');

		const poolBasicInfo = await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);
		// eslint-disable-next-line no-unused-vars
		const [ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenId, paused, closed, feeToken] = poolBasicInfo;

		if (!closed) {
			console.error('\n❌ Pool is not closed. Must close pool first.');
			process.exit(1);
		}

		console.log(`Total prizes in pool: ${Number(prizeCount)}`);

		// Get prize packages from pool
		if (Number(prizeCount) === 0) {
			console.log('\n⚠️  No prizes to remove');
			process.exit(0);
		}

		console.log('\n🔍 Fetching prize details...');
		const totalPrizes = Number(prizeCount);
		const prizes = [];
		for (let i = 0; i < totalPrizes; i++) {
			const prizeResult = await queryContract(env, contractId, lazyLottoIface, 'getPrizePackage', [poolId, i], operatorId);
			const prize = prizeResult[0];
			prizes.push(prize);
		}

		console.log(`\nPrizes to remove: ${prizes.length} packages\n`);

		// Display prizes
		for (let i = 0; i < prizes.length; i++) {
			const prize = prizes[i];
			const parts = [];

			// Fungible component (HBAR or HTS token)
			if (BigInt(prize.amount) > 0n) {
				const tokenId = await convertToHederaId(prize.token);
				if (tokenId === 'HBAR') {
					parts.push(`${ethers.formatUnits(prize.amount, 8)} HBAR`);
				}
				else {
					parts.push(`${prize.amount.toString()} raw ${tokenId}`);
				}
			}

			// NFT components
			if (prize.nftTokens && prize.nftTokens.length > 0) {
				for (let k = 0; k < prize.nftTokens.length; k++) {
					if (prize.nftTokens[k] === '0x0000000000000000000000000000000000000000') continue;
					const tokenId = await convertToHederaId(prize.nftTokens[k]);
					const serials = prize.nftSerials[k].map(s => Number(s));
					parts.push(`${serials.length} NFT(s) from ${tokenId} [${serials.join(',')}]`);
				}
			}

			console.log(`  #${i}: ${parts.length > 0 ? parts.join(' + ') : '(empty)'}`);
		}

		// Calculate gas per prize based on NFT count
		// Base gas for contract logic + per-NFT gas for HTS transfers
		const BASE_GAS = 300_000;
		const GAS_PER_NFT = 80_000;
		const MAX_RETRIES = 3;

		let maxNFTs = 0;
		for (const prize of prizes) {
			let nftCount = 0;
			if (prize.nftTokens) {
				for (let k = 0; k < prize.nftTokens.length; k++) {
					if (prize.nftTokens[k] !== '0x0000000000000000000000000000000000000000') {
						nftCount += prize.nftSerials[k].length;
					}
				}
			}
			if (nftCount > maxNFTs) maxNFTs = nftCount;
		}

		const gasLimit = Math.max(600_000, BASE_GAS + GAS_PER_NFT * maxNFTs);
		console.log(`\n⛽ Gas limit: ${gasLimit.toLocaleString()} (max ${maxNFTs} NFTs in a single prize)\n`);

		// Confirm
		console.log('⚠️  This will remove ALL prizes from the pool and return them to your account.');
		console.log(`   ${prizes.length} transactions will be sent (one per prize).\n`);
		const confirmAnswer = await prompt(`Remove ${prizes.length} prize packages from pool #${poolId}? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Ensure HBAR allowance to storage for NFT royalty dust transfers
		const hasNFTs = maxNFTs > 0;

		if (hasNFTs) {
			const storageId = getContractId('LAZY_LOTTO_STORAGE');
			console.log(`🔑 Approving HBAR allowance to storage (${storageId}) for NFT royalty dust...`);
			const allowanceTx = await new AccountAllowanceApproveTransaction()
				.approveHbarAllowance(operatorId, storageId, Hbar.from(1, HbarUnit.Hbar))
				.execute(client);
			const allowanceReceipt = await allowanceTx.getReceipt(client);
			if (allowanceReceipt.status.toString() !== 'SUCCESS') {
				throw new Error(`HBAR allowance failed: ${allowanceReceipt.status}`);
			}
			console.log('✅ HBAR allowance set\n');
		}

		// Execute — remove prizes one at a time, always index 0 (swap-and-pop)
		console.log('🔄 Removing prizes...\n');

		let removed = 0;
		const total = prizes.length;

		for (let i = 0; i < total; i++) {
			let attempt = 0;
			let success = false;

			while (attempt < MAX_RETRIES && !success) {
				attempt++;
				const retryLabel = attempt > 1 ? ` (retry ${attempt}/${MAX_RETRIES})` : '';
				process.stdout.write(`   Removing prize ${i + 1}/${total}${retryLabel}...`);

				const executionResult = await executeContractFunction({
					contractId: contractId,
					iface: lazyLottoIface,
					client: client,
					functionName: 'removePrizes',
					params: [poolId, 0],
					gas: gasLimit,
					payableAmount: 0,
				});

				if (executionResult.success) {
					success = true;
					removed++;
					console.log(' ✅');
				}
				else {
					const errMsg = executionResult.error || '';
					// HederaResponseCodes.UNKNOWN (21) — transient network error, safe to retry
					const isTransient = errMsg.includes('UNKNOWN ERROR') && !errMsg.includes('INSUFFICIENT_GAS');

					if (isTransient && attempt < MAX_RETRIES) {
						console.log(` ⚠️  transient error, retrying in 3s...`);
						await new Promise(r => setTimeout(r, 3000));
					}
					else {
						console.log(' ❌');
						console.error(`\n⚠️  Failed at prize ${i + 1}: ${errMsg}`);
						console.log(`   ${removed} of ${total} prizes removed before failure.\n`);
						throw new Error(errMsg || 'Transaction execution failed');
					}
				}
			}
		}

		console.log(`\n✅ All ${removed} prizes removed successfully!`);
		console.log('💰 Prizes returned to your account\n');

	}
	catch (error) {
		console.error('\n❌ Error removing prizes:', error.message);
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
removePrizes();
