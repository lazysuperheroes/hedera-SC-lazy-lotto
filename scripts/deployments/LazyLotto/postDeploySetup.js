/**
 * Post-Deployment Setup Script
 *
 * Reads redeployConfig-testnet.json and configures a freshly deployed LazyLotto:
 * 1. Sets creation fees on PoolManager
 * 2. Sets platform proceeds percentage
 * 3. Configures NFT holding bonuses
 * 4. Configures LAZY balance bonus
 * 5. Creates the 3 global pools matching previous deployment
 * 6. Adds LazyLotto + Storage as contract users to LazyGasStation
 *
 * Prerequisites:
 * - Run deployLazyLotto.js first
 * - Update .env with new contract IDs
 *
 * Usage:
 *   node scripts/deployments/LazyLotto/postDeploySetup.js
 */

require('dotenv').config();
const fs = require('fs');
const { Hbar, HbarUnit, ContractId, TokenId } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../utils/clientFactory');
const { loadInterface } = require('../../../utils/abiLoader');
const { queryContract } = require('../../../utils/queryHelpers');
const { estimateGas } = require('../../../utils/gasHelpers');
const {
	executeContractFunction,
} = require('../../../utils/scriptHelpers');

const { operatorId, operatorKey, env } = getEnvConfig();

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function convertToEvmAddress(hederaId) {
	if (hederaId.startsWith('0x')) return hederaId;
	const parts = hederaId.split('.');
	const num = parts[parts.length - 1];
	return '0x' + BigInt(num).toString(16).padStart(40, '0');
}

