/**
 * Deploy MockPrngSystemContract  ── MIGRATION TOOL ONLY ──
 *
 * Deploys a controllable mock PRNG so an admin can rig the OLD LazyLotto's roll
 * outcomes during prize extraction:  setPrng(mock) -> setStaticArray([0]) = every roll wins.
 * Deployed with staticNumber = 0, so even an empty staticArray already yields wins.
 *
 * ⚠️  This is ONLY for the OLD (pre-v2) contract during migration. The v2 `prng` is
 *     immutable and CANNOT be pointed here. Delete this mock after cutover.
 *
 * Usage:
 *   ENVIRONMENT=mainnet LAZY_LOTTO_CONTRACT_ID=0.0.10584509 node scripts/deployments/deployMockPrng.js
 *   (LAZY_LOTTO_CONTRACT_ID isn't used here but the shared env loader may expect it downstream.)
 */

require('dotenv').config();
const fs = require('fs');
const { ContractFunctionParameters } = require('@hashgraph/sdk');
const { contractDeployFunction } = require('../../utils/solidityHelpers');
const { getEnvConfig, createClient } = require('../../utils/clientFactory');

const CONTRACT_NAME = 'MockPrngSystemContract';
const ARTIFACT = `./artifacts/contracts/mocks/${CONTRACT_NAME}.sol/${CONTRACT_NAME}.json`;

const main = async () => {
	const { operatorId, operatorKey, env } = getEnvConfig();
	const client = createClient(env, operatorId, operatorKey);

	console.log('\n╔════════════════════════════════════════════════════════════╗');
	console.log('║   Deploy MockPrngSystemContract  (migration rig only)     ║');
	console.log('╚════════════════════════════════════════════════════════════╝\n');
	console.log(`📍 Environment: ${env.toUpperCase()}`);
	console.log(`👤 Operator: ${operatorId.toString()}\n`);

	if (env.toUpperCase() !== 'MAINNET' && env.toUpperCase() !== 'MAIN') {
		console.log('ℹ️  Note: not on mainnet — this is the migration rig for the LIVE old contract.\n');
	}

	if (!fs.existsSync(ARTIFACT)) {
		console.error('❌ Artifact not found. Run: npx hardhat compile');
		process.exit(1);
	}
	const artifact = JSON.parse(fs.readFileSync(ARTIFACT));

	// constructor(bytes32 _seed, uint256 _number) — number 0 => getPseudorandomNumberArray
	// returns 0 for every index by default, so every win-roll wins and prize index 0 is picked.
	const params = new ContractFunctionParameters()
		.addBytes32(new Uint8Array(32))
		.addUint256(0);

	console.log('🔄 Deploying MockPrngSystemContract...');
	try {
		const [contractId, contractAddress] = await contractDeployFunction(
			client,
			artifact.bytecode,
			1_500_000,
			params,
		);

		console.log('\n✅ MockPrngSystemContract deployed!');
		console.log(`📋 Contract ID:  ${contractId.toString()}`);
		console.log(`📋 EVM Address:  ${contractAddress}\n`);
		console.log('Next steps:');
		console.log(`  • Pass ${contractId.toString()} to the self-drain runner as the mock PRNG.`);
		console.log('  • ⚠️  Migration-only. Never point the v2 contract at this. Delete after cutover.\n');
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
