/**
 * LazyLotto User State Query
 *
 * Retrieves complete user state including:
 * - Memory entries across all pools
 * - NFT tickets owned
 * - Pending prizes
 * - Current win rate boost
 *
 * Usage: node scripts/interactions/LazyLotto/queries/userState.js [userAddress]
 */

require('dotenv').config();
const {
	AccountId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { prompt } = require('../../../../utils/promptHelpers');

const { getTokenDetails, getSerialsOwned, homebrewPopulateAccountEvmAddress } = require('../../../../utils/hederaMirrorHelpers');
const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const poolManagerId = process.env.LAZY_LOTTO_POOL_MANAGER_ID ? getContractId('LAZY_LOTTO_POOL_MANAGER_ID') : null;

async function convertToHederaId(evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	// Use null to try all entity types (accounts, tokens, contracts)
	return await homebrewPopulateAccountNum(env, evmAddress, entityType);
}

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (Number(thousandthsOfBps) / 1_000_000).toFixed(4) + '%';
}


async function getUserState() {
	let client;

	try {
		// Get user address
		let userAddress = process.argv[2];

		if (!userAddress) {
			userAddress = await prompt('Enter user address (0.0.xxxxx or 0x...): ');
		}

		if (!userAddress) {
			console.error('❌ User address required');
			process.exit(1);
		}

		let userEvmAddress;
		let userHederaId;
		// Convert to EVM format
		if (!userAddress.startsWith('0x')) {
			userHederaId = AccountId.fromString(userAddress).toString();
			userEvmAddress = await homebrewPopulateAccountEvmAddress(env, userHederaId, EntityType.ACCOUNT);
		}
		else {
			userEvmAddress = userAddress;
			userHederaId = await homebrewPopulateAccountNum(env, userEvmAddress, EntityType.ACCOUNT);
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║           LazyLotto User State Query                      ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`👤 User: ${userHederaId}\n`);

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		console.log('🔍 Fetching user data...\n');

		// Get user's boost
		const boostBps = await queryContract(env, contractId, lazyLottoIface, 'calculateBoost', [userEvmAddress], operatorId);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  WIN RATE BOOST');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Current Boost: +${formatWinRate(Number(boostBps[0]))}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Get total pools
		const totalPools = await queryContract(env, contractId, lazyLottoIface, 'totalPools', [], operatorId);

		// Get user entries for each pool
		const userEntries = [];
		for (let i = 0; i < Number(totalPools[0]); i++) {
			const entries = await queryContract(env, contractId, lazyLottoIface, 'getUsersEntries', [i, userEvmAddress], operatorId);

			if (Number(entries[0]) > 0) {
				// Get pool details
				const poolBasicInfo = await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [i], operatorId);
				const [, , winRate, entryFee, , , poolTokenId, , , feeToken] = poolBasicInfo;
				userEntries.push({
					poolId: i,
					entryCount: Number(entries[0]),
					winRate: Number(winRate),
					entryFee: Number(entryFee),
					feeToken: feeToken === '0x0000000000000000000000000000000000000000'
						? 'HBAR'
						: await homebrewPopulateAccountNum(env, feeToken, EntityType.TOKEN),
					poolTokenId: await homebrewPopulateAccountNum(env, poolTokenId, EntityType.TOKEN),
				});
			}
		}

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  MEMORY ENTRIES (Unrolled Tickets)');
		console.log('═══════════════════════════════════════════════════════════');

		if (userEntries.length === 0) {
			console.log('  No memory entries found\n');
		}
		else {
			for (const entry of userEntries) {
				console.log(`  Pool #${entry.poolId}:`);
				console.log(`    Tickets:    ${entry.entryCount}`);
				console.log(`    Win Rate:   ${formatWinRate(entry.winRate)} (base)`);
				console.log(`    Boosted:    ${formatWinRate(Number(entry.winRate) + Number(boostBps[0]))}`);

				// Format entry fee with proper decimals
				let formattedFee;
				if (entry.feeToken === 'HBAR') {
					formattedFee = new Hbar(Number(entry.entryFee), HbarUnit.Tinybar).toString();
				}
				else {
					const tokenDetsResult = await getTokenDetails(env, entry.feeToken);
					formattedFee = `${Number(entry.entryFee) / (10 ** tokenDetsResult.decimals)} ${tokenDetsResult.symbol}`;
				}
				console.log(`    Entry Fee:  ${formattedFee}`);
				console.log();
			}
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Check for pool NFTs (both tickets and prizes)
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL NFTs (Tickets & Prize NFTs)');
		console.log('═══════════════════════════════════════════════════════════');

		let hasPoolNFTs = false;

		for (let i = 0; i < Number(totalPools[0]); i++) {
			// Get pool details to find pool token
			const poolBasicInfo = await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [i], operatorId);
			const [, , , , , , poolTokenIdEvm] = poolBasicInfo;
			const poolTokenId = await convertToHederaId(poolTokenIdEvm, EntityType.TOKEN);

			// Check if user owns any NFTs from this pool
			const ownedSerials = await getSerialsOwned(env, userHederaId, poolTokenId);

			if (ownedSerials && ownedSerials.length > 0) {
				hasPoolNFTs = true;

				// Get token details
				let tokenSymbol = poolTokenId;
				try {
					const tokenDetails = await getTokenDetails(env, poolTokenId);
					tokenSymbol = tokenDetails.symbol || poolTokenId;
				}
				catch {
					// Use tokenId as fallback
				}

				console.log(`\n  Pool #${i} - ${tokenSymbol} (${poolTokenId}):`);

				// Check each serial to see if it's a prize NFT or ticket NFT
				const ticketSerials = [];
				const prizeData = [];
				// Store {serial, pendingPrize} for prizes

				for (const serial of ownedSerials) {
					// Query if this NFT is a prize
					const pendingPrize = (await queryContract(env, contractId, lazyLottoIface, 'getPendingPrizesByNFT', [poolTokenIdEvm, serial], operatorId))[0];

					if (pendingPrize.asNFT) {
						prizeData.push({ serial, pendingPrize });
					}
					else {
						ticketSerials.push(serial);
					}
				}

				if (ticketSerials.length > 0) {
					console.log(`    🎫 Ticket NFTs: ${ticketSerials.length} (serials: ${ticketSerials.join(', ')})`);
				}

				if (prizeData.length > 0) {
					console.log(`    🎁 Prize NFTs:  ${prizeData.length}`);

					// Display each prize's details
					for (const { serial, pendingPrize } of prizeData) {
						const prize = pendingPrize.prize;
						const prizeItems = [];

						// FT/HBAR amount
						if (prize.amount > 0) {
							const tokenId = prize.token === '0x0000000000000000000000000000000000000000'
								? 'HBAR'
								: await convertToHederaId(prize.token, EntityType.TOKEN);

							let formattedAmount;
							if (tokenId === 'HBAR') {
								formattedAmount = new Hbar(Number(prize.amount), HbarUnit.Tinybar).toString();
							}
							else {
								const tokenDetsResult = await getTokenDetails(env, tokenId);
								formattedAmount = `${Number(prize.amount) / (10 ** tokenDetsResult.decimals)} ${tokenDetsResult.symbol}`;
							}
							prizeItems.push(formattedAmount);
						}

						// NFTs
						if (prize.nftTokens.length > 0) {
							const nftTokens = prize.nftTokens.filter(t => t !== '0x0000000000000000000000000000000000000000');
							if (nftTokens.length > 0) {
								const totalSerials = prize.nftSerials.reduce((sum, arr) => sum + arr.length, 0);
								prizeItems.push(`${totalSerials} NFT${totalSerials !== 1 ? 's' : ''}`);
							}
						}

						console.log(`       Serial #${serial}: ${prizeItems.join(' + ')}`);

						// Show NFT details if present
						if (prize.nftTokens.length > 0) {
							for (let j = 0; j < prize.nftTokens.length; j++) {
								const nftAddr = prize.nftTokens[j];
								if (nftAddr === '0x0000000000000000000000000000000000000000') continue;

								const nftTokenId = await convertToHederaId(nftAddr, EntityType.TOKEN);
								const serials = prize.nftSerials[j].map(s => Number(s));
								const serialsStr = serials.join(', ');

								try {
									const nftDets = await getTokenDetails(env, nftTokenId);
									console.log(`         → ${nftDets.symbol}: serials [${serialsStr}]`);
								}
								catch {
									console.log(`         → ${nftTokenId}: serials [${serialsStr}]`);
								}
							}
						}
					}
				}
			}
		}

		if (!hasPoolNFTs) {
			console.log('  No pool NFTs found\n');
		}
		else {
			console.log('');
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Get pending prizes count first
		const prizeCount = Number((await queryContract(env, contractId, lazyLottoIface, 'getPendingPrizesCount', [userEvmAddress], operatorId))[0]);

		// Fetch pending prizes in small chunks — each PendingPrize can contain nested NFT
		// arrays, so loading dozens in one call blows the mirror-node gas budget.
		const PRIZE_PAGE_SIZE = 5;
		const PRIZE_PAGE_GAS = 2_000_000;
		const collectedPrizes = [];
		for (let offset = 0; offset < prizeCount; offset += PRIZE_PAGE_SIZE) {
			const count = Math.min(PRIZE_PAGE_SIZE, prizeCount - offset);
			const page = await queryContract(
				env,
				contractId,
				lazyLottoIface,
				'getPendingPrizesPage',
				[userEvmAddress, offset, count],
				operatorId,
				{ gas: PRIZE_PAGE_GAS },
			);
			for (const p of page[0]) {
				collectedPrizes.push(p);
			}
		}
		const pendingPrizes = [collectedPrizes];

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  PENDING PRIZES');
		console.log('═══════════════════════════════════════════════════════════');

		if (pendingPrizes[0].length === 0) {
			console.log('  No pending prizes\n');
		}
		else {
			console.log(`  Total: ${pendingPrizes[0].length} prize(s)\n`);

			for (let i = 0; i < pendingPrizes[0].length; i++) {
				const pendingPrize = pendingPrizes[0][i];
				const poolId = pendingPrize.poolId;
				const prize = pendingPrize.prize;

				console.log(`  Prize #${i}:`);
				console.log(`    Pool:     #${poolId}`);
				console.log(`    As NFT:   ${pendingPrize.asNFT ? 'Yes' : 'No'}`);

				const prizeItems = [];
				if (prize.amount > 0) {
					const tokenId = prize.token === '0x0000000000000000000000000000000000000000'
						? 'HBAR'
						: await convertToHederaId(prize.token, EntityType.TOKEN);

					let formattedAmount;
					if (tokenId === 'HBAR') {
						formattedAmount = new Hbar(Number(prize.amount), HbarUnit.Tinybar).toString();
					}
					else {
						const tokenDetsResult = await getTokenDetails(env, tokenId);
						formattedAmount = `${Number(prize.amount) / (10 ** tokenDetsResult.decimals)} ${tokenDetsResult.symbol}`;
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

						const nftTokenId = await convertToHederaId(nftAddr, EntityType.TOKEN);
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
		}

		console.log('═══════════════════════════════════════════════════════════\n');

		// Owned Pools
		if (poolManagerId) {
			try {
				const poolManagerIface = loadInterface('LazyLottoPoolManager');

				// Get user's pools
				const userPools = await queryContract(env, poolManagerId, poolManagerIface, 'getUserPools', [userEvmAddress], operatorId);
				const ownedPoolIds = userPools[0].map(id => Number(id));

				if (ownedPoolIds.length > 0) {
					console.log('═══════════════════════════════════════════════════════════');
					console.log('  OWNED POOLS');
					console.log('═══════════════════════════════════════════════════════════');
					console.log(`  Total Owned: ${ownedPoolIds.length}\n`);

					let totalWithdrawable = 0n;

					for (const ownedPoolId of ownedPoolIds) {
						// Get pool basic info to get feeToken
						const ownedPoolInfo = await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [ownedPoolId], operatorId);
						const ownedPoolFeeToken = ownedPoolInfo[9];

						// Get pool proceeds (pass feeToken from getPoolBasicInfo result index [9])
						const proceeds = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolProceeds', [ownedPoolId, ownedPoolFeeToken], operatorId);

						// Get platform fee %
						const feePercent = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolPlatformFeePercentage', [ownedPoolId], operatorId);

						const totalProceeds = proceeds[0];
						const withdrawn = proceeds[1];
						const available = totalProceeds - withdrawn;
						const ownerShare = (Number(available) * (100 - Number(feePercent[0]))) / 100;

						totalWithdrawable += BigInt(ownerShare);

						console.log(`  Pool #${ownedPoolId}:`);
						console.log(`    - Available:      ${new Hbar(available, HbarUnit.Tinybar).toString()}`);
						console.log(`    - Your Share:     ${new Hbar(ownerShare, HbarUnit.Tinybar).toString()} (${100 - Number(feePercent[0])}%)`);
					}

					console.log();
					console.log(`  Total Withdrawable:     ${new Hbar(totalWithdrawable, HbarUnit.Tinybar).toString()}`);
					console.log('═══════════════════════════════════════════════════════════\n');

					if (totalWithdrawable > 0n) {
						console.log('💡 Use: node scripts/interactions/LazyLotto/user/withdrawPoolProceeds.js\n');
					}
				}
			}
			catch (error) {
				// Pool manager info unavailable or user has no pools
				console.log('═══════════════════════════════════════════════════════════');
				console.log('  OWNED POOLS');
				console.log('═══════════════════════════════════════════════════════════');
				console.log('  No owned pools found or unable to fetch owned pools.\n');
				console.log('═══════════════════════════════════════════════════════════\n');
				console.error('⚠️  Warning: Unable to fetch owned pools:', error.message, '\n');
			}
		}

		// Summary
		const totalMemoryEntries = userEntries.reduce((sum, e) => sum + e.entryCount, 0);
		const totalPendingPrizes = pendingPrizes[0].length;

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  SUMMARY');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pools with entries:     ${userEntries.length}`);
		console.log(`  Total memory entries:   ${totalMemoryEntries}`);
		console.log(`  Pending prizes:         ${totalPendingPrizes}`);
		console.log(`  Current boost:          +${formatWinRate(Number(boostBps[0]))}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('✅ User state query complete!\n');

	}
	catch (error) {
		console.error('\n❌ Error fetching user state:', error.message);
		if (error.response) {
			console.error('HTTP status:', error.response.status);
			if (error.response.data) {
				console.error('Response body:', JSON.stringify(error.response.data, null, 2));
			}
		}
		else if (error.status) {
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
getUserState();
