/**
 * LazyLotto Complete Deployment Orchestrator
 *
 * Atomic deployment script that deploys the entire LazyLotto ecosystem with
 * checkpoint/resume support for reliable deployments.
 *
 * Features:
 * - JSON state file for pause/resume (survives interruptions)
 * - --resume flag to continue from last checkpoint
 * - --verify-only to check existing deployment
 * - --include-trade-lotto to also deploy LazyTradeLotto
 * - Reuses existing contracts from .env
 * - Comprehensive verification at end
 *
 * Deployment Order:
 * 1. LAZY Token + SCT
 * 2. LazyGasStation
 * 3. LazyDelegateRegistry
 * 4. PRNG
 * 5. LazyLottoStorage
 * 6. LazyLotto
 * 7. Configure Storage → LazyLotto
 * 8. Configure GasStation users
 * 9. LazyLottoPoolManager
 * 10. Link PoolManager ↔ LazyLotto
 * 11. LazyTradeLotto (optional, with --include-trade-lotto)
 * 12. Configure TradeLotto → GasStation
 * 13. Verify all
 *
 * Usage:
 *   node scripts/deployments/lazyLottoDeployAll.js [options]
 *
 * Options:
 *   --resume              Continue from last checkpoint
 *   --verify-only         Only verify existing deployment (no changes)
 *   --include-trade-lotto Also deploy LazyTradeLotto
 *   --non-interactive     Skip all prompts (use .env values only)
 *   --help                Show this help message
 */

const fs = require('fs');
const readline = require('readline');
const {
	ContractId,
	TokenId,
	ContractFunctionParameters,
} = require('@hashgraph/sdk');
const { ethers } = require('ethers');

const { contractDeployFunction, contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getEnvConfig, createClient } = require('../../utils/clientFactory');
const { queryContract } = require('../../utils/queryHelpers');
const { verifyContract } = require('@lazysuperheroes/hedera-verify');

// CLI flags
const args = process.argv.slice(2);
const resumeMode = args.includes('--resume');
const verifyOnly = args.includes('--verify-only');
const includeTradeLotto = args.includes('--include-trade-lotto');
const nonInteractive = args.includes('--non-interactive');
const showHelp = args.includes('--help') || args.includes('-h');

// Configuration
const STATE_FILE = './deployment-state.json';
const env = process.env.ENVIRONMENT ?? 'TEST';

// Opt-in Sourcify source verification right after each fresh deploy.
const verifyOnDeploy = process.env.VERIFY_ON_DEPLOY === 'true' || process.env.VERIFY_ON_DEPLOY === '1';

// Contract names
const CONTRACTS = {
	lazyTokenCreator: 'LAZYTokenCreator',
	lazyGasStation: 'LazyGasStation',
	lazyDelegateRegistry: 'LazyDelegateRegistry',
	prng: 'PrngSystemContract',
	lazyLottoStorage: 'LazyLottoStorage',
	lazyLotto: 'LazyLotto',
	poolManager: 'LazyLottoPoolManager',
	tradeLotto: 'LazyTradeLotto',
};

// Deployment steps
const STEPS = {
	INIT: 'init',
	LAZY_TOKEN: 'lazy_token',
	GAS_STATION: 'gas_station',
	DELEGATE_REGISTRY: 'delegate_registry',
	PRNG: 'prng',
	STORAGE: 'storage',
	LAZY_LOTTO: 'lazy_lotto',
	CONFIGURE_STORAGE: 'configure_storage',
	CONFIGURE_GAS_STATION: 'configure_gas_station',
	POOL_MANAGER: 'pool_manager',
	LINK_POOL_MANAGER: 'link_pool_manager',
	TRADE_LOTTO: 'trade_lotto',
	CONFIGURE_TRADE_LOTTO: 'configure_trade_lotto',
	VERIFY: 'verify',
	COMPLETE: 'complete',
};

// State tracking
let state = {
	currentStep: STEPS.INIT,
	startedAt: null,
	completedAt: null,
	environment: null,
	contracts: {
		lazyToken: null,
		lazySCT: null,
		lazyGasStation: null,
		lazyDelegateRegistry: null,
		prng: null,
		lazyLottoStorage: null,
		lazyLotto: null,
		poolManager: null,
		tradeLotto: null,
	},
	errors: [],
};

// Hedera client and interfaces
let client;
let operatorId, operatorKey;
const interfaces = {};

