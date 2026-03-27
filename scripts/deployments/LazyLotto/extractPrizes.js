/**
 * Extract Prize Configurations for Redeployment
 *
 * Queries all pools and their prize packages from the current deployment,
 * outputs addPrizesBatch.js-compatible JSON files per pool.
 *
 * Usage:
 *   node scripts/deployments/LazyLotto/extractPrizes.js
 *   node scripts/deployments/LazyLotto/extractPrizes.js -o ./my-output-dir
 *
 * Output: One JSON file per pool with prizes (e.g., prizes-pool-0.json)
 *         Plus a summary redeployConfig snapshot
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const { createClient, getEnvConfig } = require('../../../utils/clientFactory');
const { loadInterface } = require('../../../utils/abiLoader');
const { batchMirrorQuery } = require('../../../utils/solidityHelpers');
const { queryContract } = require('../../../utils/queryHelpers');
const {
	homebrewPopulateAccountNum,
	EntityType,
	getTokenDetails,
} = require('../../../utils/hederaMirrorHelpers');
const { getArg } = require('../../../utils/nodeHelpers');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function convertToHederaId(env, evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === ZERO_ADDRESS) return null;
	return await homebrewPopulateAccountNum(env, evmAddress, entityType);
}

async function main() {
	console.log('\n╔══════════════════════════════════════════════════════════╗');
	console.log('║           LazyLotto Prize Extraction Tool               ║');
	console.log('║   Snapshots all prizes for redeployment                 ║');
	console.log('╚══════════════════════════════════════════════════════════╝\n');

	const { env, operatorId, operatorKey } = getEnvConfig();
	const client = createClient(env, operatorId, operatorKey);

	const contractId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
	const poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);
	const lazyLottoIface = loadInterface('LazyLotto');
	const poolManagerIface = loadInterface('LazyLottoPoolManager');

	const outputDir = getArg('-o') || path.join(__dirname, 'extracted-prizes');

	console.log(`📋 Contract:    ${contractId}`);
	console.log(`📋 PoolManager: ${poolManagerId}`);
	console.log(`📋 Network:     ${env}`);
	console.log(`📁 Output:      ${outputDir}\n`);

	// Create output directory
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	// 1. Get total pools
	const totalPoolsResult = await queryContract(env, contractId, lazyLottoIface, 'totalPools', [], operatorId);
	const totalPools = Number(totalPoolsResult[0]);
	console.log(`🎰 Total pools: ${totalPools}\n`);

	if (totalPools === 0) {
		console.log('No pools found. Nothing to extract.');
		process.exit(0);
	}

	// 2. Batch query all pool basic info
	const poolQueries = [];
	for (let i = 0; i < totalPools; i++) {
		poolQueries.push({
			contractId,
			encoded: lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [i]),
			label: `pool_${i}`,
		});
	}

	// Also query pool owners from PoolManager
	for (let i = 0; i < totalPools; i++) {
		poolQueries.push({
			contractId: poolManagerId,
			encoded: poolManagerIface.encodeFunctionData('getPoolOwner', [i]),
			label: `owner_${i}`,
		});
		poolQueries.push({
			contractId: poolManagerId,
			encoded: poolManagerIface.encodeFunctionData('getPoolPlatformFeePercentage', [i]),
			label: `fee_${i}`,
		});
	}

	console.log('📡 Fetching pool info...');
	const poolInfoResults = await batchMirrorQuery(env, poolQueries, operatorId, { concurrency: 25 });

	// 3. Parse pool data and queue prize queries
	const pools = [];
	const prizeQueries = [];
	const tokenDetailsCache = new Map();

	for (let i = 0; i < totalPools; i++) {
		const poolResult = poolInfoResults[i];
		if (poolResult.error) {
			console.warn(`⚠️  Failed to fetch pool #${i}`);
			continue;
		}

		const decoded = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', poolResult.result);
		const [ticketCID, winCID, winRate, entryFee, prizeCount, outstandingEntries, poolTokenId, paused, closed, feeToken] = decoded;

		// Owner
		const ownerResult = poolInfoResults[totalPools + (i * 2)];
		let owner = ZERO_ADDRESS;
		if (!ownerResult.error) {
			owner = poolManagerIface.decodeFunctionResult('getPoolOwner', ownerResult.result)[0];
		}

		// Platform fee
		const feeResult = poolInfoResults[totalPools + (i * 2) + 1];
		let platformFee = 0;
		if (!feeResult.error) {
			platformFee = Number(poolManagerIface.decodeFunctionResult('getPoolPlatformFeePercentage', feeResult.result)[0]);
		}

		// Resolve fee token
		const feeTokenId = feeToken === ZERO_ADDRESS
			? 'HBAR'
			: await convertToHederaId(env, feeToken, EntityType.TOKEN);

		if (feeTokenId !== 'HBAR' && !tokenDetailsCache.has(feeTokenId)) {
			try { tokenDetailsCache.set(feeTokenId, await getTokenDetails(env, feeTokenId)); }
			catch { tokenDetailsCache.set(feeTokenId, { symbol: feeTokenId, decimals: '0' }); }
		}

		const pool = {
			id: i,
			ticketCID,
			winCID,
			winRateThousandthsOfBps: Number(winRate),
			entryFee: Number(entryFee),
			feeToken: feeTokenId,
			feeTokenEvm: feeToken,
			prizeCount: Number(prizeCount),
			outstandingEntries: Number(outstandingEntries),
			poolTokenId: await convertToHederaId(env, poolTokenId, EntityType.TOKEN),
			paused,
			closed,
			owner: owner === ZERO_ADDRESS ? 'global' : await convertToHederaId(env, owner),
			platformFee,
			prizes: [],
		};

		pools.push(pool);

		// Queue prize queries
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

	// 4. Batch query all prizes
	const totalPrizeCount = prizeQueries.length;
	console.log(`📡 Fetching ${totalPrizeCount} prize packages across ${pools.length} pools...`);

	const prizeResults = totalPrizeCount > 0
		? await batchMirrorQuery(env, prizeQueries, operatorId, { concurrency: 25 })
		: [];

	// Index results by pool
	const prizesByPool = new Map();
	for (let q = 0; q < prizeQueries.length; q++) {
		const poolIdx = prizeQueries[q].poolIndex;
		if (!prizesByPool.has(poolIdx)) prizesByPool.set(poolIdx, []);
		prizesByPool.get(poolIdx).push({ result: prizeResults[q], index: prizeQueries[q].prizeIndex });
	}

	// 5. Parse prizes and build addPrizesBatch-compatible JSON
	const allOutputFiles = [];

	for (const pool of pools) {
		const poolPrizes = prizesByPool.get(pool.id) || [];
		const packages = [];

		for (const { result: pr } of poolPrizes) {
			if (pr.error) continue;

			const decoded = lazyLottoIface.decodeFunctionResult('getPrizePackage', pr.result);
			const prizeTokenAddr = decoded[0].token;
			const prizeAmount = BigInt(decoded[0].amount);
			const nftTokenAddrs = decoded[0].nftTokens;
			const nftSerials = decoded[0].nftSerials;

			const isHbar = prizeTokenAddr === ZERO_ADDRESS;
			const pkg = {};

			// Fungible component
			if (prizeAmount > 0n) {
				if (isHbar) {
					// Convert tinybars to HBAR string
					pkg.hbar = ethers.formatUnits(prizeAmount, 8);
				}
				else {
					const tokenId = await convertToHederaId(env, prizeTokenAddr, EntityType.TOKEN);
					if (!tokenDetailsCache.has(tokenId)) {
						try { tokenDetailsCache.set(tokenId, await getTokenDetails(env, tokenId)); }
						catch { tokenDetailsCache.set(tokenId, { symbol: tokenId, decimals: '0' }); }
					}
					const details = tokenDetailsCache.get(tokenId);
					const decimals = parseInt(details.decimals || '0');
					pkg.ft = {
						token: tokenId,
						amount: ethers.formatUnits(prizeAmount, decimals),
					};
				}
			}

			// NFT component
			if (nftTokenAddrs.length > 0) {
				const nfts = [];
				for (let k = 0; k < nftTokenAddrs.length; k++) {
					if (nftTokenAddrs[k] === ZERO_ADDRESS) continue;
					const tokenId = await convertToHederaId(env, nftTokenAddrs[k], EntityType.TOKEN);
					const serials = nftSerials[k].map(s => Number(s));
					if (serials.length > 0) {
						nfts.push({ token: tokenId, serials });
					}
				}
				if (nfts.length > 0) {
					pkg.nfts = nfts;
				}
			}

			// Only add if package has content
			if (pkg.hbar || pkg.ft || pkg.nfts) {
				packages.push(pkg);
			}
		}

		pool.prizes = packages;

		// Write per-pool prize file (addPrizesBatch.js compatible)
		if (packages.length > 0) {
			const prizeFile = path.join(outputDir, `prizes-pool-${pool.id}.json`);
			const prizeData = {
				poolId: pool.id,
				_description: `Extracted from ${contractId} pool ${pool.id} on ${new Date().toISOString()}`,
				_poolInfo: {
					winRatePercent: (pool.winRateThousandthsOfBps / 1_000_000).toFixed(4) + '%',
					entryFee: pool.feeToken === 'HBAR'
						? `${pool.entryFee / 1e8} HBAR`
						: `${pool.entryFee} raw (${pool.feeToken})`,
					feeToken: pool.feeToken,
					owner: pool.owner,
				},
				packages,
			};
			fs.writeFileSync(prizeFile, JSON.stringify(prizeData, null, 2));
			allOutputFiles.push(prizeFile);
			console.log(`  ✅ Pool ${pool.id}: ${packages.length} prizes → ${path.basename(prizeFile)}`);
		}
		else {
			console.log(`  ⚠️  Pool ${pool.id}: No prizes (${pool.closed ? 'CLOSED' : pool.paused ? 'PAUSED' : 'EMPTY'})`);
		}
	}

	// 6. Write pool config snapshot (for postDeploySetup.js)
	const configSnapshot = {
		_extractedAt: new Date().toISOString(),
		_sourceContract: contractId.toString(),
		_network: env,
		existingInfrastructure: {
			lazyToken: process.env.LAZY_TOKEN_ID,
			lazyGasStation: process.env.LAZY_GAS_STATION_CONTRACT_ID,
			lazyDelegateRegistry: process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
			prngContract: process.env.PRNG_CONTRACT_ID,
		},
		globalPools: pools.map(p => ({
			poolId: p.id,
			ticketCID: p.ticketCID,
			winCID: p.winCID,
			winRateThousandthsOfBps: p.winRateThousandthsOfBps,
			entryFee: p.entryFee,
			feeToken: p.feeTokenEvm,
			feeTokenId: p.feeToken,
			outstandingEntries: p.outstandingEntries,
			paused: p.paused,
			closed: p.closed,
			owner: p.owner,
			platformFee: p.platformFee,
			prizeCount: p.prizes.length,
		})),
	};

	const configFile = path.join(outputDir, 'pool-config-snapshot.json');
	fs.writeFileSync(configFile, JSON.stringify(configSnapshot, null, 2));
	allOutputFiles.push(configFile);

	// 7. Summary
	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  EXTRACTION SUMMARY');
	console.log('═══════════════════════════════════════════════════════════\n');

	for (const pool of pools) {
		const status = pool.closed ? '🔴 CLOSED' : pool.paused ? '🟡 PAUSED' : '🟢 ACTIVE';
		const winRate = (pool.winRateThousandthsOfBps / 1_000_000).toFixed(2);
		const fee = pool.feeToken === 'HBAR'
			? `${pool.entryFee / 1e8} HBAR`
			: `${pool.entryFee} raw ${pool.feeToken}`;

		console.log(`  Pool ${pool.id}: ${status}  |  ${winRate}% win  |  ${fee} entry  |  ${pool.prizes.length} prizes  |  ${pool.outstandingEntries} outstanding`);
	}

	const totalExtracted = pools.reduce((sum, p) => sum + p.prizes.length, 0);
	console.log(`\n  Total prizes extracted: ${totalExtracted}`);
	console.log(`  Files written: ${allOutputFiles.length}`);
	console.log(`  Output directory: ${outputDir}`);

	console.log('\n📋 Redeployment steps:');
	console.log('  1. Deploy new contracts (deployLazyLotto.js)');
	console.log('  2. Run postDeploySetup.js with existing redeployConfig');
	console.log('  3. For each pool, inject prizes:');
	for (const pool of pools) {
		if (pool.prizes.length > 0) {
			console.log(`     node scripts/interactions/LazyLotto/admin/addPrizesBatch.js -f ${path.basename(outputDir)}/prizes-pool-${pool.id}.json`);
		}
	}

	console.log('\n✅ Extraction complete.\n');
	process.exit(0);
}

main().catch(err => {
	console.error('❌ Extraction failed:', err.message);
	process.exit(1);
});
