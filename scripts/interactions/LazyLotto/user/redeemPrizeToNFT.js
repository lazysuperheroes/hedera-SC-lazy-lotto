/**
 * LazyLotto Redeem Prize to NFT Script
 *
 * Convert pending prizes (memory format) to NFT format.
 * NFTs can be held, transferred, or claimed later.
 *
 * Usage: node scripts/interactions/LazyLotto/user/redeemPrizeToNFT.js [index1,index2,...]
 */

require('dotenv').config();
const {
	TokenId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { associateTokensToAccount } = require('../../../../utils/hederaHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

// Helper: Convert EVM address to Hedera ID
async function convertToHederaId(evmAddress) {
	if (evmAddress === '0x0000000000000000000000000000000000000000') {
		return 'HBAR';
	}

	const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');
	const hederaId = await homebrewPopulateAccountNum(env, evmAddress);
	return hederaId ? hederaId.toString() : evmAddress;
}

async function redeemPrizeToNFT() {
	let client;

	try {
		// Get indices parameter
		let indicesStr = process.argv[2];

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Redeem Prizes to NFT Format             ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`👤 User: ${operatorId.toString()}\n`);

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Import helpers
		const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
		const { estimateGas } = require('../../../../utils/gasHelpers');
		const { getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');

		// Get pending prizes
		console.log('🔍 Fetching pending prizes...\n');

		// Get pending prizes count first
		const userAddress = `0x${operatorId.toSolidityAddress()}`;
		const countResult = await queryContract(env, contractId, lazyLottoIface, 'getPendingPrizesCount', [userAddress], operatorId);
		const prizeCount = countResult[0];

		if (Number(prizeCount) === 0) {
			console.log('⚠️  No pending prizes found\n');
			process.exit(0);
		}

		// Get all pending prizes
		const pendingPrizesResult = await queryContract(env, contractId, lazyLottoIface, 'getPendingPrizesPage', [userAddress, 0, Number(prizeCount)], operatorId);
		const pendingPrizes = pendingPrizesResult[0];

		if (!pendingPrizes || pendingPrizes.length === 0) {
			console.log('⚠️  No pending prizes found\n');
			process.exit(0);
		}

		// Display prizes
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  PENDING PRIZES');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Total: ${pendingPrizes.length} prize(s)\n`);

		for (let i = 0; i < pendingPrizes.length; i++) {
			const pendingPrize = pendingPrizes[i];
			const poolId = pendingPrize.poolId;
			const prize = pendingPrize.prize;

			console.log(`  Prize #${i}:`);
			console.log(`    Pool:     #${poolId}`);
			console.log(`    As NFT:   ${pendingPrize.asNFT ? 'Yes' : 'No'}`);

			const prizeItems = [];
			if (prize.amount > 0) {
				const tokenId = prize.token === '0x0000000000000000000000000000000000000000'
					? 'HBAR'
					: await convertToHederaId(prize.token);

				let formattedAmount;
				if (tokenId === 'HBAR') {
					formattedAmount = new Hbar(Number(prize.amount), HbarUnit.Tinybar).toString();
				}
				else {
					const tokenDets = await getTokenDetails(env, tokenId);
					formattedAmount = `${Number(prize.amount) / (10 ** tokenDets.decimals)} ${tokenDets.symbol}`;
				}
				prizeItems.push(formattedAmount);
			}
			if (prize.nftTokens.length > 0) {
				const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
				if (nftTokens.length > 0) {
					const totalSerials = prize.nftSerials.reduce((sum, arr) => sum + arr.length, 0);
					prizeItems.push(`${totalSerials} NFT${totalSerials !== 1 ? 's' : ''}`);
				}
			}

			console.log(`    Contents: ${prizeItems.join(' + ')}`);

			// Show NFT details
			if (prize.nftTokens.length > 0) {
				for (let j = 0; j < prize.nftTokens.length; j++) {
					const nftAddr = prize.nftTokens[j];
					if (nftAddr === '0x0000000000000000000000000000000000000000') continue;

					const nftTokenId = await convertToHederaId(nftAddr);
					const serials = prize.nftSerials[j].map(s => Number(s));
					const serialsStr = serials.join(', ');

					try {
						const nftDets = await getTokenDetails(env, nftTokenId);
						console.log(`              → ${nftDets.symbol}: serials [${serialsStr}]`);
					}
					catch {
						console.log(`              → ${nftTokenId}: serials [${serialsStr}]`);
					}
				}
			}
			console.log();
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Get indices if not provided
		if (!indicesStr) {
			indicesStr = await prompt('Enter prize indices to convert to NFT (comma-separated, e.g., 0,1,2): ');
		}

		// Parse indices
		const indices = indicesStr.split(',').map(s => {
			const idx = parseInt(s.trim());
			if (isNaN(idx) || idx < 0 || idx >= pendingPrizes.length) {
				throw new Error(`Invalid index: ${s.trim()}`);
			}
			return idx;
		});

		if (indices.length === 0) {
			console.error('❌ No valid indices provided');
			process.exit(1);
		}

		// Get unique pool IDs from selected prizes
		const poolIds = [...new Set(indices.map(i => Number(pendingPrizes[i].poolId)))];

		// Check association for each pool's token
		console.log('🔍 Checking pool token associations...\n');
		const { checkMirrorBalance } = require('../../../../utils/hederaMirrorHelpers');

		for (const poolId of poolIds) {
			const poolInfoResult = await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);
			const poolTokenIdEvm = poolInfoResult[6];

			const poolTokenHederaId = await convertToHederaId(poolTokenIdEvm);
			const userBalance = await checkMirrorBalance(env, operatorId, poolTokenHederaId);

			if (userBalance === null) {
				console.log(`🔗 Associating pool #${poolId} token (${poolTokenHederaId})...`);
				const result = await associateTokensToAccount(
					client,
					operatorId,
					operatorKey,
					[TokenId.fromString(poolTokenHederaId)],
				);

				if (result !== 'SUCCESS') {
					console.error(`❌ Failed to associate pool #${poolId} token`);
					process.exit(1);
				}
				console.log(`✅ Pool #${poolId} token associated`);
				console.log('⏳ Waiting 5 seconds for mirror node to sync...');
				await new Promise(resolve => setTimeout(resolve, 5000));
			}
			else {
				console.log(`✅ Pool #${poolId} token already associated (${poolTokenHederaId})`);
			}
		}
		console.log('');

		console.log(`Converting ${indices.length} prize(s) to NFT format...\n`);

		// Estimate gas
		const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'redeemPrizeToNFT', [indices], 800000);
		const gasEstimate = gasInfo.gasLimit;

		// Confirm
		const confirmAnswer = await prompt(`Redeem ${indices.length} prize(s) to NFT format? (yes/no): `);
		if (confirmAnswer.toLowerCase() !== 'yes' && confirmAnswer.toLowerCase() !== 'y') {
			console.log('\n❌ Operation cancelled');
			process.exit(0);
		}

		// Execute
		console.log('\n🔄 Redeeming prizes to NFT...');

		const gasLimit = Math.floor(gasEstimate * 1.2);

		const [receipt, , record] = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasLimit,
			'redeemPrizeToNFT',
			[indices],
		);

		if (receipt.status.toString() !== 'SUCCESS') {
			console.error('\n❌ Transaction failed');
			process.exit(1);
		}

		console.log('\n✅ Prizes redeemed to NFT format!');
		console.log(`📋 Transaction: ${record.transactionId.toString()}\n`);

		console.log('🎨 Prize NFTs minted and added to your pending prizes.');
		console.log('   Use claimFromPrizeNFT.js to claim them later.\n');

	}
	catch (error) {
		console.error('\n❌ Error redeeming prizes:', error.message);
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
redeemPrizeToNFT();