// Helper functions
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verify a freshly-deployed contract's source on Sourcify. Opt-in via
 * VERIFY_ON_DEPLOY; read-only (no key/gas) and best-effort — a verification
 * failure must never abort a deployment, so this never throws.
 * @param {string} contractName  artifact contract name (e.g. 'LazyLotto')
 * @param {import('@hashgraph/sdk').ContractId} contractId  fresh deploy id
 * @param {string} [sourceName]  only when path !== contracts/<contractName>.sol
 */
async function maybeVerifySource(contractName, contractId, sourceName) {
	if (!verifyOnDeploy) return;
	try {
		const result = await verifyContract({
			contractName,
			sourceName,
			env,
			contractId: contractId.toString(),
			// let the mirror node index the freshly-deployed contract first
			initialDelayMs: 10000,
			attempts: 4,
			retryDelayMs: 8000,
		});
		console.log(`  Sourcify [${contractName}]: ${result.status}${result.match ? ` (${result.match})` : ''}`);
		if (result.repoUrl) console.log(`    ${result.repoUrl}`);
	}
	catch (error) {
		console.warn(`  Sourcify verify for ${contractName} skipped (non-fatal): ${error.message}`);
	}
}

function loadState() {
	if (fs.existsSync(STATE_FILE)) {
		const data = fs.readFileSync(STATE_FILE, 'utf8');
		return JSON.parse(data);
	}
	return null;
}

