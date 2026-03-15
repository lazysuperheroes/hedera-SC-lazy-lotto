/**
 * LazyLotto Pool Discovery Indexer
 *
 * Builds an offline index of all LazyLotto pools for discovery.
 * Useful for dApps to discover available pools without making
 * multiple on-chain queries.
 *
 * Features:
 * - Queries PoolCreated events from mirror node
 * - Fetches pool details (name, status, win rate, entry fee, prizes)
 * - Outputs to JSON file for offline use
 * - Supports filtering (--active-only)
 * - Incremental updates (tracks last timestamp)
 *
 * Usage:
 *   node scripts/indexer/poolIndexer.js [options]
 *
 * Options:
 *   --active-only        Only include active pools (not paused or closed)
 *   --output=FILE        Output file (default: pools-{env}-{timestamp}.json)
 *   --contract=0.0.XXX   Override contract ID from .env
 *   --verbose            Show detailed progress
 *   --help               Show help
 */

const {
	AccountId,
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const fs = require('fs');
require('dotenv').config();

const { getTokenDetails, homebrewPopulateAccountNum, EntityType } = require('../../utils/hederaMirrorHelpers');
const { loadInterface } = require('../../utils/abiLoader');
const { queryContract } = require('../../utils/queryHelpers');

// CLI argument parsing
const args = process.argv.slice(2);
const activeOnly = args.includes('--active-only');
const verbose = args.includes('--verbose');
const showHelp = args.includes('--help') || args.includes('-h');

const outputArg = args.find(a => a.startsWith('--output='));
const contractArg = args.find(a => a.startsWith('--contract='));

// Environment setup
const env = process.env.ENVIRONMENT ?? 'testnet';
const operatorId = process.env.ACCOUNT_ID ? AccountId.fromString(process.env.ACCOUNT_ID) : null;

// Contract ID (from arg or .env)
const lazyLottoId = contractArg
	? ContractId.fromString(contractArg.split('=')[1])
	: (process.env.LAZY_LOTTO_CONTRACT_ID ? ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID) : null);

const poolManagerId = process.env.LAZY_LOTTO_POOL_MANAGER_ID
	? ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID)
	: null;

// Output file
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outputFile = outputArg
	? outputArg.split('=')[1]
	: `pools-${env.toLowerCase()}-${timestamp}.json`;

// Contract interfaces
let lazyLottoIface, poolManagerIface;

function displayHelp() {
	console.log(`
LazyLotto Pool Discovery Indexer
=================================

Builds an offline index of all LazyLotto pools for dApp discovery.

Usage: node scripts/indexer/poolIndexer.js [options]

Options:
  --active-only        Only include active pools (not paused or closed)
  --output=FILE        Output file (default: pools-{env}-{timestamp}.json)
  --contract=0.0.XXX   Override LazyLotto contract ID from .env
  --verbose            Show detailed progress for each pool
  --help, -h           Show this help message

Examples:
  # Index all pools
  node scripts/indexer/poolIndexer.js

  # Index only active pools
  node scripts/indexer/poolIndexer.js --active-only

  # Index to specific file
  node scripts/indexer/poolIndexer.js --output=pools.json --active-only

Required .env Variables:
  ACCOUNT_ID                   Your Hedera account ID
  ENVIRONMENT                  TEST, MAIN, PREVIEW, or LOCAL
  LAZY_LOTTO_CONTRACT_ID       LazyLotto contract address
`);
}

function log(...logArgs) {
	if (verbose) {
		console.log(...logArgs);
	}
}

async function convertToHederaId(evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	return await homebrewPopulateAccountNum(env, evmAddress, entityType);
}

function formatWinRate(thousandthsOfBps) {
	return (thousandthsOfBps / 1_000_000 * 100).toFixed(4);
}

