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
			console.log(`Prize Package #${i}:`);

			// FT components
			if (prizes[i].ftComponents && prizes[i].ftComponents.length > 0) {
				console.log('  Fungible Tokens:');
				for (const ft of prizes[i].ftComponents) {
					const tokenId = await convertToHederaId(ft.tokenAddress);
					console.log(`    - ${ethers.formatUnits(ft.amount, ft.decimals)} ${tokenId}`);
				}
			}

			// NFT components
			if (prizes[i].nftComponents && prizes[i].nftComponents.length > 0) {
				console.log('  NFTs:');
				for (const nft of prizes[i].nftComponents) {
					const tokenId = await convertToHederaId(nft.tokenAddress);
					console.log(`    - ${nft.serials.length} serials from ${tokenId}`);
				}
			}
		}

		// Estimate gas
		console.log('\n⛽ Estimating gas...');
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'removePrizes', [poolId], 500000);
		const gasEstimate = gasInfo.gasLimit;
		console.log(`   Estimated: ~${gasEstimate} gas\n`);

		// Confirm
		console.log('⚠️  This will remove ALL prizes from the pool and return them to your account.');
		const confirmAnswer = await prompt(`Remove ${prizes.length} prize packages from pool #${poolId}? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Removing prizes...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const executionResult = await executeContractFunction({
			contractId: contractId,
			iface: lazyLottoIface,
			client: client,
			functionName: 'removePrizes',
			params: [poolId],
			gas: gasLimit,
			payableAmount: 0,
		});

		if (!executionResult.success) {
			throw new Error(executionResult.error || 'Transaction execution failed');
		}

		const { receipt, record } = executionResult;

		console.log('\n✅ Prizes removed successfully!');
		const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
		console.log(`📋 Transaction: ${txId}\n`);
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