function saveState() {
	fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function prompt(question) {
	if (nonInteractive) {
		return Promise.resolve('yes');
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise(resolve => {
		rl.question(question, answer => {
			rl.close();
			resolve(answer);
		});
	});
}

function displayHelp() {
	console.log(`
LazyLotto Complete Deployment Orchestrator
==========================================

Usage: node scripts/deployments/lazyLottoDeployAll.js [options]

Options:
  --resume              Continue from last checkpoint (uses deployment-state.json)
  --verify-only         Only verify existing deployment (no changes made)
  --include-trade-lotto Also deploy LazyTradeLotto after LazyLotto
  --non-interactive     Skip all prompts (use .env values only)
  --help, -h            Show this help message

Examples:
  # Fresh deployment (interactive)
  node scripts/deployments/lazyLottoDeployAll.js

  # Resume after interruption
  node scripts/deployments/lazyLottoDeployAll.js --resume

  # Verify existing deployment
  node scripts/deployments/lazyLottoDeployAll.js --verify-only

  # Deploy everything including LazyTradeLotto (non-interactive)
  node scripts/deployments/lazyLottoDeployAll.js --include-trade-lotto --non-interactive

Required .env Variables:
  ACCOUNT_ID            Your Hedera account ID
  PRIVATE_KEY           ED25519 private key
  ENVIRONMENT           TEST, MAIN, PREVIEW, or LOCAL

Optional .env Variables (reuse existing contracts):
  LAZY_TOKEN_ID, LAZY_SCT_CONTRACT_ID, LAZY_GAS_STATION_CONTRACT_ID,
  LAZY_DELEGATE_REGISTRY_CONTRACT_ID, PRNG_CONTRACT_ID, LAZY_LOTTO_STORAGE,
  LAZY_LOTTO_CONTRACT_ID, LAZY_LOTTO_POOL_MANAGER_ID

For LazyTradeLotto (--include-trade-lotto):
  SIGNING_KEY           ECDSA private key for signature validation
  LSH_GEN1_TOKEN_ID     LSH Gen1 NFT token
  LSH_GEN2_TOKEN_ID     LSH Gen2 NFT token
  LSH_GEN1_MUTANT_TOKEN_ID  LSH Gen1 Mutant NFT token
  INITIAL_LOTTO_JACKPOT Initial jackpot amount (in LAZY)
  LOTTO_LOSS_INCREMENT  Jackpot increment on losses (in LAZY)
  LAZY_BURN_PERCENT     Burn percentage (0-100)
`);
}

async function initializeClient() {
	console.log('\n' + '='.repeat(60));
	console.log('  LazyLotto Complete Deployment Orchestrator');
	console.log('='.repeat(60) + '\n');

	const config = getEnvConfig();
	operatorId = config.operatorId;
	operatorKey = config.operatorKey;

	const envUpper = env.toUpperCase();
	console.log(`Environment: ${envUpper}`);

	if ((envUpper === 'MAIN' || envUpper === 'MAINNET') && !nonInteractive) {
		const confirmInput = await prompt('WARNING: Deploying to MAINNET. Type "MAINNET" to confirm: ');
		if (confirmInput !== 'MAINNET') {
			console.log('Deployment cancelled.');
			process.exit(0);
		}
	}

	client = createClient(env, operatorId, operatorKey);
	console.log(`Operator: ${operatorId.toString()}\n`);

	state.environment = envUpper;
	state.startedAt = state.startedAt || new Date().toISOString();
}

function loadInterfaces() {
	// Load all contract interfaces
	const contractPaths = {
		lazyTokenCreator: `./artifacts/contracts/legacy/${CONTRACTS.lazyTokenCreator}.sol/${CONTRACTS.lazyTokenCreator}.json`,
		lazyGasStation: `./artifacts/contracts/${CONTRACTS.lazyGasStation}.sol/${CONTRACTS.lazyGasStation}.json`,
		lazyDelegateRegistry: `./artifacts/contracts/${CONTRACTS.lazyDelegateRegistry}.sol/${CONTRACTS.lazyDelegateRegistry}.json`,
		prng: `./artifacts/contracts/${CONTRACTS.prng}.sol/${CONTRACTS.prng}.json`,
		lazyLottoStorage: `./artifacts/contracts/${CONTRACTS.lazyLottoStorage}.sol/${CONTRACTS.lazyLottoStorage}.json`,
		lazyLotto: `./artifacts/contracts/${CONTRACTS.lazyLotto}.sol/${CONTRACTS.lazyLotto}.json`,
		poolManager: `./artifacts/contracts/${CONTRACTS.poolManager}.sol/${CONTRACTS.poolManager}.json`,
		tradeLotto: `./artifacts/contracts/${CONTRACTS.tradeLotto}.sol/${CONTRACTS.tradeLotto}.json`,
	};

	for (const [name, filePath] of Object.entries(contractPaths)) {
		try {
			const json = JSON.parse(fs.readFileSync(filePath));
			interfaces[name] = {
				abi: new ethers.Interface(json.abi),
				bytecode: json.bytecode,
			};
		}
		catch (error) {
			console.warn(`Warning: Could not load interface for ${name}: ${error.message}`);
		}
	}
}

function updateStep(step) {
	state.currentStep = step;
	saveState();
	console.log(`\n${'─'.repeat(60)}`);
	console.log(`Step: ${step}`);
	console.log('─'.repeat(60));
}

async function deployOrReuse(name, envVar, deployFn) {
	const existingId = process.env[envVar];

	if (existingId) {
		console.log(`Found existing ${name}: ${existingId}`);

		if (!nonInteractive) {
			const use = await prompt(`Use existing ${name}? (yes/no): `);
			if (use.toLowerCase() !== 'yes' && use.toLowerCase() !== 'y') {
				console.log('Please update .env and restart.');
				process.exit(0);
			}
		}

		return existingId.startsWith('0.0.')
			? (name.includes('Token') ? TokenId.fromString(existingId) : ContractId.fromString(existingId))
			: existingId;
	}

	console.log(`No existing ${name} found. Deploying...`);
	return await deployFn();
}

// Step implementations
async function stepLazyToken() {
	updateStep(STEPS.LAZY_TOKEN);

	state.contracts.lazyToken = await deployOrReuse(
		'LAZY Token',
		'LAZY_TOKEN_ID',
		async () => {
			// Check for SCT too
			if (process.env.LAZY_SCT_CONTRACT_ID) {
				state.contracts.lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
			}
			else {
				// Deploy SCT first
				console.log('Deploying LAZY Token Creator (SCT)...');
				const [sctId] = await contractDeployFunction(
					client,
					interfaces.lazyTokenCreator.bytecode,
					3_500_000,
				);
				state.contracts.lazySCT = sctId;
				console.log(`LAZY SCT deployed: ${sctId.toString()}`);
				await maybeVerifySource(CONTRACTS.lazyTokenCreator, sctId, 'contracts/legacy/LAZYTokenCreator.sol');
			}

			// Get token parameters
			const decimals = parseInt(process.env.LAZY_DECIMALS ?? '1');
			const maxSupply = parseInt(process.env.LAZY_MAX_SUPPLY ?? '1000000000');

			console.log('Creating LAZY fungible token...');
			const mintResult = await contractExecuteFunction(
				state.contracts.lazySCT,
				interfaces.lazyTokenCreator.abi,
				client,
				800_000,
				'createFungibleWithBurn',
				['LAZY', '$LAZY', 'Lazy Superheroes Token', maxSupply, decimals, maxSupply],
				20,
			);

			if (mintResult[0]?.status?.toString() !== 'SUCCESS') {
				throw new Error(`Token creation failed: ${mintResult[0]?.status}`);
			}

			const tokenId = TokenId.fromSolidityAddress(mintResult[1][0]);
			console.log(`LAZY Token created: ${tokenId.toString()}`);
			return tokenId;
		},
	);

	if (typeof state.contracts.lazyToken === 'string') {
		state.contracts.lazyToken = TokenId.fromString(state.contracts.lazyToken);
	}

	if (process.env.LAZY_SCT_CONTRACT_ID && !state.contracts.lazySCT) {
		state.contracts.lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
	}

	saveState();
}

async function stepGasStation() {
	updateStep(STEPS.GAS_STATION);

	state.contracts.lazyGasStation = await deployOrReuse(
		'LazyGasStation',
		'LAZY_GAS_STATION_CONTRACT_ID',
		async () => {
			const params = new ContractFunctionParameters()
				.addAddress(state.contracts.lazyToken.toSolidityAddress())
				.addAddress(state.contracts.lazySCT.toSolidityAddress());

			const [id] = await contractDeployFunction(
				client,
				interfaces.lazyGasStation.bytecode,
				4_000_000,
				params,
			);
			console.log(`LazyGasStation deployed: ${id.toString()}`);
			await maybeVerifySource(CONTRACTS.lazyGasStation, id);
			return id;
		},
	);

	if (typeof state.contracts.lazyGasStation === 'string') {
		state.contracts.lazyGasStation = ContractId.fromString(state.contracts.lazyGasStation);
	}

	saveState();
}

async function stepDelegateRegistry() {
	updateStep(STEPS.DELEGATE_REGISTRY);

	state.contracts.lazyDelegateRegistry = await deployOrReuse(
		'LazyDelegateRegistry',
		'LAZY_DELEGATE_REGISTRY_CONTRACT_ID',
		async () => {
			const [id] = await contractDeployFunction(
				client,
				interfaces.lazyDelegateRegistry.bytecode,
				2_100_000,
			);
			console.log(`LazyDelegateRegistry deployed: ${id.toString()}`);
			await maybeVerifySource(CONTRACTS.lazyDelegateRegistry, id);
			return id;
		},
	);

	if (typeof state.contracts.lazyDelegateRegistry === 'string') {
		state.contracts.lazyDelegateRegistry = ContractId.fromString(state.contracts.lazyDelegateRegistry);
	}

	saveState();
}

async function stepPRNG() {
	updateStep(STEPS.PRNG);

	state.contracts.prng = await deployOrReuse(
		'PRNG',
		'PRNG_CONTRACT_ID',
		async () => {
			const [id] = await contractDeployFunction(
				client,
				interfaces.prng.bytecode,
				1_800_000,
			);
			console.log(`PRNG deployed: ${id.toString()}`);
			await maybeVerifySource(CONTRACTS.prng, id);
			return id;
		},
	);

	if (typeof state.contracts.prng === 'string') {
		state.contracts.prng = ContractId.fromString(state.contracts.prng);
	}

	saveState();
}

async function stepStorage() {
	updateStep(STEPS.STORAGE);

	state.contracts.lazyLottoStorage = await deployOrReuse(
		'LazyLottoStorage',
		'LAZY_LOTTO_STORAGE',
		async () => {
			const params = new ContractFunctionParameters()
				.addAddress(state.contracts.lazyGasStation.toSolidityAddress())
				.addAddress(state.contracts.lazyToken.toSolidityAddress());

			const [id] = await contractDeployFunction(
				client,
				interfaces.lazyLottoStorage.bytecode,
				3_500_000,
				params,
			);
			console.log(`LazyLottoStorage deployed: ${id.toString()}`);
			await maybeVerifySource(CONTRACTS.lazyLottoStorage, id);
			return id;
		},
	);

	if (typeof state.contracts.lazyLottoStorage === 'string') {
		state.contracts.lazyLottoStorage = ContractId.fromString(state.contracts.lazyLottoStorage);
	}

	saveState();
}

async function stepLazyLotto() {
	updateStep(STEPS.LAZY_LOTTO);

	state.contracts.lazyLotto = await deployOrReuse(
		'LazyLotto',
		'LAZY_LOTTO_CONTRACT_ID',
		async () => {
			const burnPercent = parseInt(process.env.LAZY_BURN_PERCENT ?? '0');

			const params = new ContractFunctionParameters()
				.addAddress(state.contracts.lazyToken.toSolidityAddress())
				.addAddress(state.contracts.lazyGasStation.toSolidityAddress())
				.addAddress(state.contracts.lazyDelegateRegistry.toSolidityAddress())
				.addAddress(state.contracts.prng.toSolidityAddress())
				.addUint256(burnPercent)
				.addAddress(state.contracts.lazyLottoStorage.toSolidityAddress());

			const [id] = await contractDeployFunction(
				client,
				interfaces.lazyLotto.bytecode,
				6_000_000,
				params,
			);
			console.log(`LazyLotto deployed: ${id.toString()}`);
			await maybeVerifySource(CONTRACTS.lazyLotto, id);
			return id;
		},
	);

	if (typeof state.contracts.lazyLotto === 'string') {
		state.contracts.lazyLotto = ContractId.fromString(state.contracts.lazyLotto);
	}

	saveState();
}

async function stepConfigureStorage() {
	updateStep(STEPS.CONFIGURE_STORAGE);

	console.log('Setting LazyLotto as contract user on storage...');
	await sleep(3000);

	const result = await contractExecuteFunction(
		state.contracts.lazyLottoStorage,
		interfaces.lazyLottoStorage.abi,
		client,
		500_000,
		'setContractUser',
		[state.contracts.lazyLotto.toSolidityAddress()],
	);

	if (result[0]?.status?.toString() !== 'SUCCESS') {
		throw new Error(`setContractUser failed: ${result[0]?.status}`);
	}

	console.log('LazyLotto set as contract user on storage');
	saveState();
}

async function stepConfigureGasStation() {
	updateStep(STEPS.CONFIGURE_GAS_STATION);

	await sleep(3000);

	// Add storage
	console.log('Adding LazyLottoStorage to LazyGasStation...');
	let result = await contractExecuteFunction(
		state.contracts.lazyGasStation,
		interfaces.lazyGasStation.abi,
		client,
		500_000,
		'addContractUser',
		[state.contracts.lazyLottoStorage.toSolidityAddress()],
	);

	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.warn('Note: Adding storage may have failed (might already be added)');
	}
	else {
		console.log('LazyLottoStorage added to LazyGasStation');
	}

	await sleep(2000);

	// Add LazyLotto
	console.log('Adding LazyLotto to LazyGasStation...');
	result = await contractExecuteFunction(
		state.contracts.lazyGasStation,
		interfaces.lazyGasStation.abi,
		client,
		500_000,
		'addContractUser',
		[state.contracts.lazyLotto.toSolidityAddress()],
	);

	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.warn('Note: Adding LazyLotto may have failed (might already be added)');
	}
	else {
		console.log('LazyLotto added to LazyGasStation');
	}

	saveState();
}