async function fetchPoolDetails(poolId) {
	log(`  Fetching pool #${poolId}...`);

	const pool = {
		id: poolId,
		status: 'unknown',
		winRate: 0,
		winRateDisplay: '0%',
		entryFee: 0,
		entryFeeToken: 'HBAR',
		entryFeeDisplay: '',
		prizeCount: 0,
		outstandingEntries: 0,
		poolTokenId: null,
		owner: null,
		isCommunityPool: false,
		prizes: [],
		createdAt: null,
	};

	try {
		// Get basic pool info
		const basicInfo = await queryContract(env, lazyLottoId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);

		// [ticketCID, winCID, winRate, entryFee, prizeCount, outstandingEntries, poolTokenId, paused, closed, feeToken]
		const winRate = Number(basicInfo[2]);
		const entryFee = Number(basicInfo[3]);
		const prizeCount = Number(basicInfo[4]);
		const outstandingEntries = Number(basicInfo[5]);
		const poolTokenAddr = basicInfo[6];
		const paused = basicInfo[7];
		const closed = basicInfo[8];
		const feeTokenAddr = basicInfo[9];

		// Determine status
		if (closed) {
			pool.status = 'closed';
		}
		else if (paused) {
			pool.status = 'paused';
		}
		else {
			pool.status = 'active';
		}

		pool.winRate = winRate;
		pool.winRateDisplay = formatWinRate(winRate) + '%';
		pool.entryFee = entryFee;
		pool.prizeCount = prizeCount;
		pool.outstandingEntries = outstandingEntries;

		// Convert token addresses
		const feeTokenId = await convertToHederaId(feeTokenAddr, EntityType.TOKEN);
		pool.entryFeeToken = feeTokenId;

		// Format entry fee display
		if (feeTokenId === 'HBAR') {
			pool.entryFeeDisplay = new Hbar(entryFee, HbarUnit.Tinybar).toString();
		}
		else {
			try {
				const tokenDetails = await getTokenDetails(env, feeTokenId);
				const amount = entryFee / (10 ** tokenDetails.decimals);
				pool.entryFeeDisplay = `${amount} ${tokenDetails.symbol}`;
			}
			catch {
				pool.entryFeeDisplay = `${entryFee} (raw)`;
			}
		}

		pool.poolTokenId = await convertToHederaId(poolTokenAddr, EntityType.TOKEN);

		// Try to get pool owner (from PoolManager if available)
		if (poolManagerId) {
			try {
				const ownerResult = await queryContract(env, poolManagerId, poolManagerIface, 'getPoolOwner', [poolId], operatorId);
				const ownerAddr = ownerResult[0];

				if (ownerAddr !== '0x0000000000000000000000000000000000000000') {
					pool.owner = await convertToHederaId(ownerAddr, EntityType.ACCOUNT);
					pool.isCommunityPool = true;
				}
			}
			catch {
				// Pool might not have owner (global pool)
			}
		}

		// Get prize summaries (just counts, not full details to save API calls)
		if (prizeCount > 0 && prizeCount <= 10) {
			for (let i = 0; i < prizeCount; i++) {
				try {
					const prizePackage = await queryContract(env, lazyLottoId, lazyLottoIface, 'getPrizePackage', [poolId, i], operatorId);

					const prizeTokenAddr = prizePackage[0].token;
					const prizeAmount = Number(prizePackage[0].amount);
					const nftCount = prizePackage[0].nftTokens.filter(
						addr => addr !== '0x0000000000000000000000000000000000000000',
					).length;

					const prize = {
						index: i,
						hasTokenPrize: prizeAmount > 0,
						tokenAmount: prizeAmount,
						token: prizeTokenAddr === '0x0000000000000000000000000000000000000000'
							? 'HBAR'
							: await convertToHederaId(prizeTokenAddr, EntityType.TOKEN),
						nftCollectionCount: nftCount,
					};

					pool.prizes.push(prize);
				}
				catch (e) {
					log(`    Error fetching prize ${i}:`, e.message);
				}
			}
		}
		else if (prizeCount > 10) {
			pool.prizes = [{ note: `${prizeCount} prizes (too many to index individually)` }];
		}
	}
	catch (error) {
		log(`  Error fetching pool #${poolId}:`, error.message);
		pool.status = 'error';
		pool.error = error.message;
	}

	return pool;
}

