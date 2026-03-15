/**
 * LazyLotto Claim Prize from NFT Script
 *
 * Claim prizes that have been converted to NFT format.
 * The NFT will be wiped and prizes will be transferred.
 *
 * Usage: node scripts/interactions/LazyLotto/user/claimFromPrizeNFT.js [serial1,serial2,...]
 */

require('dotenv').config();
const {
	TokenId,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { associateTokensToAccount, setHbarAllowance } = require('../../../../utils/hederaHelpers');
const { homebrewPopulateAccountNum, checkHbarAllowances, checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');
const { sleep } = require('@directus/sdk');

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

async function claimFromPrizeNFT() {
	let client;

	try {
		// Get serials parameter
		let serialsStr = process.argv[2];

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║           LazyLotto Claim from Prize NFTs                 ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`👤 User: ${operatorId.toString()}\n`);

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Import helpers
		const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');
		const { getSerialsOwned } = require('../../../../utils/hederaMirrorHelpers');

		// Get pool token address from user (prize NFTs are pool-specific)
		console.log('🔍 Prize NFTs are pool-specific. You need to specify which pool token.\n');

		const poolTokenInput = await prompt('Enter pool token ID (0.0.xxxxx): ');

		// Convert to EVM address
		function convertToEvmAddress(hederaId) {
			if (hederaId.startsWith('0x')) return hederaId;
			const parts = hederaId.split('.');
			const num = parts[parts.length - 1];
			return '0x' + BigInt(num).toString(16).padStart(40, '0');
		}

		const prizeNFTAddress = convertToEvmAddress(poolTokenInput);
		const prizeNFTId = poolTokenInput;
		console.log(`Prize NFT Collection: ${prizeNFTId}\n`);

		// Get user's prize NFTs
		const ownedSerials = await getSerialsOwned(env, operatorId.toString(), prizeNFTId);

		if (!ownedSerials || ownedSerials.length === 0) {
			console.log('⚠️  No prize NFTs found in your account');
			process.exit(0);
		}

		console.log(`Found ${ownedSerials.length} prize NFT(s): ${ownedSerials.join(', ')}\n`);

		// Get serials if not provided
		if (!serialsStr) {
			serialsStr = await prompt('Enter NFT serials to claim (comma-separated): ');
		}

		// Parse serials
		const serials = serialsStr.split(',').map(s => {
			const serial = parseInt(s.trim());
			if (isNaN(serial) || serial <= 0) {
				throw new Error(`Invalid serial: ${s.trim()}`);
			}

			if (!ownedSerials.includes(serial)) {
				throw new Error(`You don't own serial #${serial}`);
			}

			return serial;
		});

		if (serials.length === 0) {
			console.error('❌ No valid serials provided');
			process.exit(1);
		}

		console.log(`\nClaiming ${serials.length} prize NFT(s)...\n`);

		// Check each NFT to verify it's a prize and get details
		console.log('🔍 Verifying prize NFTs and checking tokens...');

		const tokensToAssociate = new Set();
		let hasNFTs = false;

		let totalNFTs = 0;

		for (const serial of serials) {
			// Query the prize data for this NFT
			const pendingPrizeResult = await queryContract(env, contractId, lazyLottoIface, 'getPendingPrizesByNFT', [prizeNFTAddress, serial], operatorId);
			const pendingPrize = pendingPrizeResult[0];

			if (!pendingPrize.asNFT) {
				console.error(`\n❌ Serial #${serial} is not a prize NFT (it may be a ticket)`);
				process.exit(1);
			}

			const prize = pendingPrize.prize;

			// Check FT token
			if (prize.amount > 0 && prize.token !== '0x0000000000000000000000000000000000000000') {
				const ftTokenId = await convertToHederaId(prize.token);
				const ftBalance = await checkMirrorBalance(env, operatorId, ftTokenId);
				if (ftBalance === null) {
					tokensToAssociate.add(ftTokenId);
				}
			}

			// Check NFT tokens
			const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
			if (nftTokens.length > 0) {
				hasNFTs = true;
				totalNFTs += nftTokens.length;
				for (const nftToken of nftTokens) {
					const nftTokenId = await convertToHederaId(nftToken);
					const nftBalance = await checkMirrorBalance(env, operatorId, nftTokenId);
					if (nftBalance === null) {
						tokensToAssociate.add(nftTokenId);
					}
				}
			}
		}

		// Associate tokens if needed
		if (tokensToAssociate.size > 0) {
			console.log(`\n🔗 Associating ${tokensToAssociate.size} token(s)...`);
			const tokenIds = Array.from(tokensToAssociate).map(id => TokenId.fromString(id));
			const result = await associateTokensToAccount(
				client,
				operatorId,
				operatorKey,
				tokenIds,
			);

			if (result !== 'SUCCESS') {
				console.error('❌ Failed to associate tokens');
				process.exit(1);
			}
			console.log('✅ Tokens associated successfully');
			console.log('⏳ Waiting 5 seconds for mirror node to sync...');
			await new Promise(resolve => setTimeout(resolve, 5000));
		}
		else {
			console.log('✅ All required tokens already associated');
		}

		// Check HBAR allowance if any prize contains NFTs
		if (hasNFTs) {
			console.log('\n🔍 Checking HBAR allowance for NFT transfers...');
			const hbarAllowances = await checkHbarAllowances(env, operatorId);
			let hbarAllowance;
			const requiredHbar = totalNFTs * serials.length;

			// need to check if there is an hbar allowance for the storage contract
			for (const allowance of hbarAllowances) {
				if (allowance.spender === storageContractId.toString()) {
					hbarAllowance = allowance.amount;
					break;
				}
			}

			if (!hbarAllowance || hbarAllowance < requiredHbar) {
				console.log('🔗 Setting HBAR allowance (1 HBAR) to storage contract...');
				const result = await setHbarAllowance(
					client,
					operatorId,
					storageContractId,
					1,
					HbarUnit.Hbar,
				);

				if (result !== 'SUCCESS') {
					console.error('❌ Failed to set HBAR allowance');
					process.exit(1);
				}
				console.log('✅ HBAR allowance set successfully');
				console.log('⏳ Waiting 5 seconds for mirror node to sync...');
				await sleep(5000);
			}
			else {
				console.log(`✅ HBAR allowance already set (${hbarAllowance} HBAR)`);
			}
		}

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'claimPrizeFromNFT', [prizeNFTAddress, serials], 750_000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm
		console.log('⚠️  Prize NFTs will be wiped (destroyed) after claiming.');
		const confirmAnswer = await prompt(`Claim prizes from ${serials.length} NFT(s)? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Claiming prizes from NFTs...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'claimPrizeFromNFT',
			[prizeNFTAddress, serials],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Prizes claimed successfully!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		console.log('🎁 Prizes have been transferred to your account.');
		console.log('🔥 Prize NFTs have been wiped (destroyed).\n');

	}
	catch (error) {
		console.error('\n❌ Error claiming from prize NFTs:', error.message);
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
claimFromPrizeNFT();