async function stepPoolManager() {
	updateStep(STEPS.POOL_MANAGER);

	state.contracts.poolManager = await deployOrReuse(
		'LazyLottoPoolManager',
		'LAZY_LOTTO_POOL_MANAGER_ID',
		async () => {
			const params = new ContractFunctionParameters()
				.addAddress(state.contracts.lazyToken.toSolidityAddress())
				.addAddress(state.contracts.lazyGasStation.toSolidityAddress())
				.addAddress(state.contracts.lazyDelegateRegistry.toSolidityAddress());

			const [id] = await contractDeployFunction(
				client,
				interfaces.poolManager.bytecode,
				2_500_000,
				params,
			);
			console.log(`LazyLottoPoolManager deployed: ${id.toString()}`);
			await maybeVerifySource(CONTRACTS.poolManager, id);
			return id;
		},
	);

	if (typeof state.contracts.poolManager === 'string') {
		state.contracts.poolManager = ContractId.fromString(state.contracts.poolManager);
	}

	saveState();
}

async function stepLinkPoolManager() {
	updateStep(STEPS.LINK_POOL_MANAGER);

	await sleep(3000);

	// Set LazyLotto in PoolManager
	console.log('Setting LazyLotto address in PoolManager...');
	let result = await contractExecuteFunction(
		state.contracts.poolManager,
		interfaces.poolManager.abi,
		client,
		150_000,
		'setLazyLotto',
		[state.contracts.lazyLotto.toSolidityAddress()],
	);

	if (result[0]?.status?.toString() !== 'SUCCESS') {
		throw new Error(`setLazyLotto failed: ${result[0]?.status}`);
	}

	console.log('LazyLotto address set in PoolManager');

	await sleep(2000);

	// Set PoolManager in LazyLotto
	console.log('Setting PoolManager address in LazyLotto...');
	result = await contractExecuteFunction(
		state.contracts.lazyLotto,
		interfaces.lazyLotto.abi,
		client,
		150_000,
		'setPoolManager',
		[state.contracts.poolManager.toSolidityAddress()],
	);

	if (result[0]?.status?.toString() !== 'SUCCESS') {
		throw new Error(`setPoolManager failed: ${result[0]?.status}`);
	}

	console.log('PoolManager address set in LazyLotto');
	saveState();
}

