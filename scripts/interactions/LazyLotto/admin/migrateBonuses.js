/**
 * LazyLotto Migrate Bonuses Script
 *
 * Batch migration of bonus configurations from LazyLotto Storage to PoolManager.
 * Used when setting up PoolManager with existing bonus configurations.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/migrateBonuses.js [--config <path>]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/migrateBonuses.js [--config <path>] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/migrateBonuses.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 *
 * Config file format (JSON):
 * {
 *   "timeBonuses": [
 *     { "start": 1700000000, "end": 1700086400, "bonusBps": 110 },
 *     { "start": 1700086400, "end": 1702592000, "bonusBps": 125 }
 *   ],
 *   "nftBonuses": [
 *     { "address": "0.0.1234", "bonusBps": 115 }
 *   ],
 *   "lazyBalanceBonus": { "threshold": 1000000, "bonusBps": 105 }
 * }
 */

require('dotenv').config();
const fs = require('fs');
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const poolManagerId = getContractId('LAZY_LOTTO_POOL_MANAGER_ID');

// Helper: Sleep
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Default bonus configuration (example values)
// setTimeBonus(uint256 start, uint256 end, uint16 bonusBps)
// setNFTBonus(address token, uint16 bonusBps)
// setLazyBalanceBonus(uint256 threshold, uint16 bonusBps)
const DEFAULT_CONFIG = {
	timeBonuses: [
		// Example time windows (Unix timestamps) with bonus BPS
		// { start: 1700000000, end: 1700086400, bonusBps: 110 },
		// Add time bonus windows here
	],
	nftBonuses: [
		// Example: { address: "0.0.1234", bonusBps: 115 }
		// Add NFT collection IDs and their bonus BPS here
	],
	lazyBalanceBonus: {
		// 1M LAZY tokens (adjust for decimals)
		threshold: 1000000,
		// 5% bonus (in BPS: 500 = 5%)
		bonusBps: 500,
	},
};