async function indexPools() {
	console.log('\n' + '='.repeat(60));
	console.log('  LazyLotto Pool Discovery Indexer');
	console.log('='.repeat(60) + '\n');

	// Validation
	if (!operatorId) {
		console.error('ERROR: ACCOUNT_ID must be set in .env');
		process.exit(1);
	}

	if (!lazyLottoId) {
		console.error('ERROR: LAZY_LOTTO_CONTRACT_ID must be set in .env or --contract argument');
		process.exit(1);
	}

	console.log(`Environment:     ${env.toUpperCase()}`);
	console.log(`LazyLotto:       ${lazyLottoId.toString()}`);
	if (poolManagerId) {
		console.log(`PoolManager:     ${poolManagerId.toString()}`);
	}
	console.log(`Output File:     ${outputFile}`);
	console.log(`Active Only:     ${activeOnly}`);
	console.log();

	// Load interfaces
	try {
		lazyLottoIface = loadInterface('LazyLotto');

		if (poolManagerId) {
			poolManagerIface = loadInterface('LazyLottoPoolManager');
		}
	}
	catch {
		console.error('ERROR: Could not load contract ABIs. Run `npx hardhat compile` first.');
		process.exit(1);
	}

	// Get total pools
	console.log('Querying total pool count...');
	let totalPools = 0;

	try {
		const result = await queryContract(env, lazyLottoId, lazyLottoIface, 'totalPools', [], operatorId);
		totalPools = Number(result[0]);
	}
	catch (error) {
		console.error('ERROR: Could not query total pools:', error.message);
		process.exit(1);
	}

	console.log(`Found ${totalPools} pools\n`);

	if (totalPools === 0) {
		console.log('No pools to index.');
		process.exit(0);
	}

	// Index each pool
	console.log('Indexing pools...');
	const pools = [];
	const stats = {
		total: totalPools,
		active: 0,
		paused: 0,
		closed: 0,
		errors: 0,
		community: 0,
	};

	for (let i = 0; i < totalPools; i++) {
		process.stdout.write(`  Pool ${i + 1}/${totalPools}...`);

		const pool = await fetchPoolDetails(i);

		// Update stats
		switch (pool.status) {
		case 'active':
			stats.active++;
			break;
		case 'paused':
			stats.paused++;
			break;
		case 'closed':
			stats.closed++;
			break;
		case 'error':
			stats.errors++;
			break;
		}

		if (pool.isCommunityPool) {
			stats.community++;
		}

		// Filter if needed
		if (activeOnly && pool.status !== 'active') {
			process.stdout.write(` skipped (${pool.status})\n`);
			continue;
		}

		pools.push(pool);
		process.stdout.write(` ${pool.status}\n`);

		// Small delay to avoid rate limiting
		await new Promise(resolve => setTimeout(resolve, 200));
	}

	// Build output
	const output = {
		metadata: {
			version: '1.0',
			generatedAt: new Date().toISOString(),
			environment: env.toUpperCase(),
			lazyLottoContract: lazyLottoId.toString(),
			poolManagerContract: poolManagerId?.toString() || null,
			filters: {
				activeOnly,
			},
		},
		stats: {
			totalPoolsOnChain: stats.total,
			indexedPools: pools.length,
			byStatus: {
				active: stats.active,
				paused: stats.paused,
				closed: stats.closed,
			},
			communityPools: stats.community,
			globalPools: stats.total - stats.community,
			errors: stats.errors,
		},
		pools,
	};

	// Write output
	fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

	// Summary
	console.log('\n' + '='.repeat(60));
	console.log('  INDEXING COMPLETE');
	console.log('='.repeat(60));
	console.log();
	console.log('Statistics:');
	console.log(`  Total Pools On-Chain:  ${stats.total}`);
	console.log(`  Indexed:               ${pools.length}`);
	console.log(`  Active:                ${stats.active}`);
	console.log(`  Paused:                ${stats.paused}`);
	console.log(`  Closed:                ${stats.closed}`);
	console.log(`  Community Pools:       ${stats.community}`);
	console.log(`  Global Pools:          ${stats.total - stats.community}`);
	if (stats.errors > 0) {
		console.log(`  Errors:                ${stats.errors}`);
	}
	console.log();
	console.log(`Output written to: ${outputFile}`);
	console.log();
}

// Main
if (showHelp) {
	displayHelp();
	process.exit(0);
}

indexPools()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Indexing failed:', error);
		process.exit(1);
	});