async function stepTradeLotto() {
	if (!includeTradeLotto) {
		console.log('\nSkipping LazyTradeLotto (use --include-trade-lotto to deploy)');
		return;
	}

	updateStep(STEPS.TRADE_LOTTO);

	state.contracts.tradeLotto = await deployOrReuse(
		'LazyTradeLotto',
		'LAZY_TRADE_LOTTO_CONTRACT_ID',
		async () => {
			// Validate required env vars
			const required = ['SIGNING_KEY', 'LSH_GEN1_TOKEN_ID', 'LSH_GEN2_TOKEN_ID', 'LSH_GEN1_MUTANT_TOKEN_ID'];
			for (const envVar of required) {
				if (!process.env[envVar]) {
					throw new Error(`${envVar} required for LazyTradeLotto deployment`);
				}
			}

			const signingKey = process.env.SIGNING_KEY.startsWith('0x')
				? process.env.SIGNING_KEY
				: `0x${process.env.SIGNING_KEY}`;
			const signingWallet = new ethers.Wallet(signingKey);

			const decimals = parseInt(process.env.LAZY_DECIMALS ?? '1');
			const initialJackpot = parseInt(process.env.INITIAL_LOTTO_JACKPOT ?? '2000') * (10 ** decimals);
			const lossIncrement = parseInt(process.env.LOTTO_LOSS_INCREMENT ?? '50') * (10 ** decimals);
			const burnPercent = parseInt(process.env.LAZY_BURN_PERCENT ?? '25');

			const params = new ContractFunctionParameters()
				.addAddress(state.contracts.prng.toSolidityAddress())
				.addAddress(state.contracts.lazyGasStation.toSolidityAddress())
				.addAddress(state.contracts.lazyDelegateRegistry.toSolidityAddress())
				.addAddress(TokenId.fromString(process.env.LSH_GEN1_TOKEN_ID).toSolidityAddress())
				.addAddress(TokenId.fromString(process.env.LSH_GEN2_TOKEN_ID).toSolidityAddress())
				.addAddress(TokenId.fromString(process.env.LSH_GEN1_MUTANT_TOKEN_ID).toSolidityAddress())
				.addAddress(signingWallet.address)
				.addUint256(initialJackpot)
				.addUint256(lossIncrement)
				.addUint256(burnPercent);

			const [id] = await contractDeployFunction(
				client,
				interfaces.tradeLotto.bytecode,
				2_500_000,
				params,
			);
			console.log(`LazyTradeLotto deployed: ${id.toString()}`);
			console.log(`System wallet: ${signingWallet.address}`);
			await maybeVerifySource(CONTRACTS.tradeLotto, id);
			return id;
		},
	);

	if (typeof state.contracts.tradeLotto === 'string') {
		state.contracts.tradeLotto = ContractId.fromString(state.contracts.tradeLotto);
	}

	saveState();
}

