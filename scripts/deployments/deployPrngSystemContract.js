/**
 * Deploy PrngSystemContract
 *
 * Standalone deployment script for the PRNG wrapper contract.
 * After deployment, use setPrng.js to update LazyLotto/LazyTradeLotto.
 *
 * Usage:
 *   node scripts/deployments/deployPrngSystemContract.js
 */

require('dotenv').config();
const fs = require('fs');
const { contractDeployFunction } = require('../../utils/solidityHelpers');
const { getEnvConfig, createClient } = require('../../utils/clientFactory');

const CONTRACT_NAME = 'PrngSystemContract';

const main = async () => {
	const { operatorId, operatorKey, env } = getEnvConfig();
	const client = createClient(env, operatorId, operatorKey);

	console.log('\n╔════════════════════════════════════════════════════════════╗');
	console.log('║          Deploy PrngSystemContract                        ║');
	console.log('╚════════════════════════════════════════════════════════════╝\n');
	console.log(`📍 Environment: ${env.toUpperCase()}`);
	console.log(`👤 Operator: ${operatorId.toString()}\n`);

	if (process.env.PRNG_CONTRACT_ID) {
		console.log(`⚠️  Existing PRNG_CONTRACT_ID in .env: ${process.env.PRNG_CONTRACT_ID}`);
		console.log('   This deployment will create a NEW contract.\n');
	}

	const artifactPath = `./artifacts/contracts/${CONTRACT_NAME}.sol/${CONTRACT_NAME}.json`;
	if (!fs.existsSync(artifactPath)) {
		console.error('❌ Artifact not found. Run: npx hardhat compile');
		process.exit(1);
	}

	const artifact = JSON.parse(fs.readFileSync(artifactPath));

	console.log('🔄 Deploying PrngSystemContract...');

	try {
		const [contractId, contractAddress] = await contractDeployFunction(
			client,
			artifact.bytecode,
			1_800_000,
		);

		console.log('\n✅ PrngSystemContract deployed successfully!');
		console.log(`📋 Contract ID: ${contractId.toString()}`);
		console.log(`📋 EVM Address: ${contractAddress}\n`);
		console.log('Update your .env:');
		console.log(`  PRNG_CONTRACT_ID=${contractId.toString()}\n`);
		console.log('Then update LazyLotto:');
		console.log(`  node scripts/interactions/LazyLotto/admin/setPrng.js\n`);
	}
	catch (error) {
		console.error('\n❌ Deployment failed:', error.message);
		process.exit(1);
	}
	finally {
		client.close();
	}
};

main();