async function main() {
	// Load config
	const configPath = './scripts/deployments/redeployConfig-testnet.json';
	if (!fs.existsSync(configPath)) {
		console.error('❌ Config file not found:', configPath);
		process.exit(1);
	}

	const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

	// Load contract IDs from .env (these should be the NEW deployment)
	const lazyLottoId = getContractId('LAZY_LOTTO_CONTRACT_ID');
	const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');
	const storageId = getContractId('LAZY_LOTTO_STORAGE');
	const gasStationId = getContractId('LAZY_GAS_STATION_CONTRACT_ID');

	const client = createClient(env, operatorId, operatorKey);

	const lazyLottoIface = loadInterface('LazyLotto');
	const poolManagerIface = loadInterface('LazyLottoPoolManager');
	const gasStationIface = loadInterface('LazyGasStation');

	console.log('\n╔════════════════════════════════════════════════════════════╗');
	console.log('║         LazyLotto Post-Deployment Setup (v1.3.0)          ║');
	console.log('╚════════════════════════════════════════════════════════════╝\n');
	console.log(`📍 Environment: ${env.toUpperCase()}`);
	console.log(`📄 LazyLotto:      ${lazyLottoId.toString()}`);
	console.log(`📄 PoolManager:    ${poolManagerId.toString()}`);
	console.log(`📄 Storage:        ${storageId.toString()}`);
	console.log(`📄 GasStation:     ${gasStationId.toString()}\n`);

	// ─────────────────────────────────────────────────────────────
	// Step 1: Add LazyLotto + Storage as contract users to GasStation
	// ─────────────────────────────────────────────────────────────
	console.log('⚙️  Step 1: Configure LazyGasStation contract users');
	console.log('─────────────────────────────────────────────────────');

	for (const [label, id] of [['LazyLotto', lazyLottoId], ['LazyLottoStorage', storageId]]) {
		console.log(`\n🔨 Adding ${label} (${id.toString()}) as contract user...`);

		const result = await executeContractFunction({
			contractId: gasStationId,
			iface: gasStationIface,
			client,
			functionName: 'addContractUser',
			params: [id.toSolidityAddress()],
			gas: 200_000,
		});

		if (!result.success) {
			console.error(`❌ Failed to add ${label}: ${result.error}`);
			console.log('   (May already be registered — continuing)');
		}
		else {
			console.log(`✅ ${label} added to GasStation`);
		}

		await sleep(3000);
	}

	// ─────────────────────────────────────────────────────────────
	// Step 2: Set creation fees
	// ─────────────────────────────────────────────────────────────
	console.log('\n\n⚙️  Step 2: Set creation fees');
	console.log('─────────────────────────────────────────────────────');

	const { hbarCreationFee, lazyCreationFee } = config.poolManagerSettings;
	console.log(`   HBAR fee: ${new Hbar(hbarCreationFee, HbarUnit.Tinybar).toString()}`);
	console.log(`   LAZY fee: ${lazyCreationFee} raw (${(lazyCreationFee / 10).toFixed(1)} LAZY)`);

	const feeResult = await executeContractFunction({
		contractId: poolManagerId,
		iface: poolManagerIface,
		client,
		functionName: 'setCreationFees',
		params: [hbarCreationFee, lazyCreationFee],
		gas: 200_000,
	});

	if (!feeResult.success) {
		console.error('❌ setCreationFees failed:', feeResult.error);
		process.exit(1);
	}
	console.log('✅ Creation fees set');
	await sleep(3000);

	// ─────────────────────────────────────────────────────────────
	// Step 3: Set platform proceeds percentage
	// ─────────────────────────────────────────────────────────────
	console.log('\n⚙️  Step 3: Set platform proceeds percentage');
	console.log('─────────────────────────────────────────────────────');

	const { platformProceedsPercentage } = config.poolManagerSettings;
	console.log(`   Platform fee: ${platformProceedsPercentage}%`);

	const platResult = await executeContractFunction({
		contractId: poolManagerId,
		iface: poolManagerIface,
		client,
		functionName: 'setPlatformProceedsPercentage',
		params: [platformProceedsPercentage],
		gas: 200_000,
	});

	if (!platResult.success) {
		console.error('❌ setPlatformProceedsPercentage failed:', platResult.error);
		process.exit(1);
	}
	console.log('✅ Platform proceeds percentage set');
	await sleep(3000);

	// ─────────────────────────────────────────────────────────────
	// Step 4: Configure NFT holding bonuses
	// ─────────────────────────────────────────────────────────────
	console.log('\n⚙️  Step 4: Configure NFT holding bonuses');
	console.log('─────────────────────────────────────────────────────');

	for (const nft of config.poolManagerSettings.bonuses.nftHolding) {
		const tokenEvmAddr = convertToEvmAddress(nft.tokenId);
		console.log(`\n🔨 Setting ${nft.name} (${nft.tokenId}): ${nft.bonusBps} bps`);

		const nftResult = await executeContractFunction({
			contractId: poolManagerId,
			iface: poolManagerIface,
			client,
			functionName: 'setNFTBonus',
			params: [tokenEvmAddr, nft.bonusBps],
			gas: 300_000,
		});

		if (!nftResult.success) {
			console.error(`❌ setNFTBonus failed for ${nft.name}: ${nftResult.error}`);
			process.exit(1);
		}
		console.log(`✅ ${nft.name} bonus set`);
		await sleep(3000);
	}

	// ─────────────────────────────────────────────────────────────
	// Step 5: Configure LAZY balance bonus
	// ─────────────────────────────────────────────────────────────
	console.log('\n⚙️  Step 5: Configure LAZY balance bonus');
	console.log('─────────────────────────────────────────────────────');

	const { threshold, bonusBps } = config.poolManagerSettings.bonuses.lazyBalance;
	console.log(`   Threshold: ${threshold} raw (${(threshold / 10).toFixed(1)} LAZY)`);
	console.log(`   Bonus: ${bonusBps} bps (${(bonusBps / 100).toFixed(2)}%)`);

	const lazyBonusResult = await executeContractFunction({
		contractId: poolManagerId,
		iface: poolManagerIface,
		client,
		functionName: 'setLazyBalanceBonus',
		params: [threshold, bonusBps],
		gas: 200_000,
	});

	if (!lazyBonusResult.success) {
		console.error('❌ setLazyBalanceBonus failed:', lazyBonusResult.error);
		process.exit(1);
	}
	console.log('✅ LAZY balance bonus set');
	await sleep(3000);

	// ─────────────────────────────────────────────────────────────
	// Step 6: Create 3 global pools
	// ─────────────────────────────────────────────────────────────
	console.log('\n⚙️  Step 6: Create global pools');
	console.log('─────────────────────────────────────────────────────');

	const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
	const lazyTokenEvmAddr = convertToEvmAddress(config.existingInfrastructure.lazyToken);
	const poolTokenCreationHbar = 40;

	for (const pool of config.globalPools) {
		console.log(`\n🎰 Creating Pool ${pool.poolId}: ${pool.name}`);
		console.log(`   ${pool.description}`);
		console.log(`   Win rate: ${(pool.winRateThousandthsOfBps / 1_000_000).toFixed(4)}%`);

		const feeToken = pool.feeToken === 'LAZY' ? lazyTokenEvmAddr : pool.feeToken;

		if (feeToken === ZERO_ADDRESS) {
			console.log(`   Entry fee: ${new Hbar(pool.entryFee, HbarUnit.Tinybar).toString()}`);
		}
		else {
			console.log(`   Entry fee: ${pool.entryFee} raw`);
		}

		const poolName = pool.name;
		const poolSymbol = poolName.replace(/[^A-Z0-9]/gi, '').substring(0, 5).toUpperCase();
		const poolMemo = pool.description;

		const functionArgs = [
			poolName,
			poolSymbol,
			poolMemo,
			[], // No royalties
			pool.ticketCID,
			pool.winCID,
			pool.winRateThousandthsOfBps,
			pool.entryFee,
			feeToken,
		];

		const payableAmountTinybar = Number(new Hbar(poolTokenCreationHbar).toTinybars());

		const gasInfo = await estimateGas(
			env, lazyLottoId, lazyLottoIface, operatorId,
			'createPool', functionArgs, 800_000, payableAmountTinybar,
		);

		const createResult = await executeContractFunction({
			contractId: lazyLottoId,
			iface: lazyLottoIface,
			client,
			functionName: 'createPool',
			params: functionArgs,
			gas: Math.floor(gasInfo.gasLimit * 1.2),
			payableAmount: poolTokenCreationHbar,
		});

		if (!createResult.success) {
			console.error(`❌ Pool ${pool.poolId} creation failed: ${createResult.error}`);
			process.exit(1);
		}

		const newPoolId = Number(createResult.results[0]);
		console.log(`✅ Pool created with ID: ${newPoolId}`);

		await sleep(5000);

		// Verify pool
		const poolInfo = await queryContract(env, lazyLottoId, lazyLottoIface, 'getPoolBasicInfo', [newPoolId], operatorId);
		console.log(`   Token: ${poolInfo[6]}`);
		console.log(`   Win Rate: ${(Number(poolInfo[2]) / 1_000_000).toFixed(4)}%`);
		console.log(`   Entry Fee: ${poolInfo[3].toString()}`);
	}

	// ─────────────────────────────────────────────────────────────
	// Summary
	// ─────────────────────────────────────────────────────────────
	console.log('\n\n╔════════════════════════════════════════════════════════════╗');
	console.log('║              Setup Complete!                               ║');
	console.log('╚════════════════════════════════════════════════════════════╝\n');

	const totalPools = await queryContract(env, lazyLottoId, lazyLottoIface, 'totalPools', [], operatorId);
	console.log(`📊 Total pools created: ${totalPools[0].toString()}`);

	const fees = await queryContract(env, poolManagerId, poolManagerIface, 'getCreationFees', [], operatorId);
	console.log(`💰 Creation fees: ${new Hbar(Number(fees[0]), HbarUnit.Tinybar).toString()} HBAR + ${(Number(fees[1]) / 10).toFixed(1)} LAZY`);

	const platFee = await queryContract(env, poolManagerId, poolManagerIface, 'platformProceedsPercentage', [], operatorId);
	console.log(`📈 Platform fee: ${platFee[0].toString()}%`);

	console.log('\n📋 Next Steps:');
	console.log('   1. Add prize packages to pools using addPrizePackage.js or addPrizesBatch.js');
	console.log('   2. Update frontend to point at new contract addresses');
	console.log('   3. Resume UAT\n');

	process.exit(0);
}

main().catch(err => {
	console.error('\n❌ Setup failed:', err);
	process.exit(1);
});