async function stepConfigureTradeLotto() {
	if (!includeTradeLotto || !state.contracts.tradeLotto) {
		return;
	}

	updateStep(STEPS.CONFIGURE_TRADE_LOTTO);

	console.log('Adding LazyTradeLotto to LazyGasStation...');

	const result = await contractExecuteFunction(
		state.contracts.lazyGasStation,
		interfaces.lazyGasStation.abi,
		client,
		500_000,
		'addContractUser',
		[state.contracts.tradeLotto.toSolidityAddress()],
	);

	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.warn('Note: Adding TradeLotto may have failed (might already be added)');
	}
	else {
		console.log('LazyTradeLotto added to LazyGasStation');
	}

	saveState();
}

async function stepVerify() {
	updateStep(STEPS.VERIFY);

	console.log('\nVerifying deployment...\n');

	await sleep(5000);

	const checks = [];

	// Verify LazyLotto configuration
	try {
		let decoded = await queryContract(env, state.contracts.lazyLotto, interfaces.lazyLotto.abi, 'lazyToken', [], operatorId);
		const tokenMatch = decoded[0].slice(2).toLowerCase() === state.contracts.lazyToken.toSolidityAddress();
		checks.push({ name: 'LazyLotto → lazyToken', pass: tokenMatch });

		decoded = await queryContract(env, state.contracts.lazyLotto, interfaces.lazyLotto.abi, 'storageContract', [], operatorId);
		const storageMatch = decoded[0].slice(2).toLowerCase() === state.contracts.lazyLottoStorage.toSolidityAddress();
		checks.push({ name: 'LazyLotto → storageContract', pass: storageMatch });

		decoded = await queryContract(env, state.contracts.lazyLotto, interfaces.lazyLotto.abi, 'poolManager', [], operatorId);
		const pmMatch = decoded[0].slice(2).toLowerCase() === state.contracts.poolManager.toSolidityAddress();
		checks.push({ name: 'LazyLotto → poolManager', pass: pmMatch });

		decoded = await queryContract(env, state.contracts.poolManager, interfaces.poolManager.abi, 'lazyLotto', [], operatorId);
		const llMatch = decoded[0].slice(2).toLowerCase() === state.contracts.lazyLotto.toSolidityAddress();
		checks.push({ name: 'PoolManager → lazyLotto', pass: llMatch });
	}
	catch (error) {
		console.error('Verification error:', error.message);
		checks.push({ name: 'Verification', pass: false, error: error.message });
	}

	// Display results
	console.log('Verification Results:');
	console.log('─'.repeat(50));

	let allPassed = true;
	for (const check of checks) {
		const status = check.pass ? '✅' : '❌';
		console.log(`  ${status} ${check.name}`);
		if (!check.pass) allPassed = false;
	}

	console.log('─'.repeat(50));

	if (!allPassed) {
		console.log('\n⚠️  Some verifications failed. Check configuration.\n');
	}
	else {
		console.log('\n✅ All verifications passed!\n');
	}

	saveState();
}

