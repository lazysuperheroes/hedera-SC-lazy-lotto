/**
 * LazyLotto Master Information Query
 *
 * Comprehensive script that retrieves ALL contract state:
 * - All pools with detailed information
 * - All prizes for each pool
 * - Outstanding entries across pools
 * - Contract configuration
 * - Bonus systems
 *
 * Usage: node scripts/interactions/LazyLotto/queries/masterInfo.js
 */

require('dotenv').config();
const {
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { batchMirrorQuery } = require('../../../../utils/solidityHelpers');

const { homebrewPopulateAccountNum, EntityType, getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const storageContractId = getContractId('LAZY_LOTTO_STORAGE');

// Helper: Convert Hedera ID to EVM address

async function convertToHederaId(evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	// Use null to try all entity types (accounts, tokens, contracts)
	return await homebrewPopulateAccountNum(env, evmAddress, entityType);
}

// Helper: Format win rate
function formatWinRate(thousandthsOfBps) {
	return (thousandthsOfBps / 1_000_000).toFixed(4) + '%';
}

async function getMasterInfo() {
	let client;

	try {
		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Master Information Query                ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`👤 Querying as: ${operatorId.toString()}\n`);

		// Test if contract exists first by checking mirror node
		console.log('🔍 Verifying contract exists on mirror node...');
		const baseUrl = require('../../../../utils/hederaMirrorHelpers').getBaseURL(env);
		const axios = require('axios');

		try {
			const contractResponse = await axios.get(`${baseUrl}/api/v1/contracts/${contractId.toString()}`);
			if (contractResponse.data && contractResponse.data.contract_id) {
				console.log('✅ Contract found on mirror node\n');
			}
		}
		catch (error) {
			if (error.response && error.response.status === 404) {
				console.error('❌ Contract not found on mirror node.');
				console.error('   This could mean:');
				console.error('   1. The contract address is incorrect');
				console.error('   2. The contract was recently deployed (wait a few minutes for mirror node to sync)');
				console.error('   3. You are on the wrong network (check ENVIRONMENT in .env)\n');
				console.error(`   Contract ID: ${contractId.toString()}`);
				console.error(`   Environment: ${env.toUpperCase()}\n`);
				console.error('   Try running this script again in a few minutes if the contract was just deployed.\n');
				process.exit(1);
			}
			console.warn('⚠️  Could not verify contract on mirror node, continuing anyway...\n');
		}

		// Load contract ABIs
		const lazyLottoIface = loadInterface('LazyLotto');

		console.log('🔍 Fetching contract configuration...\n');

		// Batch all 7 config queries + poolManager + totalPools in parallel
		const configQueries = [
			{ contractId, encoded: lazyLottoIface.encodeFunctionData('lazyToken'), label: 'lazyToken' },
			{ contractId, encoded: lazyLottoIface.encodeFunctionData('lazyGasStation'), label: 'lazyGasStation' },
			{ contractId, encoded: lazyLottoIface.encodeFunctionData('lazyDelegateRegistry'), label: 'lazyDelegateRegistry' },
			{ contractId, encoded: lazyLottoIface.encodeFunctionData('prng'), label: 'prng' },
			{ contractId, encoded: lazyLottoIface.encodeFunctionData('storageContract'), label: 'storageContract' },
			{ contractId, encoded: lazyLottoIface.encodeFunctionData('burnPercentage'), label: 'burnPercentage' },
			{ contractId, encoded: lazyLottoIface.encodeFunctionData('paused'), label: 'paused' },
			{ contractId, encoded: lazyLottoIface.encodeFunctionData('poolManager'), label: 'poolManager' },
			{ contractId, encoded: lazyLottoIface.encodeFunctionData('totalPools'), label: 'totalPools' },
		];

		const configResults = await batchMirrorQuery(env, configQueries, operatorId, { concurrency: 25 });

		// Check for 404 errors on first query (contract existence check)
		if (configResults[0].error) {
			const error = configResults[0].error;
			if (error.response && error.response.status === 404) {
				console.error('❌ Contract not found on mirror node.');
				console.error('   This could mean:');
				console.error('   1. The contract address is incorrect');
				console.error('   2. The contract was recently deployed and mirror node is still indexing');
				console.error('   3. You are on the wrong network (check ENVIRONMENT in .env)\n');
				console.error(`   Contract ID: ${storageContractId.toString()}`);
				console.error(`   Environment: ${env.toUpperCase()}\n`);
				process.exit(1);
			}
			throw error;
		}

		// Decode all config results
		const lazyToken = await convertToHederaId(
			lazyLottoIface.decodeFunctionResult('lazyToken', configResults[0].result)[0], EntityType.TOKEN);
		const lazyGasStation = await convertToHederaId(
			lazyLottoIface.decodeFunctionResult('lazyGasStation', configResults[1].result)[0], EntityType.CONTRACT);
		const lazyDelegateRegistry = await convertToHederaId(
			lazyLottoIface.decodeFunctionResult('lazyDelegateRegistry', configResults[2].result)[0], EntityType.CONTRACT);
		const prng = await convertToHederaId(
			lazyLottoIface.decodeFunctionResult('prng', configResults[3].result)[0], EntityType.CONTRACT);
		const storage = await convertToHederaId(
			lazyLottoIface.decodeFunctionResult('storageContract', configResults[4].result)[0], EntityType.CONTRACT);
		const burnPercentage = lazyLottoIface.decodeFunctionResult('burnPercentage', configResults[5].result);
		const isPaused = lazyLottoIface.decodeFunctionResult('paused', configResults[6].result);
		const poolManagerAddr = lazyLottoIface.decodeFunctionResult('poolManager', configResults[7].result)[0];
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', configResults[8].result);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  CONTRACT CONFIGURATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  LAZY Token:             ${lazyToken}`);
		console.log(`  LazyGasStation:         ${lazyGasStation}`);
		console.log(`  LazyDelegateRegistry:   ${lazyDelegateRegistry}`);
		console.log(`  PRNG Generator:         ${prng}`);
		console.log(`  Storage Contract:       ${storage}`);
		console.log(`  Burn Percentage:        ${burnPercentage[0]}%`);
		console.log(`  Contract Paused:        ${isPaused[0] ? '🔴 YES' : '🟢 NO'}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Load PoolManager for bonus system queries (poolManagerAddr already fetched in config batch)
		const resolvedPoolManagerId = ContractId.fromString(await convertToHederaId(poolManagerAddr, EntityType.CONTRACT));

		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		// Get bonus system info (lives on PoolManager, not LazyLotto)
		console.log('🎁 Fetching bonus system configuration...\n');

		// Batch the bonus count queries + LAZY balance bonus queries in parallel
		const bonusCountQueries = [
			{ contractId: resolvedPoolManagerId, encoded: poolManagerIface.encodeFunctionData('totalTimeBonuses'), label: 'totalTimeBonuses' },
			{ contractId: resolvedPoolManagerId, encoded: poolManagerIface.encodeFunctionData('totalNFTBonusTokens'), label: 'totalNFTBonusTokens' },
			{ contractId: resolvedPoolManagerId, encoded: poolManagerIface.encodeFunctionData('lazyBalanceThreshold'), label: 'lazyBalanceThreshold' },
			{ contractId: resolvedPoolManagerId, encoded: poolManagerIface.encodeFunctionData('lazyBalanceBonusBps'), label: 'lazyBalanceBonusBps' },
		];

		const bonusCountResults = await batchMirrorQuery(env, bonusCountQueries, operatorId, { concurrency: 25 });

		const totalTimeBonuses = poolManagerIface.decodeFunctionResult('totalTimeBonuses', bonusCountResults[0].result);
		const totalNFTBonuses = poolManagerIface.decodeFunctionResult('totalNFTBonusTokens', bonusCountResults[1].result);
		const lazyThreshold = poolManagerIface.decodeFunctionResult('lazyBalanceThreshold', bonusCountResults[2].result)[0];
		const lazyBps = Number(poolManagerIface.decodeFunctionResult('lazyBalanceBonusBps', bonusCountResults[3].result)[0]);

		// Batch all time bonus and NFT bonus token queries in parallel
		const bonusDetailQueries = [];
		for (let i = 0; i < Number(totalTimeBonuses[0]); i++) {
			bonusDetailQueries.push({
				contractId: resolvedPoolManagerId,
				encoded: poolManagerIface.encodeFunctionData('timeBonuses', [i]),
				label: `timeBonus_${i}`,
			});
		}
		for (let i = 0; i < Number(totalNFTBonuses[0]); i++) {
			bonusDetailQueries.push({
				contractId: resolvedPoolManagerId,
				encoded: poolManagerIface.encodeFunctionData('nftBonusTokens', [i]),
				label: `nftBonusToken_${i}`,
			});
		}

		const bonusDetailResults = bonusDetailQueries.length > 0
			? await batchMirrorQuery(env, bonusDetailQueries, operatorId, { concurrency: 25 })
			: [];

		// Parse time bonus results
		const timeBonusCount = Number(totalTimeBonuses[0]);
		const timeBonusData = [];
		for (let i = 0; i < timeBonusCount; i++) {
			const timeBonusResult = poolManagerIface.decodeFunctionResult('timeBonuses', bonusDetailResults[i].result);
			timeBonusData.push(timeBonusResult[0]);
		}

		// Parse NFT bonus token addresses, then batch the nftBonusBps queries
		const nftBonusCount = Number(totalNFTBonuses[0]);
		const nftTokenAddresses = [];
		for (let i = 0; i < nftBonusCount; i++) {
			const nftTokenResult = poolManagerIface.decodeFunctionResult('nftBonusTokens', bonusDetailResults[timeBonusCount + i].result);
			nftTokenAddresses.push(nftTokenResult[0]);
		}

		// Batch nftBonusBps queries for all NFT bonus tokens
		const nftBpsQueries = nftTokenAddresses.map((addr, i) => ({
			contractId: resolvedPoolManagerId,
			encoded: poolManagerIface.encodeFunctionData('nftBonusBps', [addr]),
			label: `nftBonusBps_${i}`,
		}));

		const nftBpsResults = nftBpsQueries.length > 0
			? await batchMirrorQuery(env, nftBpsQueries, operatorId, { concurrency: 25 })
			: [];

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  BONUS SYSTEM');
		console.log('═══════════════════════════════════════════════════════════');

		// Time-based bonuses
		console.log(`\n⏰ Time-Based Bonuses: ${totalTimeBonuses[0]}`);
		for (let i = 0; i < timeBonusCount; i++) {
			const timeBonus = timeBonusData[i];
			const start = Number(timeBonus.start);
			const end = Number(timeBonus.end);
			const bps = Number(timeBonus.bonusBps);

			console.log(`\n  Bonus #${i}:`);
			if (start === 0 && end === 0) {
				console.log('    Status:   DISABLED');
			}
			else {
				const now = Math.floor(Date.now() / 1000);
				let status;
				if (now < start) {
					status = 'UPCOMING';
				}
				else if (now >= start && now <= end) {
					status = 'ACTIVE';
				}
				else {
					status = 'EXPIRED';
				}
				console.log(`    Status:   ${status}`);
				console.log(`    Start:    ${new Date(start * 1000).toISOString()}`);
				console.log(`    End:      ${new Date(end * 1000).toISOString()}`);
			}
			console.log(`    Boost:    +${(bps / 100).toFixed(2)}%`);
		}

		// NFT holding bonuses
		console.log(`\n🎨 NFT Holding Bonuses: ${totalNFTBonuses[0]}`);
		for (let i = 0; i < nftBonusCount; i++) {
			const nftTokenAddress = nftTokenAddresses[i];
			const bps = Number(poolManagerIface.decodeFunctionResult('nftBonusBps', nftBpsResults[i].result)[0]);
			const tokenId = await convertToHederaId(nftTokenAddress, EntityType.TOKEN);

			// Try to get token details from mirror node
			let tokenName = 'Unknown';
			let tokenSymbol = '';
			try {
				const tokenDetails = await getTokenDetails(env, tokenId);
				tokenName = tokenDetails.name || 'Unknown';
				tokenSymbol = tokenDetails.symbol || '';
			}
			catch (e) {
				// Token details not available
				console.warn(`⚠️  Could not fetch details for token ${tokenId}: ${e.message}`);
			}

			console.log(`\n  Bonus #${i}:`);
			console.log(`    Token:    ${tokenId} (${tokenSymbol})`);
			console.log(`    Name:     ${tokenName}`);
			console.log(`    Boost:    +${(bps / 100).toFixed(2)}% (if any NFT held)`);
		}

		console.log('\n💎 LAZY Balance Bonus:');
		if (lazyThreshold === 0n || lazyBps === 0) {
			console.log('    Status:     DISABLED');
		}
		else {
			console.log('    Status:     ACTIVE');
			console.log(`    Threshold:  ${ethers.formatUnits(lazyThreshold, parseInt(process.env.LAZY_DECIMALS ?? '1'))} LAZY`);
			console.log(`    Boost:      +${(lazyBps / 100).toFixed(2)}%`);
		}

		console.log('\n═══════════════════════════════════════════════════════════\n');

		// totalPools already fetched in config batch
		console.log('🎰 Fetching lottery pools...\n');

		console.log(`📊 Total Pools: ${totalPools[0]}\n`);

		if (totalPools[0] === 0n) {
			console.log('No pools created yet.\n');
			return;
		}

		// Batch ALL pool basic info queries in parallel
		const poolCount = Number(totalPools[0]);
		const poolInfoQueries = [];
		for (let i = 0; i < poolCount; i++) {
			poolInfoQueries.push({
				contractId,
				encoded: lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [i]),
				label: `poolBasicInfo_${i}`,
			});
		}

		const poolInfoResults = await batchMirrorQuery(env, poolInfoQueries, operatorId, { concurrency: 25 });

		// Parse pool basic info and collect prize queries
		const poolBasicData = [];
		const prizeQueries = [];
		// Cache token details to avoid duplicate queries
		const tokenDetailsCache = new Map();

		for (let i = 0; i < poolCount; i++) {
			if (poolInfoResults[i].error) {
				console.warn(`⚠️  Failed to fetch pool #${i}: ${poolInfoResults[i].error.message}`);
				continue;
			}
			const poolBasicInfo = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', poolInfoResults[i].result);
			const [ticketCID, winCID, winRate, entryFee, prizeCount, outstandingEntries, poolTokenId, paused, closed, feeToken] = poolBasicInfo;

			poolBasicData.push({
				index: i,
				ticketCID, winCID, winRate, entryFee,
				prizeCount: Number(prizeCount),
				outstandingEntries: Number(outstandingEntries),
				poolTokenId, paused, closed, feeToken,
			});

			// Queue prize queries for this pool
			for (let j = 0; j < Number(prizeCount); j++) {
				prizeQueries.push({
					contractId,
					encoded: lazyLottoIface.encodeFunctionData('getPrizePackage', [i, j]),
					label: `prize_${i}_${j}`,
					poolIndex: i,
					prizeIndex: j,
				});
			}
		}

		// Batch ALL prize queries in parallel
		const prizeResults = prizeQueries.length > 0
			? await batchMirrorQuery(env, prizeQueries, operatorId, { concurrency: 25 })
			: [];

		// Build prize result lookup by pool index
		const prizeResultsByPool = new Map();
		for (let q = 0; q < prizeQueries.length; q++) {
			const poolIdx = prizeQueries[q].poolIndex;
			if (!prizeResultsByPool.has(poolIdx)) {
				prizeResultsByPool.set(poolIdx, []);
			}
			prizeResultsByPool.get(poolIdx).push(prizeResults[q]);
		}

		// Build pool objects with resolved token IDs
		const pools = [];
		for (const pbd of poolBasicData) {
			const feeTokenAddr = pbd.feeToken;
			const feeTokenId = feeTokenAddr === '0x0000000000000000000000000000000000000000'
				? 'HBAR'
				: await convertToHederaId(feeTokenAddr);

			// Cache token details for fee token
			if (feeTokenId !== 'HBAR' && !tokenDetailsCache.has(feeTokenId)) {
				tokenDetailsCache.set(feeTokenId, await getTokenDetails(env, feeTokenId));
			}

			const pool = {
				id: pbd.index,
				ticketCID: pbd.ticketCID,
				winCID: pbd.winCID,
				winRateThousandthsOfBps: Number(pbd.winRate),
				entryFee: Number(pbd.entryFee),
				prizeCount: pbd.prizeCount,
				outstandingEntries: pbd.outstandingEntries,
				poolTokenId: await convertToHederaId(pbd.poolTokenId),
				paused: pbd.paused,
				closed: pbd.closed,
				feeToken: feeTokenId,
			};

			pool.prizes = [];
			const poolPrizeResults = prizeResultsByPool.get(pbd.index) || [];
			for (const pr of poolPrizeResults) {
				if (pr.error) continue;
				const prizePackage = lazyLottoIface.decodeFunctionResult('getPrizePackage', pr.result);

				const prizeTokenAddr = prizePackage[0].token;
				const prizeTokenId = prizeTokenAddr === '0x0000000000000000000000000000000000000000'
					? 'HBAR'
					: await convertToHederaId(prizePackage[0].token);

				// Cache token details for prize token
				if (prizeTokenId !== 'HBAR' && !tokenDetailsCache.has(prizeTokenId)) {
					tokenDetailsCache.set(prizeTokenId, await getTokenDetails(env, prizeTokenId));
				}

				// Convert NFT token addresses and cache their details
				const nftTokensWithDetails = [];
				for (let k = 0; k < prizePackage[0].nftTokens.length; k++) {
					const addr = prizePackage[0].nftTokens[k];
					if (addr === '0x0000000000000000000000000000000000000000') continue;

					const tokenId = await convertToHederaId(addr, EntityType.TOKEN);

					// Cache token details for NFT
					if (!tokenDetailsCache.has(tokenId)) {
						try {
							tokenDetailsCache.set(tokenId, await getTokenDetails(env, tokenId));
						}
						catch {
							// If token details fail, use basic info
							tokenDetailsCache.set(tokenId, { symbol: tokenId, name: 'Unknown' });
						}
					}

					const serials = prizePackage[0].nftSerials[k].map(s => Number(s));
					nftTokensWithDetails.push({
						tokenId,
						serials,
					});
				}

				const prize = {
					token: prizeTokenId,
					amount: Number(prizePackage[0].amount),
					nftTokens: nftTokensWithDetails,
				};
				pool.prizes.push(prize);
			}
			pools.push(pool);
		}

		// Display all pools
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  LOTTERY POOLS');
		console.log('═══════════════════════════════════════════════════════════\n');

		for (const pool of pools) {
			console.log(`┌─ Pool #${pool.id} ─────────────────────────────────────────────`);
			console.log(`│  Win Rate:          ${formatWinRate(pool.winRateThousandthsOfBps)}`);

			// Format entry fee with proper decimals
			const feeTokenDets = pool.feeToken === 'HBAR' ? null : tokenDetailsCache.get(pool.feeToken);
			const formattedFee = pool.feeToken === 'HBAR'
				? new Hbar(pool.entryFee, HbarUnit.Tinybar).toString()
				: `${pool.entryFee / (10 ** feeTokenDets.decimals)} ${feeTokenDets.symbol}`;
			console.log(`│  Entry Fee:         ${formattedFee}`);
			console.log(`│  Pool Token:        ${pool.poolTokenId}`);
			console.log(`│  Outstanding:       ${pool.outstandingEntries} entries`);
			console.log(`│  Status:            ${pool.closed ? '🔒 CLOSED' : pool.paused ? '⏸️  PAUSED' : '🟢 ACTIVE'}`);
			console.log(`│  Prize Packages:    ${pool.prizeCount}`);
			console.log('│');

			if (pool.prizes.length > 0) {
				console.log('│  Prizes:');
				pool.prizes.forEach((prize, idx) => {
					const prizeItems = [];
					if (prize.amount > 0) {
						const prizeTokenDets = prize.token === 'HBAR' ? null : tokenDetailsCache.get(prize.token);
						const formattedAmount = prize.token === 'HBAR'
							? new Hbar(prize.amount, HbarUnit.Tinybar).toString()
							: `${prize.amount / (10 ** prizeTokenDets.decimals)} ${prizeTokenDets.symbol}`;
						prizeItems.push(formattedAmount);
					}

					// Build main prize line
					if (prize.nftTokens.length > 0) {
						const totalSerials = prize.nftTokens.reduce((sum, nft) => sum + nft.serials.length, 0);
						prizeItems.push(`${totalSerials} NFT${totalSerials !== 1 ? 's' : ''}`);
					}
					console.log(`│    ${idx + 1}. ${prizeItems.join(' + ')}`);

					// Show NFT details on separate lines
					if (prize.nftTokens.length > 0) {
						prize.nftTokens.forEach(nft => {
							const tokenDets = tokenDetailsCache.get(nft.tokenId);
							const serialsStr = nft.serials.join(', ');
							console.log(`│        - ${nft.tokenId} (${tokenDets.symbol}): [${serialsStr}]`);
						});
					}
				});
			}
			else {
				console.log('│  No prizes configured');
			}

			console.log('└────────────────────────────────────────────────────────\n');
		}

		// Pool Manager Configuration (reuse poolManagerIface + resolvedPoolManagerId from bonus section)
		try {
			console.log('═══════════════════════════════════════════════════════════');
			console.log('  POOL MANAGER CONFIGURATION');
			console.log('═══════════════════════════════════════════════════════════');
			console.log(`  Pool Manager:           ${resolvedPoolManagerId.toString()}`);

			// Batch all pool manager config queries in parallel
			const pmConfigQueries = [
				{ contractId: resolvedPoolManagerId, encoded: poolManagerIface.encodeFunctionData('getCreationFees'), label: 'getCreationFees' },
				{ contractId: resolvedPoolManagerId, encoded: poolManagerIface.encodeFunctionData('platformProceedsPercentage'), label: 'platformProceedsPercentage' },
				{ contractId: resolvedPoolManagerId, encoded: poolManagerIface.encodeFunctionData('totalGlobalPools'), label: 'totalGlobalPools' },
				{ contractId: resolvedPoolManagerId, encoded: poolManagerIface.encodeFunctionData('totalCommunityPools'), label: 'totalCommunityPools' },
			];

			const pmConfigResults = await batchMirrorQuery(env, pmConfigQueries, operatorId, { concurrency: 25 });

			const creationFees = poolManagerIface.decodeFunctionResult('getCreationFees', pmConfigResults[0].result);
			const platformPercent = poolManagerIface.decodeFunctionResult('platformProceedsPercentage', pmConfigResults[1].result);
			const totalGlobal = poolManagerIface.decodeFunctionResult('totalGlobalPools', pmConfigResults[2].result);
			const totalCommunity = poolManagerIface.decodeFunctionResult('totalCommunityPools', pmConfigResults[3].result);

			const lazyDecimals = parseInt(process.env.LAZY_DECIMALS ?? '1');
			console.log('  Creation Fees:');
			console.log(`    - HBAR: ${new Hbar(creationFees[0], HbarUnit.Tinybar).toString()}`);
			console.log(`    - LAZY: ${(Number(creationFees[1]) / (10 ** lazyDecimals)).toFixed(lazyDecimals)} LAZY`);
			console.log(`  Platform Fee:           ${platformPercent[0]}% (Pool Owner: ${100 - Number(platformPercent[0])}%)`);
			console.log(`  Global Pools:           ${totalGlobal[0]}`);
			console.log(`  Community Pools:        ${totalCommunity[0]}`);
			console.log('═══════════════════════════════════════════════════════════\n');
		}
		catch (error) {
			console.log('⚠️  Pool Manager info unavailable\n', error.message);
		}

		// Summary statistics
		const totalOutstanding = pools.reduce((sum, p) => sum + Number(p.outstandingEntries), 0);
		const activePools = pools.filter(p => !p.closed && !p.paused).length;
		const pausedPools = pools.filter(p => p.paused && !p.closed).length;
		const closedPools = pools.filter(p => p.closed).length;
		const totalPrizePackages = pools.reduce((sum, p) => sum + p.prizeCount, 0);

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  SUMMARY STATISTICS');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Total Pools:            ${pools.length}`);
		console.log(`    - Active:             ${activePools}`);
		console.log(`    - Paused:             ${pausedPools}`);
		console.log(`    - Closed:             ${closedPools}`);
		console.log(`  Total Prize Packages:   ${totalPrizePackages}`);
		console.log(`  Outstanding Entries:    ${totalOutstanding}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		console.log('✅ Master info query complete!\n');

	}
	catch (error) {
		console.error('\n❌ Error fetching master info:', error.message);
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
getMasterInfo();