async function migrateBonuses() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Parse command line arguments
		const args = process.argv.slice(2);
		let configPath = null;

		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--config' && args[i + 1]) {
				configPath = args[i + 1];
				i++;
			}
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Migrate Bonuses (Admin)                 ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`👤 Admin: ${operatorId.toString()}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load configuration
		let config;
		if (configPath) {
			console.log(`📄 Loading config from: ${configPath}\n`);
			try {
				config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
			}
			catch (e) {
				console.error('❌ Failed to load config file:', e.message);
				process.exit(1);
			}
		}
		else {
			console.log('📄 Using default configuration (no --config provided)\n');
			config = DEFAULT_CONFIG;
		}

		// Validate configuration
		if (!config.timeBonuses || !Array.isArray(config.timeBonuses)) {
			console.error('❌ Invalid config: timeBonuses must be an array');
			process.exit(1);
		}

		if (!config.nftBonuses || !Array.isArray(config.nftBonuses)) {
			console.error('❌ Invalid config: nftBonuses must be an array');
			process.exit(1);
		}

		if (!config.lazyBalanceBonus || typeof config.lazyBalanceBonus.threshold !== 'number' || typeof config.lazyBalanceBonus.bonusBps !== 'number') {
			console.error('❌ Invalid config: lazyBalanceBonus must have threshold and bonusBps');
			process.exit(1);
		}

		// Load PoolManager ABI
		const poolManagerIface = loadInterface('LazyLottoPoolManager');

		// Resolve LazyLotto address from PoolManager
		console.log('🔍 Resolving LazyLotto contract from PoolManager...\n');
		const lazyLottoAddrResult = await queryContract(env, poolManagerId, poolManagerIface, 'lazyLotto', [], operatorId);
		const lazyLottoAddr = lazyLottoAddrResult[0];
		const lazyLottoHederaId = await homebrewPopulateAccountNum(env, lazyLottoAddr, EntityType.CONTRACT);
		const lazyLottoId = ContractId.fromString(lazyLottoHederaId);

		// Load LazyLotto ABI for isAdmin check
		const lazyLottoIface = loadInterface('LazyLotto');

		// Check if operator is admin via LazyLotto
		console.log('🔍 Verifying admin permissions...\n');
		const isAdminResult = await queryContract(env, lazyLottoId, lazyLottoIface, 'isAdmin', [operatorId.toSolidityAddress()], operatorId);
		const isAdmin = isAdminResult[0];

		if (!isAdmin) {
			console.error('❌ You are not an admin of the LazyLotto contract');
			process.exit(1);
		}

		console.log('✅ Admin status confirmed\n');

		// Display configuration summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  BONUS CONFIGURATION TO MIGRATE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Time Bonuses:     ${config.timeBonuses.length} entries`);
		config.timeBonuses.forEach((bonus, i) => {
			const startDate = new Date(bonus.start * 1000).toISOString();
			const endDate = new Date(bonus.end * 1000).toISOString();
			console.log(`    ${i + 1}. ${startDate} - ${endDate} → ${bonus.bonusBps} BPS`);
		});
		console.log();
		console.log(`  NFT Bonuses:      ${config.nftBonuses.length} entries`);
		config.nftBonuses.forEach((bonus, i) => {
			console.log(`    ${i + 1}. ${bonus.address} → ${bonus.bonusBps} BPS`);
		});
		console.log();
		console.log(`  LAZY Balance:     ${config.lazyBalanceBonus.threshold} threshold → ${config.lazyBalanceBonus.bonusBps} BPS`);
		console.log('═══════════════════════════════════════════════════════════\n');

		const totalOperations = config.timeBonuses.length + config.nftBonuses.length + 1;
		console.log(`📊 Total operations: ${totalOperations}\n`);

		// Confirm action
		const confirmation = await prompt('Proceed with bonus migration? (yes/no): ');
		if (confirmation.toLowerCase() !== 'yes' && confirmation.toLowerCase() !== 'y') {
			console.log('❌ Operation cancelled by user');
			process.exit(0);
		}

		console.log();
		let successCount = 0;
		let failCount = 0;

		// Migrate time bonuses
		console.log('⏰ Migrating time bonuses...\n');
		for (let i = 0; i < config.timeBonuses.length; i++) {
			const bonus = config.timeBonuses[i];
			try {
				const startDate = new Date(bonus.start * 1000).toISOString();
				const endDate = new Date(bonus.end * 1000).toISOString();
				console.log(`  [${i + 1}/${config.timeBonuses.length}] Setting time bonus ${startDate} - ${endDate} (${bonus.bonusBps} BPS)...`);

				const gasInfo = await estimateGas(
					env,
					poolManagerId,
					poolManagerIface,
					operatorId,
					'setTimeBonus',
					[bonus.start, bonus.end, bonus.bonusBps],
					150000,
				);
				const gasEstimate = gasInfo.gasLimit;

				const gasToUse = Math.floor(gasEstimate * 1.2);

				const executionResult = await executeContractFunction({
					contractId: poolManagerId,
					iface: poolManagerIface,
					client: client,
					functionName: 'setTimeBonus',
					params: [bonus.start, bonus.end, bonus.bonusBps],
					gas: gasToUse,
					payableAmount: 0,
				});

				if (!executionResult.success) {
					throw new Error(executionResult.error || 'Transaction execution failed');
				}

				const { receipt, record } = executionResult;
				const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
				console.log(`  ✅ Success! TX: ${txId}`);
				successCount++;
				// Brief delay between transactions
				await sleep(2000);
			}
			catch (error) {
				console.log(`  ❌ Failed: ${error.message}`);
				failCount++;
			}
		}

		console.log();

		// Migrate NFT bonuses
		if (config.nftBonuses.length > 0) {
			console.log('🖼️  Migrating NFT bonuses...\n');
			for (let i = 0; i < config.nftBonuses.length; i++) {
				const bonus = config.nftBonuses[i];
				try {
					// Convert Hedera ID to Solidity address if needed
					let nftAddress;
					if (bonus.address.includes('.')) {
						const accountId = AccountId.fromString(bonus.address);
						nftAddress = accountId.toSolidityAddress();
					}
					else {
						nftAddress = bonus.address;
					}

					console.log(`  [${i + 1}/${config.nftBonuses.length}] Setting NFT ${bonus.address} bonus (${bonus.bonusBps} BPS)...`);

					const gasInfo = await estimateGas(
						env,
						poolManagerId,
						poolManagerIface,
						operatorId,
						'setNFTBonus',
						[nftAddress, bonus.bonusBps],
						150000,
					);
					const gasEstimate = gasInfo.gasLimit;

					const gasToUse = Math.floor(gasEstimate * 1.2);

					const executionResult = await executeContractFunction({
						contractId: poolManagerId,
						iface: poolManagerIface,
						client: client,
						functionName: 'setNFTBonus',
						params: [nftAddress, bonus.bonusBps],
						gas: gasToUse,
						payableAmount: 0,
					});

					if (!executionResult.success) {
						throw new Error(executionResult.error || 'Transaction execution failed');
					}

					const { receipt, record } = executionResult;
					const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
					console.log(`  ✅ Success! TX: ${txId}`);
					successCount++;
					await sleep(2000);
				}
				catch (error) {
					console.log(`  ❌ Failed: ${error.message}`);
					failCount++;
				}
			}

			console.log();
		}

		// Migrate LAZY balance bonus
		console.log('💎 Migrating LAZY balance bonus...\n');
		try {
			const bonus = config.lazyBalanceBonus;
			console.log(`  Setting LAZY balance bonus (${bonus.threshold} threshold → ${bonus.bonusBps} BPS)...`);

			const gasInfo = await estimateGas(
				env,
				poolManagerId,
				poolManagerIface,
				operatorId,
				'setLazyBalanceBonus',
				[bonus.threshold, bonus.bonusBps],
				150000,
			);
			const gasEstimate = gasInfo.gasLimit;

			const gasToUse = Math.floor(gasEstimate * 1.2);

			const executionResult = await executeContractFunction({
				contractId: poolManagerId,
				iface: poolManagerIface,
				client: client,
				functionName: 'setLazyBalanceBonus',
				params: [bonus.threshold, bonus.bonusBps],
				gas: gasToUse,
				payableAmount: 0,
			});

			if (!executionResult.success) {
				throw new Error(executionResult.error || 'Transaction execution failed');
			}

			const { receipt, record } = executionResult;
			const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
			console.log(`  ✅ Success! TX: ${txId}`);
			successCount++;
		}
		catch (error) {
			console.log(`  ❌ Failed: ${error.message}`);
			failCount++;
		}

		console.log();

		// Summary
		console.log('═══════════════════════════════════════════════════════════');
		console.log('  MIGRATION COMPLETE');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Total Operations:  ${totalOperations}`);
		console.log(`  Successful:        ${successCount}`);
		console.log(`  Failed:            ${failCount}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		if (failCount === 0) {
			console.log('✨ All bonuses migrated successfully!\n');
		}
		else {
			console.log('⚠️  Some operations failed. Review the log above for details.\n');
		}

		// Wait for mirror node to sync
		console.log('⏳ Waiting 5 seconds for mirror node to sync...\n');
		await sleep(5000);

		console.log('💡 You can verify bonus configurations using query scripts.\n');

	}
	catch (error) {
		console.error('\n❌ Error migrating bonuses:', error.message);
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
migrateBonuses();