async function displaySummary() {
	state.currentStep = STEPS.COMPLETE;
	state.completedAt = new Date().toISOString();
	saveState();

	console.log('\n' + '='.repeat(60));
	console.log('  DEPLOYMENT COMPLETE');
	console.log('='.repeat(60));
	console.log(`\nEnvironment: ${state.environment}`);
	console.log(`Started:     ${state.startedAt}`);
	console.log(`Completed:   ${state.completedAt}`);

	console.log('\nDeployed Contracts:');
	console.log('─'.repeat(50));
	console.log(`  LAZY Token:           ${state.contracts.lazyToken}`);
	if (state.contracts.lazySCT) {
		console.log(`  LAZY SCT:             ${state.contracts.lazySCT}`);
	}
	console.log(`  LazyGasStation:       ${state.contracts.lazyGasStation}`);
	console.log(`  LazyDelegateRegistry: ${state.contracts.lazyDelegateRegistry}`);
	console.log(`  PRNG:                 ${state.contracts.prng}`);
	console.log(`  LazyLottoStorage:     ${state.contracts.lazyLottoStorage}`);
	console.log(`  LazyLotto:            ${state.contracts.lazyLotto}`);
	console.log(`  LazyLottoPoolManager: ${state.contracts.poolManager}`);
	if (state.contracts.tradeLotto) {
		console.log(`  LazyTradeLotto:       ${state.contracts.tradeLotto}`);
	}
	console.log('─'.repeat(50));

	console.log('\nAdd to .env:');
	console.log('─'.repeat(50));
	console.log(`LAZY_TOKEN_ID=${state.contracts.lazyToken}`);
	if (state.contracts.lazySCT) {
		console.log(`LAZY_SCT_CONTRACT_ID=${state.contracts.lazySCT}`);
	}
	console.log(`LAZY_GAS_STATION_CONTRACT_ID=${state.contracts.lazyGasStation}`);
	console.log(`LAZY_DELEGATE_REGISTRY_CONTRACT_ID=${state.contracts.lazyDelegateRegistry}`);
	console.log(`PRNG_CONTRACT_ID=${state.contracts.prng}`);
	console.log(`LAZY_LOTTO_STORAGE=${state.contracts.lazyLottoStorage}`);
	console.log(`LAZY_LOTTO_CONTRACT_ID=${state.contracts.lazyLotto}`);
	console.log(`LAZY_LOTTO_POOL_MANAGER_ID=${state.contracts.poolManager}`);
	if (state.contracts.tradeLotto) {
		console.log(`LAZY_TRADE_LOTTO_CONTRACT_ID=${state.contracts.tradeLotto}`);
	}
	console.log('─'.repeat(50));

	console.log('\n\u26a0\ufe0f  WARNING: Community pool creation fees default to ZERO after deployment.');
	console.log('   Run setCreationFees.js immediately to set HBAR and LAZY fees.');
	console.log('   Until fees are set, anyone can create community pools for free.\n');

	console.log('Next Steps:');
	console.log('  1. Update .env with the contract IDs above');
	console.log('  2. Run: node scripts/interactions/LazyLotto/admin/setCreationFees.js (CRITICAL - set fees first!)');
	console.log('  3. Run: node scripts/interactions/healthCheck.js');
	console.log('  4. Create lottery pools and add prizes');
	console.log('  5. Fund LazyGasStation with HBAR and LAZY');
	console.log('');

	// Keep state file for reference
	console.log(`State saved to: ${STATE_FILE}`);
	console.log('');
}

// Step ordering for resume
const STEP_ORDER = [
	STEPS.INIT,
	STEPS.LAZY_TOKEN,
	STEPS.GAS_STATION,
	STEPS.DELEGATE_REGISTRY,
	STEPS.PRNG,
	STEPS.STORAGE,
	STEPS.LAZY_LOTTO,
	STEPS.CONFIGURE_STORAGE,
	STEPS.CONFIGURE_GAS_STATION,
	STEPS.POOL_MANAGER,
	STEPS.LINK_POOL_MANAGER,
	STEPS.TRADE_LOTTO,
	STEPS.CONFIGURE_TRADE_LOTTO,
	STEPS.VERIFY,
	STEPS.COMPLETE,
];

async function main() {
	if (showHelp) {
		displayHelp();
		process.exit(0);
	}

	try {
		// Handle resume mode
		if (resumeMode) {
			const savedState = loadState();
			if (savedState) {
				state = savedState;
				console.log(`Resuming from step: ${state.currentStep}`);

				// Reconstruct contract IDs from saved state
				for (const [key, value] of Object.entries(state.contracts)) {
					if (value && typeof value === 'string') {
						if (key === 'lazyToken') {
							state.contracts[key] = TokenId.fromString(value);
						}
						else if (value.startsWith('0.0.')) {
							state.contracts[key] = ContractId.fromString(value);
						}
					}
				}
			}
			else {
				console.log('No saved state found. Starting fresh.');
			}
		}
		else if (!verifyOnly) {
			// Check for existing state file
			if (fs.existsSync(STATE_FILE)) {
				const existingState = loadState();
				if (existingState && existingState.currentStep !== STEPS.COMPLETE) {
					console.log(`\nFound incomplete deployment from ${existingState.startedAt}`);
					console.log(`Last step: ${existingState.currentStep}`);

					if (!nonInteractive) {
						const resume = await prompt('Resume from last checkpoint? (yes/no): ');
						if (resume.toLowerCase() === 'yes' || resume.toLowerCase() === 'y') {
							state = existingState;
							for (const [key, value] of Object.entries(state.contracts)) {
								if (value && typeof value === 'string') {
									if (key === 'lazyToken') {
										state.contracts[key] = TokenId.fromString(value);
									}
									else if (value.startsWith('0.0.')) {
										state.contracts[key] = ContractId.fromString(value);
									}
								}
							}
						}
					}
				}
			}
		}

		await initializeClient();
		loadInterfaces();

		if (verifyOnly) {
			// Load existing contracts from env for verification
			state.contracts.lazyToken = TokenId.fromString(process.env.LAZY_TOKEN_ID);
			state.contracts.lazyLottoStorage = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE);
			state.contracts.lazyLotto = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
			state.contracts.poolManager = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);

			await stepVerify();
			console.log('Verification complete.');
			process.exit(0);
		}

		// Find starting point
		const currentIndex = STEP_ORDER.indexOf(state.currentStep);
		const startIndex = currentIndex >= 0 ? currentIndex : 0;

		// Execute steps from current position
		const stepFunctions = {
			[STEPS.LAZY_TOKEN]: stepLazyToken,
			[STEPS.GAS_STATION]: stepGasStation,
			[STEPS.DELEGATE_REGISTRY]: stepDelegateRegistry,
			[STEPS.PRNG]: stepPRNG,
			[STEPS.STORAGE]: stepStorage,
			[STEPS.LAZY_LOTTO]: stepLazyLotto,
			[STEPS.CONFIGURE_STORAGE]: stepConfigureStorage,
			[STEPS.CONFIGURE_GAS_STATION]: stepConfigureGasStation,
			[STEPS.POOL_MANAGER]: stepPoolManager,
			[STEPS.LINK_POOL_MANAGER]: stepLinkPoolManager,
			[STEPS.TRADE_LOTTO]: stepTradeLotto,
			[STEPS.CONFIGURE_TRADE_LOTTO]: stepConfigureTradeLotto,
			[STEPS.VERIFY]: stepVerify,
		};

		for (let i = startIndex; i < STEP_ORDER.length - 1; i++) {
			const step = STEP_ORDER[i];
			if (step === STEPS.INIT || step === STEPS.COMPLETE) continue;

			const stepFn = stepFunctions[step];
			if (stepFn) {
				await stepFn();
			}
		}

		await displaySummary();
		process.exit(0);
	}
	catch (error) {
		console.error('\nDeployment failed:', error.message);
		state.errors.push({
			step: state.currentStep,
			error: error.message,
			timestamp: new Date().toISOString(),
		});
		saveState();
		console.log(`\nState saved. Use --resume to continue from: ${state.currentStep}`);
		process.exit(1);
	}
}

main();
