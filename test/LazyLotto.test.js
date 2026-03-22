const {
	Client,
	AccountId,
	PrivateKey,
	ContractFunctionParameters,
	TokenId,
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { expect } = require('chai');
const { describe, it, beforeEach, before, after } = require('mocha');
const {
	contractDeployFunction,
	readOnlyEVMFromMirrorNode,
	contractExecuteFunction,
	contractExecuteQuery,
} = require('../utils/solidityHelpers');
const { sleep } = require('../utils/nodeHelpers');
const {
	accountCreator,
	mintFT,
	mintNFT,
	sendFT,
	setFTAllowance,
	sweepHbar,
	sendNFT,
	clearFTAllowances,
	associateTokensToAccount,
	sendHbar,
	setHbarAllowance,
	setNFTAllowanceAll,
} = require('../utils/hederaHelpers');
const {
	checkMirrorBalance,
	checkMirrorHbarBalance,
	getSerialsOwned,
	homebrewPopulateAccountNum,
	EntityType,
} = require('../utils/hederaMirrorHelpers');
const { fail } = require('assert');
const { ethers } = require('ethers');
const { estimateGas } = require('../utils/gasHelpers');
const { parseTransactionRecord } = require('../utils/transactionHelpers');

require('dotenv').config();

// Get operator from .env file
let operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
let operatorId = AccountId.fromString(process.env.ACCOUNT_ID);

// Contract names
const contractName = 'LazyLotto';
const storageContractName = 'LazyLottoStorage';
const lazyContractCreator = 'LAZYTokenCreator';
const prngContractName = 'PrngSystemContract';
const lazyGasStationName = 'LazyGasStation';
const lazyDelegateRegistryName = 'LazyDelegateRegistry';

// Environment setup
const env = process.env.ENVIRONMENT ?? null;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;
const LAZY_BURN_PERCENT = process.env.LOTTO_LAZY_BURN_PERCENT ? Number(process.env.LOTTO_LAZY_BURN_PERCENT) : 50;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// Test Constants (reserved for future test cases)
// const INITIAL_JACKPOT = 100;
// const LOTTO_LOSS_INCREMENT = 50;
const WIN_RATE_THRESHOLD = 50_000_000;
// const MIN_WIN_AMOUNT = 10;
// const MAX_WIN_AMOUNT = 100;
// const JACKPOT_THRESHOLD = 1_000_000;
const ENTRY_FEE_HBAR = 100_000_000;
const ENTRY_FEE_LAZY = 100;

// Contract addresses and IDs
let contractId, contractAddress, storageContractId, storageContractAddress;
let client;

// Test accounts
let alicePK, aliceId, bobPK, bobId, carolPK, carolId;
let adminPK, adminId;

// Dependencies
let lazyTokenId, lazySCT, lazyGasStationId, lazyDelegateRegistryId, prngId, mockPrngId;
let testFungibleTokenId, testNFTTokenId1, testNFTTokenId2;

// Interface objects
// Interface variables
let lazyLottoIface, lazyIface, lazyLottoStorageIface, lazyGasStationIface, poolManagerIface;

// PoolManager references (for bonus management after refactoring)
let poolManagerId;

// Created accounts for cleanup
const createdAccounts = [];
const lazyAllowancesSet = [];

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

describe('LazyLotto - Deployment & Setup:', function () {
	it('Should deploy dependencies and setup test conditions', async function () {
		if (contractName === undefined || contractName == null) {
			console.log('Environment required, please specify CONTRACT_NAME for the test');
			process.exit(1);
		}
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID for the test');
			process.exit(1);
		}

		console.log('\n-Using ENVIRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('testing in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('testing in *MAINNET*');
		}
		else if (env.toUpperCase() == 'PREVIEW') {
			client = Client.forPreviewnet();
			console.log('testing in *PREVIEWNET*');
		}
		else if (env.toUpperCase() == 'LOCAL') {
			const node = { '127.0.0.1:50211': new AccountId(3) };
			client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
			console.log('testing in *LOCAL*');
			const rootId = AccountId.fromString('0.0.2');
			const rootKey = PrivateKey.fromString('302e020100300506032b6570042204203b054fade7a2b0869c6bd4a63b7017cbae7855d12acc357bea718e2c3e805962c');
			client.setOperator(rootId, rootKey);
			operatorId = rootId;
			operatorKey = rootKey;
		}

		client.setOperator(operatorId, operatorKey);
		console.log('\n-Using Operator:', operatorId.toString());

		// Create test accounts: Alice, Bob, Carol, Admin
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(client, alicePK, 250);
		createdAccounts.push({ id: aliceId, key: alicePK });
		console.log('Alice account ID:', aliceId.toString());

		bobPK = PrivateKey.generateED25519();
		bobId = await accountCreator(client, bobPK, 25);
		createdAccounts.push({ id: bobId, key: bobPK });
		console.log('Bob account ID:', bobId.toString());

		carolPK = PrivateKey.generateED25519();
		carolId = await accountCreator(client, carolPK, 25);
		createdAccounts.push({ id: carolId, key: carolPK });
		console.log('Carol account ID:', carolId.toString());

		adminPK = PrivateKey.generateED25519();
		adminId = await accountCreator(client, adminPK, 100);
		createdAccounts.push({ id: adminId, key: adminPK });
		console.log('Admin account ID:', adminId.toString());

		console.log('\n-Test accounts created successfully');
	});

	it('Should deploy or reuse LAZY token and SCT', async function () {
		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/legacy/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);
		lazyIface = new ethers.Interface(lazyJson.abi);

		if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
			lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
			lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
			console.log('\n-Using existing LAZY:', lazyTokenId.toString());
			console.log('-Using existing LSCT:', lazySCT.toString());
		}
		else {
			console.log('\n-Deploying LAZY token and SCT...');
			const lazyConstructorParams = new ContractFunctionParameters()
				.addUint256(LAZY_BURN_PERCENT);

			[lazySCT] = await contractDeployFunction(
				client,
				lazyJson.bytecode,
				3_500_000,
				lazyConstructorParams,
			);

			console.log('Lazy SCT deployed:', lazySCT.toString());

			const mintLazyResult = await contractExecuteFunction(
				lazySCT,
				lazyIface,
				client,
				800_000,
				'createFungibleWithBurn',
				[
					'LAZY',
					'$LAZY',
					'Lazy Superheroes Token',
					LAZY_MAX_SUPPLY,
					LAZY_DECIMAL,
					LAZY_MAX_SUPPLY,
				],
				MINT_PAYMENT,
			);

			if (mintLazyResult[0]?.status?.toString() !== 'SUCCESS') {
				console.log('LAZY token creation failed:', mintLazyResult[0]?.status?.toString());
				fail('LAZY token creation failed');
			}

			lazyTokenId = TokenId.fromSolidityAddress(mintLazyResult[1][0]);
			console.log('LAZY Token created:', lazyTokenId.toString());
		}

		expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazyTokenId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should deploy LazyGasStation', async function () {
		const lazyGasStationJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
			),
		);

		lazyGasStationIface = new ethers.Interface(lazyGasStationJson.abi);

		if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
			lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
			console.log('\n-Using existing LazyGasStation:', lazyGasStationId.toString());
		}
		else {
			console.log('\n-Deploying LazyGasStation...');
			const gasStationConstructorParams = new ContractFunctionParameters()
				.addAddress(lazyTokenId.toSolidityAddress())
				.addAddress(lazySCT.toSolidityAddress());

			[lazyGasStationId] = await contractDeployFunction(
				client,
				lazyGasStationJson.bytecode,
				4_000_000,
				gasStationConstructorParams,
			);
			console.log('LazyGasStation deployed:', lazyGasStationId.toString());
		}

		expect(lazyGasStationId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should deploy LazyDelegateRegistry', async function () {
		const lazyDelegateRegistryJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyDelegateRegistryName}.sol/${lazyDelegateRegistryName}.json`,
			),
		);

		if (process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
			lazyDelegateRegistryId = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
			console.log('\n-Using existing LazyDelegateRegistry:', lazyDelegateRegistryId.toString());
		}
		else {
			console.log('\n-Deploying LazyDelegateRegistry...');
			[lazyDelegateRegistryId] = await contractDeployFunction(
				client,
				lazyDelegateRegistryJson.bytecode,
				2_100_000,
			);
			console.log('LazyDelegateRegistry deployed:', lazyDelegateRegistryId.toString());
		}

		expect(lazyDelegateRegistryId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should deploy PRNG Generator', async function () {
		const prngJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${prngContractName}.sol/${prngContractName}.json`,
			),
		);

		if (process.env.PRNG_CONTRACT_ID) {
			prngId = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
			console.log('\n-Using existing PRNG:', prngId.toString());
		}
		else {
			console.log('\n-Deploying PRNG Generator...');
			[prngId] = await contractDeployFunction(
				client,
				prngJson.bytecode,
				1_800_000,
			);
			console.log('PRNG Generator deployed:', prngId.toString());
		}

		expect(prngId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should deploy MockPrngSystemContract for deterministic testing', async function () {
		console.log('\n-Deploying Mock PRNG for deterministic prize testing...');

		const mockPrngJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/mocks/MockPrngSystemContract.sol/MockPrngSystemContract.json'),
		);

		if (process.env.MOCK_PRNG_CONTRACT_ID) {
			mockPrngId = ContractId.fromString(process.env.MOCK_PRNG_CONTRACT_ID);
			console.log('\n-Using existing Mock PRNG:', mockPrngId.toString());
		}
		else {
			console.log('\n-Deploying Mock PRNG...');

			// Constructor: (bytes32 _seed, uint256 _number)
			// Set staticNumber to 0 to always return the winning index (lo)
			const mockConstructorParams = new ContractFunctionParameters()
				.addBytes32(Buffer.from('0'.repeat(64), 'hex'))
				.addUint256(0);

			[mockPrngId] = await contractDeployFunction(
				client,
				mockPrngJson.bytecode,
				1_000_000,
				mockConstructorParams,
			);

			console.log('Mock PRNG deployed:', mockPrngId.toString());
			expect(mockPrngId.toString().match(addressRegex).length == 2).to.be.true;
		}
	});

	it('Should create test fungible tokens for prizes', async function () {
		console.log('\n-Creating test fungible tokens...');

		if (process.env.TEST_PRIZE_FT_TOKEN_ID) {
			testFungibleTokenId = TokenId.fromString(process.env.TEST_PRIZE_FT_TOKEN_ID);
			console.log('Using existing test FT token:', testFungibleTokenId.toString());
		}
		else {

			const testTokenResult = await mintFT(
				client,
				operatorId,
				null,
				1_000_000,
				'Test Prize Token',
				'TPT',
				2,
			);

			if (testTokenResult[0] !== 'SUCCESS') {
				console.log('Test token creation failed:', testTokenResult[0]);
				fail('Test token creation failed');
			}

			testFungibleTokenId = testTokenResult[1];
			console.log('Test Fungible Token created:', testFungibleTokenId.toString());
		}
	});

	it('Should create test NFT collections for prizes', async function () {
		if (process.env.TEST_PRIZE_NFT_TOKENA_ID) {
			testNFTTokenId1 = TokenId.fromString(process.env.TEST_PRIZE_NFT_TOKENA_ID);
			console.log('Using existing test NFT token A:', testNFTTokenId1.toString());
		}
		else {
			console.log('\n-Creating test NFT collections...');

			const testNFT1Result = await mintNFT(
				client,
				operatorId,
				'Test NFT Collection 1',
				'TNC1',
				10,
				MINT_PAYMENT,
			);

			if (testNFT1Result[0] !== 'SUCCESS') {
				console.log('Test NFT 1 creation failed:', testNFT1Result[0]);
				fail('Test NFT 1 creation failed');
			}

			testNFTTokenId1 = testNFT1Result[1];
			console.log('Test NFT Collection 1 created:', testNFTTokenId1.toString());
		}

		if (process.env.TEST_PRIZE_NFT_TOKENB_ID) {
			testNFTTokenId2 = TokenId.fromString(process.env.TEST_PRIZE_NFT_TOKENB_ID);
			console.log('Using existing test NFT token B:', testNFTTokenId2.toString());
		}
		else {
			const testNFT2Result = await mintNFT(
				client,
				operatorId,
				'Test NFT Collection 2',
				'TNC2',
				5,
				MINT_PAYMENT,
			);

			if (testNFT2Result[0] !== 'SUCCESS') {
				console.log('Test NFT 2 creation failed:', testNFT2Result[0]);
				fail('Test NFT 2 creation failed');
			}

			testNFTTokenId2 = testNFT2Result[1];
			console.log('Test NFT Collection 2 created:', testNFTTokenId2.toString());
		}
	});

	it('Should ensure operator has sufficient tokens', async function () {
		console.log('\n-Ensuring operator has sufficient tokens...');

		// Check and get LAZY if needed
		const operatorLazyBal = await checkMirrorBalance(env, operatorId, lazyTokenId);
		if (operatorLazyBal === null) {
			// need to associate first
			console.log('Operator not associated with LAZY, associating now...');
			await associateTokensToAccount(
				client,
				operatorId,
				operatorKey,
				[lazyTokenId],
			);
		}
		if (!operatorLazyBal || operatorLazyBal < 10000) {
			console.log('Operator needs LAZY, drawing from creator');
			const drawResult = await contractExecuteFunction(
				lazySCT,
				lazyIface,
				client,
				300_000,
				'transferHTS',
				[lazyTokenId.toSolidityAddress(), operatorId.toSolidityAddress(), 10000],
			);
			if (drawResult[0]?.status?.toString() !== 'SUCCESS') {
				console.log('LAZY draw FAILED:', drawResult);
				fail('LAZY draw failed');
			}
			console.log('Drew 10000 LAZY to operator');
		}

		// check the LazyGasStation balance
		const lgsLazyBal = await checkMirrorBalance(env, lazyGasStationId, lazyTokenId);
		if (!lgsLazyBal || lgsLazyBal < 10000) {
			console.log('LazyGasStation needs LAZY, drawing from creator');
			const drawResult = await contractExecuteFunction(
				lazySCT,
				lazyIface,
				client,
				300_000,
				'transferHTS',
				[lazyTokenId.toSolidityAddress(), lazyGasStationId.toSolidityAddress(), 10000],
			);
			if (drawResult[0]?.status?.toString() !== 'SUCCESS') {
				console.log('LAZY draw FAILED:', drawResult);
				fail('LAZY draw failed');
			}
			console.log('Drew 10000 LAZY to operator');
		}

		// check the Lazy Gas Station HBAR balance
		const lgsHbarBal = await checkMirrorHbarBalance(env, lazyGasStationId);
		if (!lgsHbarBal || lgsHbarBal < 5000) {
			console.log('LazyGasStation needs HBAR, sending from operator');
			const sendHbarResult = await sendHbar(
				client,
				operatorId,
				AccountId.fromString(lazyGasStationId.toString()),
				5,
			);
			if (sendHbarResult !== 'SUCCESS') {
				console.log('HBAR send FAILED:', sendHbarResult);
				fail('HBAR send failed');
			}
			console.log('Sent 5 HBAR to LazyGasStation');
		}
	});

	it('Should deploy LazyLottoStorage contract', async function () {
		if (process.env.LAZY_LOTTO_STORAGE) {
			storageContractId = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE);
			storageContractAddress = storageContractId.toSolidityAddress();
		}
		else {
			console.log('\n-Deploying storage contract:', storageContractName);

			const storageBytecode = JSON.parse(
				fs.readFileSync(`./artifacts/contracts/${storageContractName}.sol/${storageContractName}.json`),
			).bytecode;

			lazyLottoStorageIface = new ethers.Interface(JSON.parse(
				fs.readFileSync(`./artifacts/contracts/${storageContractName}.sol/${storageContractName}.json`),
			).abi);

			// Constructor params: (lazyGasStation, lazyToken)
			const storageConstructorParams = new ContractFunctionParameters()
				.addAddress(lazyGasStationId.toSolidityAddress())
				.addAddress(lazyTokenId.toSolidityAddress());

			[storageContractId, storageContractAddress] = await contractDeployFunction(
				client,
				storageBytecode,
				3_500_000,
				storageConstructorParams,
			);
			console.log(`Storage created with ID: ${storageContractId} / ${storageContractAddress}`);

			expect(storageContractId.toString().match(addressRegex).length == 2).to.be.true;
		}
	});

	it('Should deploy LazyLotto contract', async function () {
		client.setOperator(operatorId, operatorKey);

		const json = JSON.parse(
			fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`),
		);

		const contractBytecode = json.bytecode;

		lazyLottoIface = new ethers.Interface(json.abi);

		const gasLimit = 6_000_000;
		// uses ~5,550,000 gas on local node

		console.log('\n-Deploying contract...', contractName, '\n\tgas@', gasLimit);

		// Constructor params: (lazyToken, lazyGasStation, lazyDelegateRegistry, prng, burnPercentage, storageContract)
		const constructorParams = new ContractFunctionParameters()
			.addAddress(lazyTokenId.toSolidityAddress())
			.addAddress(lazyGasStationId.toSolidityAddress())
			.addAddress(lazyDelegateRegistryId.toSolidityAddress())
			.addAddress(prngId.toSolidityAddress())
			.addUint256(LAZY_BURN_PERCENT)
			.addAddress(storageContractAddress);

		[contractId, contractAddress] = await contractDeployFunction(
			client,
			contractBytecode,
			gasLimit,
			constructorParams,
		);

		console.log(`LazyLotto contract created with ID: ${contractId} / ${contractAddress}`);
		console.log('\n-Testing:', contractName);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;

		// Create error decoder array with all relevant interfaces for better error messages
		global.errorInterfaces = [
			lazyLottoIface,
			lazyLottoStorageIface,
			lazyIface,
			lazyGasStationIface,
		];

		// Load ALL available contract interfaces for comprehensive error decoding
		try {
			const abiFiles = [
				'HederaTokenService.json',
				'HederaTokenServiceLite.json',
				'HederaResponseCodes.json',
				'HederaAccountService.json',
				'LazyDelegateRegistry.json',
				'KeyHelperLite.json',
				'PrngSystemContract.json',
			];

			for (const abiFile of abiFiles) {
				try {
					const abiData = JSON.parse(fs.readFileSync(`./abi/${abiFile}`));
					// ABI files can be either { abi: [...] } or just [...]
					const abi = Array.isArray(abiData) ? abiData : abiData.abi;
					const iface = new ethers.Interface(abi);
					global.errorInterfaces.push(iface);
				}
				catch {
					// Skip if ABI file doesn't exist or can't be loaded (silently)
				}
			}
		}
		catch {
			console.log('⚠️  Could not load additional system interfaces for error decoding');
		}

		console.log(`✅ Error decoder configured with ${global.errorInterfaces.length} interfaces`);
	});

	it('Should set LazyLotto as contract user on storage contract', async function () {
		client.setOperator(operatorId, operatorKey);

		await sleep(5000);

		const gasEstimate = await estimateGas(
			env,
			storageContractId,
			lazyLottoStorageIface,
			operatorId,
			'setContractUser',
			[contractAddress],
			500_000,
		);

		// Set LazyLotto as contract user on storage (one-time only)
		const setContractUserResult = await contractExecuteFunction(
			storageContractId,
			lazyLottoStorageIface,
			client,
			gasEstimate.gasLimit,
			'setContractUser',
			[contractAddress],
		);

		if (setContractUserResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('setContractUser FAILED:', setContractUserResult);
			fail('setContractUser failed');
		}

		console.log(parseTransactionRecord(setContractUserResult[2]));

		console.log(`Set LazyLotto (${contractAddress}) as contract user on storage contract`);
		expect(setContractUserResult[0]?.status?.toString()).to.be.equal('SUCCESS');
	});


	it('Should add the storage contract & LazyLotto as contract users on LazyGasStation', async function () {
		client.setOperator(operatorId, operatorKey);
		await sleep(5000);

		const gasEstimate = await estimateGas(
			env,
			lazyGasStationId,
			lazyGasStationIface,
			operatorId,
			'addContractUser',
			[storageContractAddress],
			500_000,
		);

		// Set storage contract as contract user on LazyGasStation (one-time only)
		const setContractUserResult = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			gasEstimate.gasLimit,
			'addContractUser',
			[storageContractAddress],
		);
		if (setContractUserResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('addContractUser FAILED:', setContractUserResult);
			fail('addContractUser failed');
		}
		console.log(parseTransactionRecord(setContractUserResult[2]));

		console.log(`Set storage contract (${storageContractId.toString()}) as contract user on LazyGasStation`);

		const gasEstimate2 = await estimateGas(
			env,
			lazyGasStationId,
			lazyGasStationIface,
			operatorId,
			'addContractUser',
			[contractAddress],
			500_000,
		);

		// Set LazyLotto contract as contract user on LazyGasStation (one-time only)
		const setContractUserResult2 = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			gasEstimate2.gasLimit * 1.1,
			'addContractUser',
			[contractAddress],
		);

		if (setContractUserResult2[0]?.status?.toString() !== 'SUCCESS') {
			console.log('addContractUser FAILED:', setContractUserResult2);
			fail('addContractUser failed');
		}

		console.log(parseTransactionRecord(setContractUserResult2[2]));

		console.log(`Set LazyLotto (${contractAddress}) as contract user on LazyGasStation`);

	});

	it('Should deploy LazyLottoPoolManager for backward compatibility', async function () {
		console.log('\n-Deploying LazyLottoPoolManager for backward compatibility...');

		// Check if already deployed
		if (process.env.LAZY_LOTTO_POOL_MANAGER_ID) {
			poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);
			console.log('-Using existing PoolManager:', poolManagerId.toString());
			console.log('-Skipping deployment');
			return;
		}

		// Load full artifact for deployment (has bytecode)
		const poolManagerArtifact = JSON.parse(
			fs.readFileSync('./artifacts/contracts/LazyLottoPoolManager.sol/LazyLottoPoolManager.json'),
		);

		poolManagerIface = new ethers.Interface(poolManagerArtifact.abi);

		// Deploy PoolManager
		const constructorParams = new ContractFunctionParameters()
			.addAddress(lazyTokenId.toSolidityAddress())
			.addAddress(lazyGasStationId.toSolidityAddress())
			.addAddress(lazyDelegateRegistryId.toSolidityAddress());

		[poolManagerId] = await contractDeployFunction(
			client,
			poolManagerArtifact.bytecode,
			2_500_000,
			constructorParams,
		);

		console.log('LazyLottoPoolManager deployed:', poolManagerId.toString());
		console.log('Contract size:', (poolManagerArtifact.bytecode.length / 2 / 1024).toFixed(3), 'KB');

		// Link PoolManager with LazyLotto (bidirectional)
		console.log('-Linking PoolManager with LazyLotto...');
		const poolManagerAddress = poolManagerId.toSolidityAddress();

		// Set LazyLotto in PoolManager
		const setLazyLottoResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			150_000,
			'setLazyLotto',
			[contractAddress],
		);

		if (setLazyLottoResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('⚠️  Warning: setLazyLotto failed:', setLazyLottoResult);
			console.log('-PoolManager deployed but not linked (can be linked later)');
			return;
		}

		// Set PoolManager in LazyLotto
		const setPoolManagerResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			150_000,
			'setPoolManager',
			[poolManagerAddress],
		);

		if (setPoolManagerResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('⚠️  Warning: setPoolManager failed:', setPoolManagerResult);
			console.log('-PoolManager deployed but not fully linked');
			return;
		}

		console.log('✓ PoolManager deployed and linked successfully');
		console.log('✓ Backward compatibility ensured - bonuses can use PoolManager');
	});
});

describe('LazyLotto - Constructor & Initial State Verification:', function () {
	it('Should verify immutable variables set correctly', async function () {
		client.setOperator(operatorId, operatorKey);

		await sleep(5000);
		// Check LAZY token
		let encodedCommand = lazyLottoIface.encodeFunctionData('lazyToken');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyTokenAddr = lazyLottoIface.decodeFunctionResult('lazyToken', result);
		expect(lazyTokenAddr[0].slice(2).toLowerCase()).to.be.equal(lazyTokenId.toSolidityAddress());

		// Check LazyGasStation
		encodedCommand = lazyLottoIface.encodeFunctionData('lazyGasStation');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyGasStationAddr = lazyLottoIface.decodeFunctionResult('lazyGasStation', result);
		expect(lazyGasStationAddr[0].slice(2).toLowerCase()).to.be.equal(lazyGasStationId.toSolidityAddress());

		// Check LazyDelegateRegistry
		encodedCommand = lazyLottoIface.encodeFunctionData('lazyDelegateRegistry');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const lazyDelegateRegistryAddr = lazyLottoIface.decodeFunctionResult('lazyDelegateRegistry', result);
		expect(lazyDelegateRegistryAddr[0].slice(2).toLowerCase()).to.be.equal(lazyDelegateRegistryId.toSolidityAddress());

		// Check PRNG
		encodedCommand = lazyLottoIface.encodeFunctionData('prng');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const prngAddr = lazyLottoIface.decodeFunctionResult('prng', result);
		expect(prngAddr[0].slice(2).toLowerCase()).to.be.equal(prngId.toSolidityAddress());

		// Check burn percentage
		encodedCommand = lazyLottoIface.encodeFunctionData('burnPercentage');
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const burnPerc = lazyLottoIface.decodeFunctionResult('burnPercentage', result);
		expect(Number(burnPerc[0])).to.be.equal(LAZY_BURN_PERCENT);
	});

	it('Should verify deployer is first admin', async function () {
		client.setOperator(operatorId, operatorKey);

		const encodedCommand = lazyLottoIface.encodeFunctionData('isAdmin', [operatorId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const isAdmin = lazyLottoIface.decodeFunctionResult('isAdmin', result);
		expect(isAdmin[0]).to.be.true;
	});

	it('Should verify initial state values', async function () {
		client.setOperator(operatorId, operatorKey);

		// Check total pools is 0
		let encodedCommand = lazyLottoIface.encodeFunctionData('totalPools');
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', result);
		expect(Number(totalPools[0])).to.be.equal(0);

		// Check time bonuses is 0 (now in PoolManager)
		encodedCommand = poolManagerIface.encodeFunctionData('totalTimeBonuses');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalTimeBonuses = poolManagerIface.decodeFunctionResult('totalTimeBonuses', result);
		expect(Number(totalTimeBonuses[0])).to.be.equal(0);

		// Check NFT bonus tokens is 0 (now in PoolManager)
		encodedCommand = poolManagerIface.encodeFunctionData('totalNFTBonusTokens');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalNFTBonusTokens = poolManagerIface.decodeFunctionResult('totalNFTBonusTokens', result);
		expect(Number(totalNFTBonusTokens[0])).to.be.equal(0);
	});
});

describe('LazyLotto - Admin Management:', function () {
	it('Should add new admin', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'addAdmin',
			[adminId.toSolidityAddress()],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addAdmin',
			[adminId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Admin addition failed:', result[0]?.status?.toString());
			fail('Admin addition failed');
		}

		console.log('-Admin addition tx:', result[2]?.transactionId?.toString());

		// Wait for mirror node
		await sleep(5000);

		// Verify admin was added
		const encodedCommand = lazyLottoIface.encodeFunctionData('isAdmin', [adminId.toSolidityAddress()]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const isAdmin = lazyLottoIface.decodeFunctionResult('isAdmin', queryResult);
		expect(isAdmin[0]).to.be.true;
	});

	it('Should prevent non-admin from adding admin', async function () {
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				300_000,
				'addAdmin',
				[bobId.toSolidityAddress()],
			);

			if (result[0]?.status.name != 'NotAdmin') {
				console.log('Configuration update succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('-Non-admin prevented from adding admin');
	});

	it('Should prevent removing last admin', async function () {
		client.setOperator(operatorId, operatorKey);

		await sleep(5000);

		// First remove the admin we added, leaving only operator
		let gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'removeAdmin',
			[adminId.toSolidityAddress()],
			300_000,
		);

		const removeResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit * 1.5,
			'removeAdmin',
			[adminId.toSolidityAddress()],
		);

		if (removeResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Admin removal failed:', removeResult[0]?.status?.toString());
			fail('Admin removal failed');
		}

		console.log('-Admin removed successfully');

		// Now try to remove the last admin (operator)
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'removeAdmin',
				[operatorId.toSolidityAddress()],
			);

			if (result[0]?.status?.name != 'LastAdminError') {
				console.log('Expected failure but got:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (err) {
			console.log('Unexpected Error:', err);
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('-Last admin removal prevented');

		// fresh gas estimate
		gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'addAdmin',
			[adminId.toSolidityAddress()],
			500_000,
		);

		// Re-add admin for future tests
		const readdResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit * 1.5,
			'addAdmin',
			[adminId.toSolidityAddress()],
		);

		if (readdResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Re-adding admin failed:', readdResult);
			fail('Failed to re-add admin for future tests');
		}
	});
});

describe('LazyLotto - Token Association & Setup:', function () {
	it('Should associate tokens to test accounts', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		// Parallelize token associations
		const associationPromises = testAccounts.map(async (account) => {
			client.setOperator(account.id, account.key);

			// Associate tokens
			const assocResult = await associateTokensToAccount(
				client,
				account.id,
				account.key,
				[lazyTokenId, testFungibleTokenId, testNFTTokenId1, testNFTTokenId2],
			);
			expect(assocResult).to.be.equal('SUCCESS');
			console.log(`Associated tokens to ${account.id.toString()}`);
			return assocResult;
		});

		await Promise.all(associationPromises);
	});

	it('Should send tokens to test accounts', async function () {
		client.setOperator(operatorId, operatorKey);

		const testAccounts = [aliceId, bobId, carolId, adminId];

		// Parallelize token distribution across accounts
		const distributionPromises = testAccounts.map(async (accountId) => {
			// Send LAZY tokens
			let result = await sendLazy(accountId, 5000);
			if (result !== 'SUCCESS') {
				console.log(`LAZY send failed for ${accountId.toString()}:`, result);
				throw new Error('LAZY send failed');
			}

			// Send test fungible tokens
			result = await sendFT(
				client,
				testFungibleTokenId,
				1000,
				operatorId,
				accountId,
				'Test token transfer',
			);
			if (result !== 'SUCCESS') {
				console.log(`Test token send failed for ${accountId.toString()}:`, result);
				throw new Error('Test token send failed');
			}

			// Send some test NFTs - each account gets serial 1-4 respectively
			// (Alice gets 1, Bob gets 2, Carol gets 3, Admin gets 4)
			const accountIndex = testAccounts.indexOf(accountId);
			const serialToSend = accountIndex + 1;
			result = await sendNFT(client, operatorId, accountId, testNFTTokenId1, [serialToSend]);
			if (result !== 'SUCCESS') {
				console.log(`Test NFT send failed for ${accountId.toString()}:`, result);
				throw new Error('Test NFT send failed');
			} return accountId;
		});

		await Promise.all(distributionPromises);

		console.log('\n-Tokens distributed to test accounts');
	});

	it('Should set LAZY allowances to LazyGasStation for test accounts', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		// Parallelize allowance setting
		const allowancePromises = testAccounts.map(async (account) => {
			client.setOperator(account.id, account.key);

			const allowanceResult = await setFTAllowance(
				client,
				lazyTokenId,
				account.id,
				lazyGasStationId,
				2000,
			);
			if (allowanceResult !== 'SUCCESS') {
				console.log(`LAZY allowance failed for ${account.id.toString()}:`, allowanceResult);
				throw new Error('LAZY allowance failed');
			}
			lazyAllowancesSet.push(account);
			return account;
		});

		await Promise.all(allowancePromises);

		console.log('\n-LAZY allowances set to LazyGasStation');
	});

	it('Should set HBAR allowances to LazyLottoStorage contract for NFT operations', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
			{ id: operatorId, key: operatorKey },
		];

		// Parallelize HBAR distribution
		const hbarPromises = testAccounts.map(async (account) => {
			client.setOperator(account.id, account.key);

			// Send small HBAR allowance for NFT operations
			const allowanceResult = await setHbarAllowance(
				client,
				account.id,
				storageContractId,
				20,
				HbarUnit.Hbar,
			);

			if (allowanceResult !== 'SUCCESS') {
				console.log(`HBAR allowance failed for ${account.id.toString()}:`, allowanceResult);
				throw new Error('HBAR allowance failed');
			}
			return account;
		});

		await Promise.all(hbarPromises);

		console.log('\n-HBAR Allowances set for accounts for NFT operations to LazyLottoStorage contract');
	});

	it('Should set test fungible token allowances to lazyLottoStorage contract', async function () {
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		// Parallelize allowance setting
		const allowancePromises = testAccounts.map(async (account) => {
			client.setOperator(account.id, account.key);

			const allowanceResult = await setFTAllowance(
				client,
				testFungibleTokenId,
				account.id,
				storageContractId,
				2000,
			);
			if (allowanceResult !== 'SUCCESS') {
				console.log(`Test FT allowance failed for ${account.id.toString()}:`, allowanceResult);
				throw new Error('Test FT allowance failed');
			}
			return account;
		});

		await Promise.all(allowancePromises);

		console.log('\n-Test fungible token allowances set to LazyLottoStorage contract');
	});
});

// Helper function to send LAZY tokens
async function sendLazy(receiverId, amt) {
	const result = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		300_000,
		'transferHTS',
		[lazyTokenId.toSolidityAddress(), receiverId.toSolidityAddress(), amt],
	);
	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.log('LAZY transfer failed:', result[0]?.status?.toString());
		return result[0]?.status?.toString();
	}
	return result[0]?.status.toString();
}

describe('LazyLotto - Pool Creation:', function () {
	it('Should create first lottery pool with HBAR fee', async function () {
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'createPool',
			[
				'Test Pool 1',
				'TP1',
				'Test pool memo',
				// No royalties
				[],
				'QmTestTicketCID',
				'QmTestWinCID',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				// HBAR fee
				ZERO_ADDRESS,
			],
			3_000_000,
			Number(new Hbar(MINT_PAYMENT, HbarUnit.Hbar).toTinybars()),
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'createPool',
			[
				'Test Pool 1',
				'TP1',
				'Test pool memo',
				// No royalties
				[],
				'QmTestTicketCID',
				'QmTestWinCID',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				// HBAR fee
				ZERO_ADDRESS,
			],
			new Hbar(MINT_PAYMENT, HbarUnit.Hbar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Pool creation failed:', result[0]?.status?.toString());
			fail('Pool creation failed');
		}

		console.log('-Pool creation tx:', result[2]?.transactionId?.toString());

		// get the poolId from the 2nd element of the result array
		const poolId = Number(result[1][0]);
		console.log('-Created Pool ID:', poolId);

		// Wait for mirror node
		await sleep(5000);

		// Verify pool was created
		const encodedCommand = lazyLottoIface.encodeFunctionData('totalPools');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', queryResult);
		expect(Number(totalPools[0])).to.be.equal(1);

		// Get pool details
		const poolCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
		const poolResult = await readOnlyEVMFromMirrorNode(env, contractId, poolCommand, operatorId, false);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', poolResult);

		const [ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenId, paused, closed, feeToken] = poolDetails;
		console.log(`-- Ticket CID: ${ticketCID}`);
		console.log(`-- Win CID: ${winCID}`);
		console.log(`-- Win Rate Threshold: ${winRate}`);
		console.log(`-- Entry Fee: ${entryFee.toString()}`);
		console.log(`-- Prize Count: ${prizeCount}`);
		console.log(`-- Outstanding Tickets: ${outstanding}`);
		console.log(`-- Pool Token ID: ${poolTokenId}`);
		console.log(`-- Paused: ${paused}`);
		console.log(`-- Closed: ${closed}`);
		console.log(`-- Fee Token: ${feeToken}`);
		expect(entryFee.toString()).to.be.equal(ENTRY_FEE_HBAR.toString());
		expect(feeToken).to.be.equal(ZERO_ADDRESS);
		expect(closed).to.be.false;
		expect(paused).to.be.false;

		// Store the ticket token ID for future tests
		const ticketTokenId = TokenId.fromSolidityAddress(poolTokenId);
		console.log('Pool NFT collection created:', ticketTokenId.toString());

		// need to associate the ticket token to all the accounts used in testing including operator and admin
		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		// Parallelize token associations
		const associationPromises = testAccounts.map(async (account) => {
			client.setOperator(account.id, account.key);

			// Associate tokens
			const assocResult = await associateTokensToAccount(
				client,
				account.id,
				account.key,
				[ticketTokenId],
			);
			expect(assocResult).to.be.equal('SUCCESS');
			console.log(`Associated ticket Token to ${account.id.toString()}`);
			return assocResult;
		});

		await Promise.all(associationPromises);
	});

	it.skip('Should prevent non-admin from creating pool [DISABLED: Community pools now allow anyone to create]', async function () {
		// This test is obsolete - community pool creation is now open to all users
		// The feature intentionally changed with the introduction of LazyLottoPoolManager
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				3_000_000,
				'createPool',
				[
					'Unauthorized Pool',
					'UP',
					'Should fail',
					[],
					'QmFailCID',
					'QmFailWinCID',
					WIN_RATE_THRESHOLD,
					ENTRY_FEE_HBAR,
					ZERO_ADDRESS,
				],
				new Hbar(MINT_PAYMENT, HbarUnit.Hbar),
			);

			if (result[0]?.status?.name != 'NotAdmin') {
				console.log('Pool Create succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		console.log('-Non-admin prevented from creating pool');
	});

	it('Should create second pool with $LAZY fee', async function () {
		client.setOperator(adminId, adminPK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'createPool',
			[
				'LAZY Pool',
				'LP',
				'LAZY fee pool',
				[],
				'QmLazyTicketCID',
				'QmLazyWinCID',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_LAZY,
				lazyTokenId.toSolidityAddress(),
			],
			3_000_000,
			Number(new Hbar(MINT_PAYMENT, HbarUnit.Hbar).toTinybars()),
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'createPool',
			[
				'LAZY Pool',
				'LP',
				'LAZY fee pool',
				[],
				'QmLazyTicketCID',
				'QmLazyWinCID',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_LAZY,
				lazyTokenId.toSolidityAddress(),
			],
			new Hbar(MINT_PAYMENT, HbarUnit.Hbar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('LAZY pool creation failed:', result[0]?.status?.toString());
			fail('LAZY pool creation failed');
		}

		console.log('-LAZY pool creation tx:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// Verify we now have 2 pools
		const encodedCommand = lazyLottoIface.encodeFunctionData('totalPools');
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', queryResult);
		expect(Number(totalPools[0])).to.be.equal(2);

		console.log('-LAZY pool created successfully');
	});
});

describe('LazyLotto - Prize Management:', function () {
	it('Should add HBAR prize package', async () => {
		const prizeAmount = new Hbar(5).toTinybars();
		const nftTokens = [];
		const nftSerials = [];

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for adding HBAR prize package
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'addPrizePackage',
			[0, ZERO_ADDRESS, Number(prizeAmount), nftTokens, nftSerials],
			800_000,
			Number(prizeAmount),
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addPrizePackage',
			[0, ZERO_ADDRESS, Number(prizeAmount), nftTokens, nftSerials],
			new Hbar(prizeAmount, HbarUnit.Tinybar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('HBAR prize package addition failed:', result[0]?.status?.toString());
			fail('HBAR prize package addition failed');
		}

		console.log('\t✓ Added HBAR prize package successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());
	});

	it('Should add LAZY token prize package', async () => {
		const prizeAmount = 1000;
		const nftTokens = [];
		const nftSerials = [];

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for adding LAZY token prize package
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'addPrizePackage',
			[0, lazyTokenId.toSolidityAddress(), prizeAmount, nftTokens, nftSerials],
			800_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addPrizePackage',
			[0, lazyTokenId.toSolidityAddress(), prizeAmount, nftTokens, nftSerials],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('LAZY token prize package addition failed:', result[0]?.status?.toString());
			fail('LAZY token prize package addition failed');
		}

		console.log('\t✓ Added LAZY token prize package successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());
	});

	it('Should add multiple fungible prizes', async () => {
		const amounts = [50, 75, 100];

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for adding multiple fungible prizes
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'addMultipleFungiblePrizes',
			[1, testFungibleTokenId.toSolidityAddress(), amounts],
			800_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addMultipleFungiblePrizes',
			[1, testFungibleTokenId.toSolidityAddress(), amounts],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Multiple fungible prizes addition failed:', result[0]?.status?.toString());
			fail('Multiple fungible prizes addition failed');
		}

		console.log('\t✓ Added multiple fungible prizes successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());
	});
});

describe('LazyLotto - Prize Package Getter:', function () {
	it('Should retrieve specific prize package from pool', async () => {
		// wait for mirror node indexing
		await sleep(5000);

		try {
			// We know from previous tests that poolId 0 has at least 2 prizes added
			// (HBAR prize and LAZY prize)

			// Get the first prize package (HBAR prize)
			const encodedCommand = lazyLottoIface.encodeFunctionData('getPrizePackage', [0, 0]);
			const prizePackage0Result = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				encodedCommand,
				operatorId,
				false,
			);
			const prizePackage0 = lazyLottoIface.decodeFunctionResult('getPrizePackage', prizePackage0Result)[0];

			console.log('\t✓ Successfully retrieved HBAR prize package');
			console.log(`\t  Token: ${prizePackage0?.token === ZERO_ADDRESS ? 'HBAR' : prizePackage0?.token}`);
			console.log(`\t  Amount: ${prizePackage0?.amount}`);

			expect(prizePackage0).to.exist;
			// HBAR prize
			expect(prizePackage0.token).to.equal(ZERO_ADDRESS);
			expect(Number(prizePackage0.amount)).to.equal(Number(new Hbar(5).toTinybars()));

			// Get the second prize package (LAZY prize)
			const encodedCommand2 = lazyLottoIface.encodeFunctionData('getPrizePackage', [0, 1]);
			const prizePackage1Result = await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				encodedCommand2,
				operatorId,
				false,
			);
			const prizePackage1 = lazyLottoIface.decodeFunctionResult('getPrizePackage', prizePackage1Result)[0];

			console.log('\t✓ Successfully retrieved LAZY prize package');
			console.log(`\t  Token: ${prizePackage1?.token}`);
			console.log(`\t  Amount: ${prizePackage1?.amount}`);

			expect(prizePackage1).to.exist;
			expect(prizePackage1.token.slice(2).toLowerCase()).to.equal(lazyTokenId.toSolidityAddress());
			expect(Number(prizePackage1.amount)).to.equal(1000);
		}
		catch (error) {
			console.log('\t✗ Failed to retrieve prize package:', error.message);
			fail('Prize package retrieval failed');
		}
	});

	it('Should revert when requesting prize package from invalid pool', async () => {
		const invalidPoolId = 999;
		let unexpectedErrors = 0;

		try {
			const encodedCommand = lazyLottoIface.encodeFunctionData('getPrizePackage', [invalidPoolId, 0]);
			await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				encodedCommand,
				operatorId,
				false,
			);
			const decoded = lazyLottoIface.decodeFunctionResult('getPrizePackage', encodedCommand);
			console.log('\t✗ Should have reverted for invalid pool, got:', decoded);
			unexpectedErrors++;
		}
		catch (error) {
			if (error.message.includes('LottoPoolNotFound') || error.message.includes('revert') || error.message.includes('Request failed with status code 400')) {
				console.log('\t✓ Correctly reverted for invalid pool');
			}
			else {
				console.log('\t✗ Unexpected error:', error.message);
				unexpectedErrors++;
			}
		}

		if (unexpectedErrors > 0) {
			fail('Invalid pool test failed');
		}
	});

	it('Should revert when requesting prize package with invalid index', async () => {
		const invalidPrizeIndex = 999;
		let unexpectedErrors = 0;

		try {
			const encodedCommand = lazyLottoIface.encodeFunctionData('getPrizePackage', [0, invalidPrizeIndex]);
			await readOnlyEVMFromMirrorNode(
				env,
				contractId,
				encodedCommand,
				operatorId,
				false,
			);
			console.log('\t✗ Should have reverted for invalid prize index');
			unexpectedErrors++;
		}
		catch (error) {
			if (error.message.includes('BadParameters') || error.message.includes('revert') || error.message.includes('Request failed with status code 400')) {
				console.log('\t✓ Correctly reverted for invalid prize index');
			}
			else {
				console.log('\t✗ Unexpected error:', error.message);
				unexpectedErrors++;
			}
		}

		if (unexpectedErrors > 0) {
			fail('Invalid prize index test failed');
		}
	});

	it('Should add PrizeManager role to Alice to allow NFT prize package addition', async () => {
		client.setOperator(operatorId, operatorKey);
		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			operatorId,
			'addGlobalPrizeManager',
			[aliceId.toSolidityAddress()],
			500_000,
		);

		const result = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'addGlobalPrizeManager',
			[aliceId.toSolidityAddress()],
		);
		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Add PrizeManager role failed:', result[0]);
			fail('Add PrizeManager role failed');
		}

		await sleep(5000);
		// check that Alice is now a PrizeManager
		const encodedCommand = poolManagerIface.encodeFunctionData('isGlobalPrizeManager', [aliceId.toSolidityAddress()]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const isPrizeManager = poolManagerIface.decodeFunctionResult('isGlobalPrizeManager', queryResult);
		expect(isPrizeManager[0]).to.be.true;

		console.log('\t✓ Added PrizeManager role to Alice');
	});

	it('Should retrieve prize package with NFT contents', async () => {
		// Use Alice who owns serial 1 of testNFTTokenId1
		client.setOperator(aliceId, alicePK);

		// First, add a prize package with NFTs for testing
		const prizeAmount = 0;
		const nftTokens = [testNFTTokenId1.toSolidityAddress()];
		// Alice owns serial 1
		const nftSerials = [[1]];

		// need to ensure we have an NFT allowance to the storage contract for this
		const allowance = await setNFTAllowanceAll(
			client,
			[testNFTTokenId1],
			aliceId,
			AccountId.fromString(storageContractId.toString()),
		);

		expect(allowance).to.equal('SUCCESS');

		// Estimate gas for adding NFT prize package
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'addPrizePackage',
			[0, ZERO_ADDRESS, prizeAmount, nftTokens, nftSerials],
			1_500_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addPrizePackage',
			[0, ZERO_ADDRESS, prizeAmount, nftTokens, nftSerials],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('NFT prize package addition failed:', result[0]?.status?.toString());
			fail('NFT prize package addition failed');
		}

		console.log('\t✓ Added NFT prize package successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

		// Sleep to allow mirror node to update
		await sleep(5000);

		// Now retrieve the prize count
		const poolDetailsCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [0]);
		const poolDetailsResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			poolDetailsCommand,
			operatorId,
			false,
		);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', poolDetailsResult);

		const lastPrizeIndex = Number(poolDetails[4]) - 1;
		// prizeCount is at index 4

		const nftPrizeCommand = lazyLottoIface.encodeFunctionData('getPrizePackage', [0, lastPrizeIndex]);
		const nftPrizeResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			nftPrizeCommand,
			operatorId,
			false,
		);
		const nftPrizePackage = lazyLottoIface.decodeFunctionResult('getPrizePackage', nftPrizeResult)[0];

		expect(nftPrizePackage).to.exist;
		expect(nftPrizePackage.nftTokens).to.have.lengthOf(1);
		expect(nftPrizePackage.nftTokens[0].slice(2).toLowerCase()).to.equal(testNFTTokenId1.toSolidityAddress());
		expect(nftPrizePackage.nftSerials).to.have.lengthOf(1);
		expect(nftPrizePackage.nftSerials[0]).to.have.lengthOf(1);
		expect(Number(nftPrizePackage.nftSerials[0][0])).to.equal(1);
		console.log('\t✓ Successfully retrieved NFT prize package');
		console.log(`\t  NFT Token: ${testNFTTokenId1.toString()}`);
		console.log(`\t  NFT Serials: ${Number(nftPrizePackage.nftSerials[0])}`);
	});

	it('Should remove PrizeManager role from Alice', async () => {
		client.setOperator(operatorId, operatorKey);
		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			operatorId,
			'removeGlobalPrizeManager',
			[aliceId.toSolidityAddress()],
			500_000,
		);
		const result = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'removeGlobalPrizeManager',
			[aliceId.toSolidityAddress()],
		);
		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Remove PrizeManager role failed:', result[0]);
			fail('Remove PrizeManager role failed');
		}
		console.log('\t✓ Removed PrizeManager role from Alice');
	});
});

describe('LazyLotto - Ticket Purchase and Rolling:', function () {
	it('Should purchase HBAR fee pool ticket and handle rolling', async () => {
		const entryFee = ENTRY_FEE_HBAR;
		const ticketCount = 1;
		const poolId = 0;

		// Set Alice as operator
		client.setOperator(aliceId, alicePK);

		// Estimate gas for buying entry with HBAR payment
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'buyEntry',
			[poolId, ticketCount],
			1_000_000,
			Number(entryFee),
		);

		// Purchase ticket
		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'buyEntry',
			[poolId, ticketCount],
			new Hbar(entryFee, HbarUnit.Tinybar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Ticket purchase failed:', result[0]?.status?.toString());
			fail('Ticket purchase failed');
		}

		console.log('\t✓ Ticket purchase successful');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());
	});

	it('Should try to buy a ticket with insufficient HBAR', async () => {
		const insufficientEntryFee = new Hbar(0.0001).toTinybars();
		const ticketCount = 1;
		const poolId = 0;
		let unexpectedErrors = 0;

		// Set Alice as operator
		client.setOperator(aliceId, alicePK);
		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				1_000_000,
				'buyEntry',
				[poolId, ticketCount],
				new Hbar(insufficientEntryFee, HbarUnit.Tinybar),
			);
			if (result[0]?.status?.name != 'NotEnoughHbar') {
				console.log('Expected failure but got:', result);
				unexpectedErrors++;
			}
		}
		catch (error) {
			console.log('Error occurred while buying ticket:', error);
			unexpectedErrors++;
		}
		expect(unexpectedErrors).to.be.equal(0);
		console.log('\t✓ Insufficient HBAR payment prevented ticket purchase');
	});

	it('Should buyAndRedeemEntry in a single transaction', async () => {
		const entryFee = ENTRY_FEE_HBAR;
		const ticketCount = 1;
		const poolId = 0;

		// Set Carol as operator
		client.setOperator(carolId, carolPK);
		// Estimate gas for buyAndRedeemEntry
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			carolId,
			'buyAndRedeemEntry',
			[poolId, ticketCount],
			1_500_000,
			Number(entryFee),
		);

		// Purchase and redeem ticket
		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'buyAndRedeemEntry',
			[poolId, ticketCount],
			new Hbar(entryFee, HbarUnit.Tinybar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('buyAndRedeemEntry failed:', result[0]?.status?.toString());
			fail('buyAndRedeemEntry failed');
		}
		console.log('\t✓ buyAndRedeemEntry successful');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

		await sleep(5000);

		// get the ticket token ID for poolId 0
		const poolDetailsCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
		const poolDetailsResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			poolDetailsCommand,
			operatorId,
			false,
		);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', poolDetailsResult);
		const ticketTokenId = TokenId.fromSolidityAddress(poolDetails[6]);
		// poolTokenId is at index 6

		// check if the NFT ticket was minted
		const carolBalance = await checkMirrorBalance(env, carolId.toString(), ticketTokenId.toString());
		expect(carolBalance).to.be.greaterThan(0);
		console.log('\t✓ NFT ticket minted to Carol');
	});

	it('Should rollWithNFT tickets', async () => {
		const poolId = 0;
		// Set Carol as operator
		client.setOperator(carolId, carolPK);

		// setup an allowance for the ticket token back to the contract
		const poolDetailsCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [poolId]);
		const poolDetailsResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			poolDetailsCommand,
			operatorId,
			false,
		);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', poolDetailsResult);

		// Approve the ticket token for the storage contract (wipes happen via storage)
		const ticketTokenId = TokenId.fromSolidityAddress(poolDetails[6]);
		// poolTokenId is at index 6
		const allowanceResult = await setNFTAllowanceAll(
			client,
			[ticketTokenId],
			carolId,
			AccountId.fromString(storageContractId.toString()),
		);
		expect(allowanceResult).to.equal('SUCCESS');

		console.log('\t✓ Ticket token approved for storage contract');

		// get the serials Carol owns for the ticket token
		const carolNFTs = await getSerialsOwned(env, carolId, ticketTokenId);
		console.log(`\t  Carol owns ticket serials: ${carolNFTs}`);

		expect(carolNFTs.length).to.be.greaterThan(0);

		// Estimate gas for rolling with NFT tickets
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			carolId,
			'rollWithNFT',
			[poolId, [carolNFTs[0]]],
			2_500_000,
		);

		// Roll tickets
		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit * 2,
			'rollWithNFT',
			[poolId, [carolNFTs[0]]],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('rollWithNFT failed:', result[0]?.status?.toString());
			fail('rollWithNFT failed');
		}

		console.log('\t✓ rollWithNFT successful');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

		// check for wins
		console.log('\n-Checking for wins for Carol:', result[1]);
		const wins = Number(result[1][0]);
		const offset = Number(result[1][1]);

		if (wins) {
			console.log(`\t✓ User won ${wins} tickets starting from offset ${offset}`);
		}
		else {
			console.log('\t✗ User did not win any tickets');
		}

		await sleep(5000);

		// check if the NFT ticket was burned
		const carolBalance = await checkMirrorBalance(env, carolId.toString(), ticketTokenId.toString());
		expect(carolBalance).to.be.equal(0);
		console.log('\t✓ NFT ticket burned after rolling');
	});

	it('Should purchase LAZY fee pool ticket', async () => {
		const lazyPoolId = 1;
		const ticketCount = 1;

		// Set Bob as operator
		client.setOperator(bobId, bobPK);

		// Estimate gas for buying entry with LAZY tokens
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			bobId,
			'buyEntry',
			[lazyPoolId, ticketCount],
			1_000_000,
		);

		// Purchase ticket with LAZY tokens
		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'buyEntry',
			[lazyPoolId, ticketCount],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('LAZY ticket purchase failed:', result[0]?.status?.toString());
			fail('LAZY ticket purchase failed');
		}

		console.log('\t✓ LAZY ticket purchase successful');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());
	});
});

describe('LazyLotto - Bonus System Tests:', function () {
	it('Should set and verify LAZY balance bonus', async () => {
		const threshold = 1000;
		const bonusBps = 500;

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for setting LAZY balance bonus (now in PoolManager)
		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'setLazyBalanceBonus',
			[threshold, bonusBps],
			300_000,
		);

		// Set LAZY balance bonus
		const result = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setLazyBalanceBonus',
			[threshold, bonusBps],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('LAZY balance bonus setup failed:', result[0]?.status?.toString());
			fail('LAZY balance bonus setup failed');
		}

		console.log('\t✓ LAZY balance bonus set successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

		// Wait for mirror node
		await sleep(5000);

		// Query to verify the bonus was set (now in PoolManager)
		const thresholdQuery = poolManagerIface.encodeFunctionData('lazyBalanceThreshold', []);
		const thresholdResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, thresholdQuery, operatorId, false);
		const thresholdValue = poolManagerIface.decodeFunctionResult('lazyBalanceThreshold', thresholdResult);

		const bonusQuery = poolManagerIface.encodeFunctionData('lazyBalanceBonusBps', []);
		const bonusResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, bonusQuery, operatorId, false);
		const bonusValue = poolManagerIface.decodeFunctionResult('lazyBalanceBonusBps', bonusResult);

		expect(thresholdValue[0].toString()).to.equal(threshold.toString());
		expect(bonusValue[0].toString()).to.equal(bonusBps.toString());
		console.log('\t📊 LAZY balance bonus verified:', { threshold: thresholdValue[0].toString(), bonus: bonusValue[0].toString() + ' bps' });
	});

	it('Should set and verify NFT holding bonus', async () => {
		const bonusBps = 750;

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for setting NFT bonus (now in PoolManager)
		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'setNFTBonus',
			[testNFTTokenId1.toSolidityAddress(), bonusBps],
			300_000,
		);

		// Set NFT bonus using one of our test NFT tokens
		const result = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setNFTBonus',
			[testNFTTokenId1.toSolidityAddress(), bonusBps],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('NFT bonus setup failed:', result[0]?.status?.toString());
			fail('NFT bonus setup failed');
		}

		console.log('\t✓ NFT bonus set successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

		// Wait for mirror node
		await sleep(5000);

		// Query to verify the NFT bonus was set (now in PoolManager)
		const bonusQuery = poolManagerIface.encodeFunctionData('nftBonusBps', [testNFTTokenId1.toSolidityAddress()]);
		const bonusResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, bonusQuery, operatorId, false);
		const bonusValue = poolManagerIface.decodeFunctionResult('nftBonusBps', bonusResult);

		expect(bonusValue[0].toString()).to.equal(bonusBps.toString());
		console.log('\t📊 NFT bonus verified for token', testNFTTokenId1.toString(), ':', bonusValue[0].toString() + ' bps');
	});

	it('Should set and verify time-based bonus', async () => {
		const currentTime = Math.floor(Date.now() / 1000);
		const startTime = currentTime + 60;
		const endTime = currentTime + 3600;
		const bonusBps = 1000;

		// Set admin as operator
		client.setOperator(adminId, adminPK);

		// Estimate gas for setting time bonus (now in PoolManager)
		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'setTimeBonus',
			[startTime, endTime, bonusBps],
			300_000,
		);

		// Set time bonus
		const result = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setTimeBonus',
			[startTime, endTime, bonusBps],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Time bonus setup failed:', result[0]?.status?.toString());
			fail('Time bonus setup failed');
		}

		console.log('\t✓ Time bonus set successfully');
		console.log('\t  Transaction ID:', result[2]?.transactionId?.toString());

		// Wait for mirror node
		await sleep(5000);

		// Query to verify the time bonus was set (now in PoolManager)
		const bonusQuery = poolManagerIface.encodeFunctionData('timeBonuses', [0]);
		const bonusResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, bonusQuery, operatorId, false);
		const bonusValue = poolManagerIface.decodeFunctionResult('timeBonuses', bonusResult);

		expect(Number(bonusValue[0])).to.equal(startTime);
		expect(Number(bonusValue[1])).to.equal(endTime);
		expect(Number(bonusValue[2])).to.equal(bonusBps);
		console.log('\t📊 Time bonus verified:', {
			start: new Date(startTime * 1000).toISOString(),
			end: new Date(endTime * 1000).toISOString(),
			bonus: bonusBps + ' bps',
		});
	});

	it('Should calculate combined bonuses correctly', async () => {
		console.log('\n\t🔄 BONUS STACKING ANALYSIS TEST');
		console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

		try {
			// Set up multiple bonuses for comprehensive stacking test
			const lazyThreshold = 500;
			const lazyBonus = 1000;
			const nftBonus = 750;
			const timeBonus = 500;
			// Total expected: 22.5% (2250 bps → 22,500,000 scaled bps)

			console.log('\t📋 Setting up bonus stacking scenario:');
			console.log('\t   • LAZY Balance Bonus: 10% (1000 bps) for 500+ LAZY');
			console.log('\t   • NFT Holding Bonus: 7.5% (750 bps) for test NFT');
			console.log('\t   • Time Bonus: 5% (500 bps) for active window');
			console.log('\t   • Expected Total: 22.5% (2250 bps → 22,500,000 scaled)');

			// Configure all bonus types with proper gas estimation
			client.setOperator(adminId, adminPK);

			let gasEstimate = await estimateGas(
				env,
				poolManagerId,
				poolManagerIface,
				adminId,
				'setLazyBalanceBonus',
				[lazyThreshold, lazyBonus],
				300_000,
			);

			const result1 = await contractExecuteFunction(
				poolManagerId,
				poolManagerIface,
				client,
				gasEstimate.gasLimit,
				'setLazyBalanceBonus',
				[lazyThreshold, lazyBonus],
			);			if (result1[0]?.status?.toString() !== 'SUCCESS') {
				console.log('Set LAZY balance bonus failed:', result1[0]?.status?.toString());
				fail('Set LAZY balance bonus failed');
			}

			gasEstimate = await estimateGas(
				env,
				poolManagerId,
				poolManagerIface,
				adminId,
				'setNFTBonus',
				[testNFTTokenId1.toSolidityAddress(), nftBonus],
				300_000,
			);

			const result2 = await contractExecuteFunction(
				poolManagerId,
				poolManagerIface,
				client,
				gasEstimate.gasLimit,
				'setNFTBonus',
				[testNFTTokenId1.toSolidityAddress(), nftBonus],
			);			if (result2[0]?.status?.toString() !== 'SUCCESS') {
				console.log('Set NFT bonus failed:', result2[0]?.status?.toString());
				fail('Set NFT bonus failed');
			}

			const currentTime = Math.floor(Date.now() / 1000);
			gasEstimate = await estimateGas(
				env,
				poolManagerId,
				poolManagerIface,
				adminId,
				'setTimeBonus',
				[currentTime - 10, currentTime + 60, timeBonus],
				300_000,
			);

			const result3 = await contractExecuteFunction(
				poolManagerId,
				poolManagerIface,
				client,
				gasEstimate.gasLimit,
				'setTimeBonus',
				[currentTime - 10, currentTime + 60, timeBonus],
			);			if (result3[0]?.status?.toString() !== 'SUCCESS') {
				console.log('Set time bonus failed:', result3[0]?.status?.toString());
				fail('Set time bonus failed');
			}


			// Let's use operator as that account should meet all bonus criteria
			client.setOperator(operatorId, operatorKey);

			// Wait for token transfers
			await sleep(5000);

			// Test Operator's combined bonus calculation (calculateBoost is in PoolManager)
			const boostQuery = poolManagerIface.encodeFunctionData('calculateBoost', [operatorId.toEvmAddress()]);
			const boostResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, boostQuery, operatorId, false);
			const totalBoost = poolManagerIface.decodeFunctionResult('calculateBoost', boostResult);			const expectedScaledBoost = (lazyBonus + nftBonus + timeBonus) * 10_000;

			console.log('\t📊 BONUS STACKING RESULTS:');
			console.log('\t   • Individual bonuses: LAZY=' + lazyBonus + ', NFT=' + nftBonus + ', Time=' + timeBonus + ' bps');
			console.log('\t   • Sum: ' + (lazyBonus + nftBonus + timeBonus) + ' bps');
			console.log('\t   • Contract scaled result: ' + totalBoost[0].toString());
			console.log('\t   • Expected scaled result: ' + expectedScaledBoost);

			expect(totalBoost[0].toString()).to.equal(expectedScaledBoost.toString());

			console.log('\t✅ Bonus stacking verification completed');

		}
		catch (error) {
			console.log('\t✗ Bonus stacking test failed:', error.message);
			expect.fail('Bonus stacking test failed');
		}
	});
});

describe('LazyLotto - Rolling Mechanics:', function () {
	const userPoolId = 0;

	beforeEach(async () => {
		// Ensure user has entries to roll
		const entryFee = new Hbar(1);
		const ticketCount = 3;

		// Set Alice as operator
		client.setOperator(aliceId, alicePK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'buyEntry',
			[userPoolId, ticketCount],
			2_000_000,
			Number(entryFee.toTinybars()) * ticketCount,
		);

		await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'buyEntry',
			[userPoolId, ticketCount],
			new Hbar(Number(entryFee.toTinybars()) * ticketCount, HbarUnit.Tinybar),
		);

		// add a prize package so there is something to win
		client.setOperator(operatorId, operatorKey);
		const prizeAmount = 1000;
		const gasEstimatePrize = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'addPrizePackage',
			[userPoolId, ZERO_ADDRESS, prizeAmount, [], []],
			500_000,
			prizeAmount,
		);
		await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimatePrize.gasLimit,
			'addPrizePackage',
			[userPoolId, ZERO_ADDRESS, prizeAmount, [], []],
			new Hbar(prizeAmount, HbarUnit.Tinybar),
		);

		// wait for mirror node indexing
		await sleep(5000);
	});

	it('Should roll all user entries', async () => {
		// Set Alice as operator
		client.setOperator(aliceId, alicePK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'rollAll',
			[userPoolId],
			5_000_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit * 2,
			'rollAll',
			[userPoolId],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Rolling entries failed:', result[0]?.status?.toString());
			fail('Rolling entries failed');
		}

		console.log('\tGas used:', gasEstimate.gasLimit);

		console.log('\t✓ Successfully rolled all entries');
		console.log(parseTransactionRecord(result[2]));

		await sleep(5000);

		// Check if user has any pending prizes
		// Get total pools first
		const totalPoolsCmd = lazyLottoIface.encodeFunctionData('totalPools');
		const totalPoolsResult = await readOnlyEVMFromMirrorNode(env, contractId, totalPoolsCmd, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', totalPoolsResult);

		// Get user entries for all pools
		const encodedCommand = lazyLottoIface.encodeFunctionData('getUserEntriesPage', [aliceId.toSolidityAddress(), 0, Number(totalPools[0])]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const userEntries = lazyLottoIface.decodeFunctionResult('getUserEntriesPage', queryResult);
		// @return uint256[] memory The number of entries the user has in each pool
		// should be 2 element array (two pools) and the userPoolId element should be 0 now
		expect(Number(userEntries[0][userPoolId])).to.equal(0);
		console.log('\t✓ Verified user has no remaining entries after rollAll for pool', userPoolId);
	});

	it('Should roll batch of entries', async () => {
		const numberToRoll = 2;

		// Use Alice who has entries from beforeEach
		client.setOperator(aliceId, alicePK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'rollBatch',
			[userPoolId, numberToRoll],
			2_000_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit * 2,
			'rollBatch',
			[userPoolId, numberToRoll],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Batch rolling failed:', result);
			fail('Batch rolling failed');
		}

		console.log('\t✓ Successfully rolled batch of entries');
		console.log(parseTransactionRecord(result[2]));
	});

	it('Should handle buy and roll in one transaction', async () => {
		const entryFee = new Hbar(1);
		const ticketCount = 1;

		// Set Carol as operator
		client.setOperator(carolId, carolPK);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			carolId,
			'buyAndRollEntry',
			[userPoolId, ticketCount],
			4_000_000,
			Number(entryFee.toTinybars()),
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit * 2,
			'buyAndRollEntry',
			[userPoolId, ticketCount],
			entryFee,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Buy and roll failed:', result[0]?.status?.toString());
			fail('Buy and roll failed');
		}

		console.log('\t✓ Successfully bought and rolled entry');
		console.log(parseTransactionRecord(result[2]));

		console.log('\n-Checking for wins for Carol:', result[1]);

		// let's see if the user won anything
		const wins = Number(result[1][0]);
		const offset = Number(result[1][1]);
		if (wins) {
			console.log(`\t✓ User won ${wins} tickets starting from offset ${offset}`);
		}
		else {
			console.log('\t✗ User did not win any tickets');
		}
	});
});

describe('LazyLotto - Prize Claiming:', function () {

	before(async () => {
		// Switch to mock PRNG for deterministic wins
		console.log('\n🎯 Switching to Mock PRNG for deterministic prize claiming tests...');

		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'setPrng',
			[mockPrngId.toSolidityAddress()],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'setPrng',
			[mockPrngId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Set Mock PRNG failed:', result[0]?.status?.toString());
			fail('Set Mock PRNG failed');
		}

		console.log('✓ Mock PRNG activated - all rolls will now result in wins');
	});

	after(async () => {
		// Switch back to real PRNG
		console.log('\n🔄 Restoring real PRNG...');

		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'setPrng',
			[prngId.toSolidityAddress()],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'setPrng',
			[prngId.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Restore real PRNG failed:', result[0]?.status?.toString());
			fail('Restore real PRNG failed');
		}

		console.log('✓ Real PRNG restored');
	});

	beforeEach(async () => {
		const poolId = 0;
		const entryFee = new Hbar(1);
		const ticketCount = 3;

		// better add some prizes to ensure user can claim something
		const prizeAmount = new Hbar(3);
		// create an array of ticketCount length for fungible prizes of random amounts of tinybars summing to prizeAmount
		const prizes = [];
		let remainingAmount = Number(prizeAmount.toTinybars());

		for (let i = 0; i < ticketCount; i++) {
			const randomAmount = Math.floor(Math.random() * remainingAmount);
			prizes.push(new Hbar(randomAmount, HbarUnit.Tinybar));
			remainingAmount -= randomAmount;
		}

		// Set admin as operator
		client.setOperator(adminId, adminPK);
		let gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			adminId,
			'addMultipleFungiblePrizes',
			[0, ZERO_ADDRESS, prizes.map(p => Number(p.toTinybars()))],
			2_000_000,
			Number(prizeAmount.toTinybars()),
		);

		let result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addMultipleFungiblePrizes',
			[0, ZERO_ADDRESS, prizes.map(p => Number(p.toTinybars()))],
			prizeAmount,
		);

		// Set up scenario where user has pending prizes
		// With mock PRNG, every roll will be a win

		// Set Alice as operator
		client.setOperator(aliceId, alicePK);

		gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'buyAndRollEntry',
			[poolId, ticketCount],
			4_000_000,
			Number(entryFee.toTinybars()) * ticketCount,
		);

		result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit * 2,
			'buyAndRollEntry',
			[poolId, ticketCount],
			new Hbar(Number(entryFee.toTinybars()) * ticketCount, HbarUnit.Tinybar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Buy and roll failed:', result[0]?.status?.toString());
			fail('Buy and roll failed');
		}

		console.log('\t✓ Purchased and rolled 3 tickets (all wins with mock PRNG)');
		console.log(parseTransactionRecord(result[2]));

		// check that Alice has wins
		const wins = Number(result[1][0]);
		expect(wins).to.be.equal(ticketCount);
	});

	it('Should claim individual prize', async () => {
		try {
			await sleep(5000);

			// Check pending prizes count first
			const countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [aliceId.toSolidityAddress()]);
			const countResult = await readOnlyEVMFromMirrorNode(env, contractId, countQuery, operatorId, false);
			const prizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult);

			// Get all pending prizes
			const encodedQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [aliceId.toSolidityAddress(), 0, Number(prizeCount[0])]);
			const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedQuery, operatorId, false);
			const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', queryResult);

			if (pendingPrizes[0].length > 0) {
				// Set Alice as operator
				client.setOperator(aliceId, alicePK);

				const prizeIndex = 0;

				// in case this is an NFT prize set an hbar allowance for the contract
				if (pendingPrizes[0][prizeIndex].prize.nftTokens.length > 0) {
					client.setOperator(aliceId, alicePK);
					// for each of pendingPrizes[0][prizeIndex].prize.nftTokens.length check alice has it associated
					for (let i = 0; i < pendingPrizes[0][prizeIndex].prize.nftTokens.length; i++) {
						const nftTokenId = TokenId.fromSolidityAddress(pendingPrizes[0][prizeIndex].prize.nftTokens[i]);
						const aliceBalance = await checkMirrorBalance(env, aliceId.toString(), nftTokenId.toString());
						if (aliceBalance == null || aliceBalance == undefined) {
							console.log('\tAlice does not yet have required NFT associated for prize claiming:', nftTokenId.toString());
							const assoc = await associateTokensToAccount(
								client,
								aliceId,
								alicePK,
								[nftTokenId],
							);

							if (assoc != 'SUCCESS') {
								console.log('\t✗ Failed to associate NFT token for prize claiming:', nftTokenId.toString());
								fail('NFT association failed for prize claiming');
							}
						}
					}
					// now set allowance
					const allowanceResult = await setHbarAllowance(
						client,
						aliceId,
						AccountId.fromString(contractId.toString()),
						1,
					);

					if (allowanceResult !== 'SUCCESS') {
						console.log('\t✗ Failed to set HBAR allowance for NFT prize claiming');
						fail('HBAR allowance setup failed for NFT prize claiming');
					}
				}

				const gasEstimate = await estimateGas(
					env,
					contractId,
					lazyLottoIface,
					aliceId,
					'claimPrize',
					[prizeIndex],
					2_000_000,
				);


				const result = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit,
					'claimPrize',
					[prizeIndex],
				);

				if (result[0]?.status?.toString() !== 'SUCCESS') {
					console.log('Prize claiming failed:', result[0]?.status?.toString());
					fail('Prize claiming failed');
				}

				console.log('\t✓ Successfully claimed individual prize');
				console.log(parseTransactionRecord(result[2]));
			}
			else {
				console.log('\t⚠ No pending prizes to claim');
			}
		}
		catch (error) {
			console.log('\t✗ Failed to claim prize:', error.message);
			expect.fail('Prize claiming failed');
		}
	});

	it('Should claim all pending prizes', async () => {
		try {
			// Set Alice as operator
			client.setOperator(aliceId, alicePK);

			await sleep(5000);

			// Check pending prizes count first
			const countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [aliceId.toSolidityAddress()]);
			const countResult = await readOnlyEVMFromMirrorNode(env, contractId, countQuery, operatorId, false);
			const prizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult);

			// Get all pending prizes
			const encodedQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [aliceId.toSolidityAddress(), 0, Number(prizeCount[0])]);
			const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedQuery, operatorId, false);
			const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', queryResult);

			if (pendingPrizes[0].length > 0) {
				// Set Alice as operator
				client.setOperator(aliceId, alicePK);

				let allowanceSet = false;

				for (let prizeIndex = 0; prizeIndex < pendingPrizes[0].length; prizeIndex++) {
					// in case this is an NFT prize set an hbar allowance for the contract
					if (pendingPrizes[0][prizeIndex].prize.nftTokens.length > 0) {
						client.setOperator(aliceId, alicePK);
						// for each of pendingPrizes[0][prizeIndex].prize.nftTokens.length check alice has it associated
						for (let i = 0; i < pendingPrizes[0][prizeIndex].prize.nftTokens.length; i++) {
							const nftTokenId = TokenId.fromSolidityAddress(pendingPrizes[0][prizeIndex].prize.nftTokens[i]);
							const aliceBalance = await checkMirrorBalance(env, aliceId.toString(), nftTokenId.toString());
							if (aliceBalance == null || aliceBalance == undefined) {
								console.log('\tAlice does not yet have required NFT associated for prize claiming:', nftTokenId.toString());
								const assoc = await associateTokensToAccount(
									client,
									aliceId,
									alicePK,
									[nftTokenId],
								);

								if (assoc != 'SUCCESS') {
									console.log('\t✗ Failed to associate NFT token for prize claiming:', nftTokenId.toString());
									fail('NFT association failed for prize claiming');
								}
							}
						}

						if (!allowanceSet) {
							// now set allowance
							const allowanceResult = await setHbarAllowance(
								client,
								aliceId,
								AccountId.fromString(contractId.toString()),
								1,
							);

							if (allowanceResult !== 'SUCCESS') {
								console.log('\t✗ Failed to set HBAR allowance for NFT prize claiming');
								fail('HBAR allowance setup failed for NFT prize claiming');
							}

							allowanceSet = true;
						}
					}
				}
			}

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				aliceId,
				'claimAllPrizes',
				[],
				6_000_000,
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'claimAllPrizes',
				[],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				console.log('Claim all prizes failed:', result[0]?.status?.toString());
				fail('Claim all prizes failed');
			}

			console.log('\t✓ Successfully claimed all prizes');
			console.log(parseTransactionRecord(result[2]));
		}
		catch (error) {
			console.log('\t✗ Failed to claim all prizes:', error.message);
			// This might fail if no prizes are pending, which is expected
			if (error.message.includes('NoPendingPrizes')) {
				console.log('\t⚠ No pending prizes to claim - this is expected');
			}
			else {
				expect.fail('Unexpected error claiming prizes');
			}
		}
	});
});

describe('LazyLotto - Prize NFT System:', function () {
	let prizeNFTPoolId;
	let prizeAsTokenId;
	const serialsFound = [];
	let totalPendingPrizes = 0;

	before(async function () {
		console.log('\n-Setting up Prize NFT System tests...');

		// Create a pool with Mock PRNG to guarantee wins
		client.setOperator(operatorId, operatorKey);

		// Switch to Mock PRNG
		const setPrngGas = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'setPrng',
			[mockPrngId.toSolidityAddress()],
			300_000,
		);

		const setPrngResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			setPrngGas.gasLimit,
			'setPrng',
			[mockPrngId.toSolidityAddress()],
		);

		if (setPrngResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('Failed to switch to Mock PRNG');
		}

		console.log('✓ Switched to Mock PRNG for guaranteed wins');

		// Create test pool
		const createGasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'createPool',
			[
				'Prize NFT Test Pool',
				'PNFT',
				'Pool for testing prize NFT functionality',
				[],
				'QmPrizeNFTTicket',
				'QmPrizeNFTWin',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				ZERO_ADDRESS,
			],
			4_000_000,
			Number(new Hbar(50).toTinybars()),
		);

		const createResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			createGasEstimate.gasLimit,
			'createPool',
			[
				'Prize NFT Test Pool',
				'PNFT',
				'Pool for testing prize NFT functionality',
				[],
				'QmPrizeNFTTicket',
				'QmPrizeNFTWin',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				ZERO_ADDRESS,
			],
			new Hbar(50),
		);

		if (createResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('Failed to create prize NFT test pool');
		}

		// we should get the new pool ID returned in element 1
		console.log('✓ Created prize NFT test pool:', createResult[1]);
		prizeNFTPoolId = Number(createResult[1][0]);

		// Get the pool's NFT collection ID
		const poolDetails = await contractExecuteQuery(
			contractId,
			lazyLottoIface,
			client,
			200_000,
			'getPoolBasicInfo',
			[prizeNFTPoolId],
		);

		const prizeNFTCollectionId = poolDetails[6];
		await sleep(5000);
		// poolTokenId is at index 6
		prizeAsTokenId = TokenId.fromString(await homebrewPopulateAccountNum(env, prizeNFTCollectionId, EntityType.TOKEN));
		console.log(`✓ Pool NFT collection: ${prizeNFTCollectionId} / ${prizeAsTokenId.toString()}`);

		// associate Alice with the prize NFT collection
		const assocResult = await associateTokensToAccount(
			client,
			aliceId,
			alicePK,
			[prizeAsTokenId],
		);

		if (assocResult !== 'SUCCESS') {
			fail('Failed to associate Alice with prize NFT collection');
		}

		// Add prizes to the pool
		const addPrizeGasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'addPrizePackage',
			[prizeNFTPoolId, ZERO_ADDRESS, Number(new Hbar(2).toTinybars()), [], []],
			800_000,
			Number(new Hbar(2).toTinybars()),
		);

		await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			addPrizeGasEstimate.gasLimit,
			'addPrizePackage',
			[prizeNFTPoolId, ZERO_ADDRESS, Number(new Hbar(2).toTinybars()), [], []],
			new Hbar(2),
		);

		await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			addPrizeGasEstimate.gasLimit,
			'addPrizePackage',
			[prizeNFTPoolId, ZERO_ADDRESS, Number(new Hbar(3).toTinybars()), [], []],
			new Hbar(3),
		);

		console.log('✓ Added 2 HBAR prizes to pool');

		// Alice buys and rolls tickets to win prizes
		client.setOperator(aliceId, alicePK);
		await sleep(5000);

		const buyRollGas = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'buyAndRollEntry',
			[prizeNFTPoolId, 2],
			2_000_000,
			Number(new Hbar(2).toTinybars()),
		);

		const buyRollResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			buyRollGas.gasLimit * 2,
			'buyAndRollEntry',
			[prizeNFTPoolId, 2],
			new Hbar(2),
		);

		if (buyRollResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Buy and roll tickets failed:', buyRollResult);
			fail('Failed to buy and roll tickets');
		}

		console.log('✓ Alice bought and rolled 2 tickets (guaranteed wins with mock PRNG)');

		// Wait for mirror node sync
		await sleep(5000);

		// Verify Alice has pending prizes from mirror node - get count first
		const countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [aliceId.toSolidityAddress()]);
		const countResult = await readOnlyEVMFromMirrorNode(env, contractId, countQuery, operatorId, false, 1_000_000);
		const prizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult);

		// Get all pending prizes
		const encodedQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [aliceId.toSolidityAddress(), 0, Number(prizeCount[0])]);
		const queryResult = await readOnlyEVMFromMirrorNode(env, contractId, encodedQuery, operatorId, false, 1_000_000);
		const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', queryResult);

		totalPendingPrizes = pendingPrizes[0].length;

		console.log(`✓ Alice has ${totalPendingPrizes} pending prizes`);

		if (totalPendingPrizes < 2) {
			fail('Alice should have at least 2 pending prizes');
		}
	});

	after(async function () {
		// Restore real PRNG
		client.setOperator(operatorId, operatorKey);

		const setPrngGas = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'setPrng',
			[prngId.toSolidityAddress()],
			300_000,
		);

		await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			setPrngGas.gasLimit,
			'setPrng',
			[prngId.toSolidityAddress()],
		);

		console.log('\n-Restored real PRNG');
	});

	it('Should redeem pending prizes to NFT', async function () {
		console.log('\n-Testing redeemPrizeToNFT() function...');

		client.setOperator(aliceId, alicePK);

		// redeem is via wipe so no need to set allowance

		// Redeem last two prizes to NFT
		const indices = [totalPendingPrizes - 2, totalPendingPrizes - 1];

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'redeemPrizeToNFT',
			[indices],
			1_500_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'redeemPrizeToNFT',
			[indices],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('redeemPrizeToNFT failed:', result[0]?.status?.toString());
			fail('redeemPrizeToNFT failed');
		}

		console.log(`✓ Redeemed 2 prizes to NFT (Gas: ${gasEstimate.gasLimit})`);
		console.log(parseTransactionRecord(result[2]));

		// Wait for mirror node sync
		await sleep(5000);

		// Check Alice's balance of prize NFTs from the mirror node
		const aliceBalance = await checkMirrorBalance(env, aliceId.toString(), prizeAsTokenId);
		console.log(`✓ Alice's balance of prize NFTs (tokenId: ${prizeAsTokenId.toString()}): ${aliceBalance} (should be 2)`);
		expect(aliceBalance).to.equal(2);

		// For now, let's just verify the pending prizes array is updated via the mirror node readOnly call
		// Get pending prizes count first
		const countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [aliceId.toSolidityAddress()]);
		const countResult = await readOnlyEVMFromMirrorNode(env, contractId, countQuery, aliceId, false);
		const prizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult);

		// Get all pending prizes
		const encodedQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [aliceId.toSolidityAddress(), 0, Number(prizeCount[0])]);
		const queryResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedQuery,
			aliceId,
			false,
		);
		const pendingAfter = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', queryResult);


		console.log(`✓ Alice now has ${pendingAfter[0].length} pending prizes (should be reduced)`);
		// Note: Full implementation requires parsing transaction events to get NFT collection address and serials
		console.log('✓ Prize redemption to NFT complete');
	});

	it('Should query pending prizes by NFT tokenId and serial', async function () {
		console.log('\n-Testing getPendingPrizesByNFT(tokenId, serial)...');

		// get the serials from the mirror node for Alice's prize NFTs
		const serials = await getSerialsOwned(
			env,
			aliceId,
			prizeAsTokenId,
		);

		for (const s of serials) {
			serialsFound.push(Number(s));
		}

		// Now query the pending prizes using the NFT tokenId and serial
		const serial = serialsFound[0];

		const encodedCommand = lazyLottoIface.encodeFunctionData('getPendingPrizesByNFT', [
			prizeAsTokenId.toSolidityAddress(),
			serial,
		]);

		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, aliceId, false);
		const pendingPrize = lazyLottoIface.decodeFunctionResult('getPendingPrizesByNFT', result)[0];

		console.log(`✓ Successfully queried prize for NFT serial ${serial}:`);
		console.log(`  - Pool ID: ${pendingPrize[0]}`);
		console.log(`  - As NFT: ${pendingPrize[1]}`);
		console.log(`  - Prize Amount: ${pendingPrize[2][1]}`);
		console.log(`  - Prize Token: ${pendingPrize[2][0]}`);

		// Verify the data makes sense
		expect(pendingPrize[0]).to.equal(prizeNFTPoolId);
		expect(pendingPrize[1]).to.equal(true);
		expect(pendingPrize[2][1]).to.be.greaterThan(0);

		console.log('✓ getPendingPrizesByNFT(tokenId, serial) test complete');
	});

	it('Should claim prizes from NFT', async function () {
		console.log('\n-Testing claimPrizeFromNFT() function...');

		client.setOperator(aliceId, alicePK);

		// Get Alice's HBAR balance before claim
		const balanceBefore = await checkMirrorHbarBalance(env, aliceId);
		console.log(`-Alice HBAR balance before: ${balanceBefore} tinybars`);

		// let's redeeem all serials found via claimPrizeFromNFT which takes an array of serials
		console.log(`-Claiming prizes for NFT serials: ${serialsFound.join(', ')}`);

		// claim is via mint so no need to set allowance
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			aliceId,
			'claimPrizeFromNFT',
			[prizeAsTokenId.toSolidityAddress(), serialsFound],
			2_000_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'claimPrizeFromNFT',
			[prizeAsTokenId.toSolidityAddress(), serialsFound],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('claimPrizeFromNFT failed:', result);
			fail('claimPrizeFromNFT failed');
		}

		console.log(`✓ Claimed prizes from NFTs (Gas: ${gasEstimate.gasLimit})`);
		console.log(parseTransactionRecord(result[2]));

		// Wait for mirror node sync
		await sleep(5000);

		// check Alice's HBAR balance after claim is increased and NFTs are burned
		const balanceAfter = await checkMirrorHbarBalance(env, aliceId);
		console.log(`-Alice HBAR balance after: ${balanceAfter} tinybars`);
		expect(balanceAfter).to.be.greaterThan(balanceBefore);

		// Check Alice's balance of prize NFTs from the mirror node to ensure they are burned
		const aliceBalance = await checkMirrorBalance(env, aliceId.toString(), prizeAsTokenId.toString());
		console.log(`✓ Alice's balance of prize NFTs after claim: ${aliceBalance} (should be 0)`);
		expect(aliceBalance).to.equal(0);
	});
});

describe('LazyLotto - Pool Lifecycle Management:', function () {
	let testPoolId;

	before(async function () {
		// Create a dedicated test pool for lifecycle tests
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'createPool',
			[
				'Lifecycle Test Pool',
				'LIFE',
				'Test pool for pause/close operations',
				[],
				'QmLifecycleTicket',
				'QmLifecycleWin',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				ZERO_ADDRESS,
			],
			2_000_000,
			Number(new Hbar(50).toTinybars()),
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'createPool',
			[
				'Lifecycle Test Pool',
				'LIFE',
				'Test pool for pause/close operations',
				[],
				'QmLifecycleTicket',
				'QmLifecycleWin',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				ZERO_ADDRESS,
			],
			new Hbar(50),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to create test pool:', result[0]?.status?.toString());
			throw new Error('Test pool creation failed');
		}
		console.log(parseTransactionRecord(result[2]));

		// we should get the new pool ID returned in element 1

		testPoolId = Number(result[1][0]);
		console.log(`\n✓ Created test pool for lifecycle tests: Pool ID ${testPoolId}`);

		// let's add 2 x hbar prize and an NFT prize to the pool
		const addPrizeGasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'addPrizePackage',
			[testPoolId, ZERO_ADDRESS, Number(new Hbar(5).toTinybars()), [], []],
			800_000,
			Number(new Hbar(5).toTinybars()),
		);

		const hbarPkgResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			addPrizeGasEstimate.gasLimit,
			'addPrizePackage',
			[testPoolId, ZERO_ADDRESS, Number(new Hbar(5).toTinybars()), [], []],
			new Hbar(5),
		);

		if (hbarPkgResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to add HBAR prize package:', hbarPkgResult[0]?.status?.toString());
			throw new Error('Add HBAR prize package failed');
		}
		console.log('✓ Added HBAR prize package to test pool');
		console.log(parseTransactionRecord(hbarPkgResult[2]));

		// need to check serials the operator has for the testNFTTokenId1 and testNFTTokenId2
		console.log('\n-Checking operator NFT serials for prize packages...');
		const operatorNFTBalance1 = await getSerialsOwned(
			env,
			operatorId,
			testNFTTokenId1,
		);
		console.log(`\t✓ Operator has serials for NFT Token ${testNFTTokenId1.toString()}:`, operatorNFTBalance1);
		const operatorNFTBalance2 = await getSerialsOwned(
			env,
			operatorId,
			testNFTTokenId2,
		);
		console.log(`\t✓ Operator has serials for NFT Token ${testNFTTokenId2.toString()}:`, operatorNFTBalance2);

		// set NFT allowance for the contract to transfer the NFTs as prizes
		const allowanceResult1 = await setNFTAllowanceAll(
			client,
			[testNFTTokenId1, testNFTTokenId2],
			operatorId,
			AccountId.fromString(storageContractId.toString()),
		);

		if (allowanceResult1 !== 'SUCCESS') {
			console.log('Failed to set NFT allowance for prize packages');
			throw new Error('NFT allowance setup failed for prize packages');
		}

		const addNftPrizeGasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'addPrizePackage',
			[testPoolId, ZERO_ADDRESS, Number(new Hbar(3).toTinybars()), [testNFTTokenId1.toSolidityAddress()], [[operatorNFTBalance1[0]]]],
			1_800_000,
			Number(new Hbar(3).toTinybars()),
		);

		const nftPkgResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			addNftPrizeGasEstimate.gasLimit,
			'addPrizePackage',
			[testPoolId, ZERO_ADDRESS, Number(new Hbar(3).toTinybars()), [testNFTTokenId1.toSolidityAddress()], [[operatorNFTBalance1[0]]]],
			new Hbar(3),
		);
		if (nftPkgResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to add HBAR + NFT prize package:', nftPkgResult[0]?.status?.toString());
			throw new Error('Add HBAR + NFT prize package failed');
		}
		console.log('✓ Added HBAR + NFT prize package to test pool');
		console.log(parseTransactionRecord(nftPkgResult[2]));

		// let's add another package of the testFToken + another nft

		// set the fungible token allowance for the contract to transfer the FT as prizes
		const allowanceResult2 = await setFTAllowance(
			client,
			testFungibleTokenId,
			operatorId,
			AccountId.fromString(storageContractId.toString()),
			2,
		);

		if (allowanceResult2 !== 'SUCCESS') {
			console.log('Failed to set FT allowance for prize packages');
			throw new Error('FT allowance setup failed for prize packages');
		}

		const addFungibleNftPrizeGasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'addPrizePackage',
			[testPoolId, testFungibleTokenId.toSolidityAddress(), 2, [testNFTTokenId2.toSolidityAddress()], [[operatorNFTBalance2[0]]]],
			1_800_000,
		);

		const fungibleNftPkgResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			addFungibleNftPrizeGasEstimate.gasLimit,
			'addPrizePackage',
			[testPoolId, testFungibleTokenId.toSolidityAddress(), 2, [testNFTTokenId2.toSolidityAddress()], [[operatorNFTBalance2[0]]]],
		);

		if (fungibleNftPkgResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to add Fungible + NFT prize package:', fungibleNftPkgResult[0]?.status?.toString());
			throw new Error('Add Fungible + NFT prize package failed');
		}
		console.log('✓ Added Fungible + NFT prize package to test pool');
		console.log(parseTransactionRecord(fungibleNftPkgResult[2]));
	});

	it('Should pause pool and reject purchases', async function () {
		console.log('\n-Testing pausePool() function...');

		// Set operator as admin
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'pausePool',
			[testPoolId],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'pausePool',
			[testPoolId],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('pausePool failed:', result[0]?.status?.toString());
			fail('pausePool failed');
		}

		console.log(parseTransactionRecord(result[2]));

		console.log(`✓ Pool ${testPoolId} paused successfully (Gas: ${gasEstimate.gasLimit})`);

		// Verify pool is paused by checking pool details
		const poolDetails = await contractExecuteQuery(
			contractId,
			lazyLottoIface,
			client,
			200_000,
			'getPoolBasicInfo',
			[testPoolId],
		);

		expect(poolDetails[7]).to.be.true;
		// paused is at index 7
		console.log('✓ Verified pool paused state is true');

		// Attempt to buy entry (should fail)
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			client.setOperator(aliceId, alicePK);

			const buyGasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				aliceId,
				'buyEntry',
				[testPoolId, 1],
				1_200_000,
				Number(new Hbar(1).toTinybars()),
			);

			const buyResult = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				buyGasEstimate.gasLimit,
				'buyEntry',
				[testPoolId, 1],
				new Hbar(1),
			);

			if (buyResult[0]?.status?.name.startsWith('PoolOnPause')) {
				expectedErrors++;
				console.log('✓ Purchase correctly rejected on paused pool');
			}
			else {
				unexpectedErrors++;
				console.log('✗ Purchase should have been rejected but succeeded');
			}
		}
		catch (error) {
			unexpectedErrors++;
			console.log('✗ Unexpected error during purchase attempt:', error.message);
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Should unpause pool and allow purchases', async function () {
		console.log('\n-Testing unpausePool() function...');

		// Set operator as admin
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'unpausePool',
			[testPoolId],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'unpausePool',
			[testPoolId],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('unpausePool failed:', result[0]?.status?.toString());
			fail('unpausePool failed');
		}
		console.log(parseTransactionRecord(result[2]));

		console.log(`✓ Pool ${testPoolId} unpaused successfully (Gas: ${gasEstimate.gasLimit})`);

		// Verify pool is unpaused
		const poolDetails = await contractExecuteQuery(
			contractId,
			lazyLottoIface,
			client,
			200_000,
			'getPoolBasicInfo',
			[testPoolId],
		);

		expect(poolDetails[7]).to.be.false;
		// paused is at index 7
		console.log('✓ Verified pool paused state is false');

		// Attempt to buy entry (should succeed)
		client.setOperator(bobId, bobPK);

		const buyGasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			bobId,
			'buyEntry',
			[testPoolId, 1],
			1_200_000,
			Number(new Hbar(1).toTinybars()),
		);

		const buyResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			buyGasEstimate.gasLimit,
			'buyEntry',
			[testPoolId, 1],
			new Hbar(1),
		);

		if (buyResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('buyEntry failed:', buyResult[0]?.status?.toString());
			fail('buyEntry should succeed on unpaused pool');
		}
		console.log(parseTransactionRecord(buyResult[2]));

		console.log('✓ Purchase successful on unpaused pool');
	});

	it('Should reject closing pool with outstanding entries', async function () {
		console.log('\n-Testing closePool() rejection with outstanding entries...');

		// Bob still has 1 entry from previous test
		client.setOperator(operatorId, operatorKey);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				operatorId,
				'closePool',
				[testPoolId],
				400_000,
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'closePool',
				[testPoolId],
			);

			if (result[0]?.status?.name.startsWith('EntriesOutstanding')) {
				expectedErrors++;
				console.log('✓ Pool closure correctly rejected with outstanding entries');
			}
			else {
				unexpectedErrors++;
				console.log('✗ Pool closure should have been rejected');
			}
		}
		catch (error) {
			unexpectedErrors++;
			console.log('✗ Unexpected error:', error.message);
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Should close pool when no outstanding entries', async function () {
		console.log('\n-Testing closePool() success...');

		// First, roll Bob's entry to clear outstanding entries
		client.setOperator(bobId, bobPK);

		const rollGasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			bobId,
			'rollAll',
			[testPoolId],
			1_500_000,
		);

		const rollResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			rollGasEstimate.gasLimit * 2,
			'rollAll',
			[testPoolId],
		);

		if (rollResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('rollAll failed:', rollResult[0]?.status?.toString());
			fail('rollAll failed');
		}

		console.log(parseTransactionRecord(rollResult[2]));

		console.log('✓ Rolled Bob\'s entries to clear pool');

		// need to check if Bob won! (uint256 wins, uint256 offset) in rollResult[1]
		const wins = Number(rollResult[1][0]);
		const offset = Number(rollResult[1][1]);

		if (wins > 0) {
			console.log(`-Bob won ${wins} prizes, starting from offset ${offset}`);
			// need to claim prizes to avoid outstanding prizes blocking pool closure
			client.setOperator(bobId, bobPK);
			for (let i = 0; i < wins; i++) {
				const prizeIndex = offset + i;
				const claimGasEstimate = await estimateGas(
					env,
					contractId,
					lazyLottoIface,
					bobId,
					'claimPrize',
					[prizeIndex],
					1_000_000,
				);

				const claimResult = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					claimGasEstimate.gasLimit,
					'claimPrize',
					[prizeIndex],
				);

				if (claimResult[0]?.status?.toString() !== 'SUCCESS') {
					console.log('claimPrize failed:', claimResult[0]?.status?.toString());
					fail('claimPrize failed');
				}
				console.log(`✓ Bob claimed prize at index ${prizeIndex}`);
				console.log(parseTransactionRecord(claimResult[2]));
			}
		}

		// Now close the pool
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'closePool',
			[testPoolId],
			800_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'closePool',
			[testPoolId],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('closePool failed:', result[0]?.status?.toString());
			fail('closePool failed');
		}

		console.log(parseTransactionRecord(result[2]));

		console.log(`✓ Pool ${testPoolId} closed successfully (Gas: ${gasEstimate.gasLimit})`);

		// Verify pool is closed
		const poolDetails = await contractExecuteQuery(
			contractId,
			lazyLottoIface,
			client,
			200_000,
			'getPoolBasicInfo',
			[testPoolId],
		);

		expect(poolDetails[8]).to.be.true;
		// closed is at index 8
		console.log('✓ Verified pool closed state is true');

		// Verify purchases are rejected on closed pool
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			client.setOperator(carolId, carolPK);

			const buyGasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				carolId,
				'buyEntry',
				[testPoolId, 1],
				1_200_000,
				Number(new Hbar(1).toTinybars()),
			);

			const buyResult = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				buyGasEstimate.gasLimit,
				'buyEntry',
				[testPoolId, 1],
				new Hbar(1),
			);

			if (buyResult[0]?.status?.name.startsWith('PoolIsClosed')) {
				expectedErrors++;
				console.log('✓ Purchase correctly rejected on closed pool');
			}
			else {
				unexpectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Should remove prizes from closed pool', async function () {
		console.log('\n-Testing removePrizes() function...');

		// First add a prize to the closed pool (for removal test)
		client.setOperator(operatorId, operatorKey);

		await sleep(5000);

		// Get operator HBAR balance before removal
		const balanceBefore = await checkMirrorHbarBalance(env, operatorId);
		console.log(`-Operator HBAR balance before: ${balanceBefore} tinybars`);

		// check pool details for prize count that remains from the mirror node
		const encodedCommand3 = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [testPoolId]);
		const result3 = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand3, operatorId, false);
		const poolDetailsBefore = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result3);
		console.log('-Pool basic info before prize removal:', poolDetailsBefore);
		const prizesBefore = Number(poolDetailsBefore[4]);
		// prizeCount is at index 4
		console.log(`-Prizes in pool before removal: ${prizesBefore}`);

		// Note: Cannot calculate exact prize HBAR amount without fetching all prizes
		// This test will verify removal works, but won't pre-calculate total HBAR
		console.log('-Skipping prize amount calculation (requires full prize array)');

		// for each prize, call removePrizes
		for (let i = prizesBefore - 1; i >= 0; i--) {
			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				operatorId,
				'removePrizes',
				[testPoolId, i],
				2_000_000,
			);
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'removePrizes',
				[testPoolId, i],
			);
			if (result[0]?.status?.toString() !== 'SUCCESS') {
				console.log('removePrizes failed:', result[0]?.status?.toString());
				fail('removePrizes failed');
			}
			console.log(`✓ Removed prize index ${i} from closed pool`);
			console.log(parseTransactionRecord(result[2]));
		}

		// Wait for mirror node sync
		await sleep(5000);

		// Verify operator received HBAR back (we don't know exact amount without prize details)
		const balanceAfter = await checkMirrorHbarBalance(env, operatorId);
		console.log(`-Operator HBAR balance after: ${balanceAfter} tinybars`);

		const actualIncrease = balanceAfter - balanceBefore;
		// Just verify balance increased (prizes were returned)
		expect(actualIncrease).to.be.greaterThan(0);
		console.log(`✓ Operator received ${actualIncrease} tinybars back from prize removals`);

		// Verify pool has no prizes left
		const poolDetails = await contractExecuteQuery(
			contractId,
			lazyLottoIface,
			client,
			300_000,
			'getPoolBasicInfo',
			[testPoolId],
		);

		expect(Number(poolDetails[4])).to.equal(0);
		// prizeCount at index 4
		console.log('✓ Verified pool has no prizes remaining');
	});
});

describe('LazyLotto - Global Contract Pause:', function () {
	let testPoolId;

	it('Should pause contract and block user operations', async function () {
		console.log('\n-Testing pause() function...');

		// Set operator as admin
		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'pause',
			[],
			300_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'pause',
			[],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('pause failed:', result[0]?.status?.toString());
			fail('pause failed');
		}

		console.log(`✓ Contract paused successfully (Gas: ${gasEstimate.gasLimit})`);
		console.log(parseTransactionRecord(result[2]));

		// Attempt user operation - buyEntry (should fail)
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			client.setOperator(aliceId, alicePK);

			const poolId = 0;

			const buyGasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				aliceId,
				'buyEntry',
				[poolId, 1],
				1_200_000,
				Number(new Hbar(1).toTinybars()),
			);

			const buyResult = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				buyGasEstimate.gasLimit,
				'buyEntry',
				[poolId, 1],
				new Hbar(1),
			);

			if (buyResult[0]?.status == 'REVERT: Pausable: paused') {
				expectedErrors++;
				console.log('✓ User operation correctly rejected while paused');
			}
			else {
				console.log('buyResult:', buyResult);
				unexpectedErrors++;
				console.log('✗ User operation should have been rejected');
			}
		}
		catch (err) {
			// Contract reverts are expected
			if (err.message?.includes('CONTRACT_REVERT_EXECUTED')) {
				expectedErrors++;
				console.log('✓ User operation correctly rejected while paused (via exception)');
			}
			else {
				unexpectedErrors++;
				console.log('✗ Unexpected error:', err.message);
			}
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Should allow admin operations when paused', async function () {
		console.log('\n-Testing admin operations while paused...');

		// Contract is still paused from previous test
		client.setOperator(operatorId, operatorKey);

		// Try creating a new pool (admin operation)
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'createPool',
			[
				'Paused Test Pool',
				'PAUSE',
				'Pool created while contract paused',
				[],
				'QmPausedTicket',
				'QmPausedWin',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				ZERO_ADDRESS,
			],
			2_000_000,
			Number(new Hbar(50).toTinybars()),
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'createPool',
			[
				'Paused Test Pool',
				'PAUSE',
				'Pool created while contract paused',
				[],
				'QmPausedTicket',
				'QmPausedWin',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				ZERO_ADDRESS,
			],
			new Hbar(50),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('createPool failed:', result[0]?.status?.toString());
			fail('Admin operations should work while paused');
		}

		console.log('✓ Admin createPool() successful while contract paused');
		console.log(parseTransactionRecord(result[2]));

		// get the new pool ID returned in element 1

		testPoolId = Number(result[1][0]);
		console.log(`✓ Created pool while paused: Pool ID ${testPoolId}`);

		// Verify pool was created
		const totalPools = await contractExecuteQuery(
			contractId,
			lazyLottoIface,
			client,
			200_000,
			'totalPools',
			[],
		);

		console.log(`✓ Total pools now: ${Number(totalPools[0])}`);
	});

	it('Should unpause contract and restore operations', async function () {
		console.log('\n-Testing unpause() function...');

		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'unpause',
			[],
			200_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'unpause',
			[],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('unpause failed:', result[0]?.status?.toString());
			fail('unpause failed');
		}

		console.log(`✓ Contract unpaused successfully (Gas: ${gasEstimate.gasLimit})`);

		// Verify user operations work again
		client.setOperator(bobId, bobPK);

		const buyGasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			bobId,
			'buyEntry',
			[testPoolId, 1],
			1_200_000,
			Number(new Hbar(1).toTinybars()),
		);

		const buyResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			buyGasEstimate.gasLimit,
			'buyEntry',
			[testPoolId, 1],
			new Hbar(1),
		);

		if (buyResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('buyEntry failed:', buyResult[0]?.status?.toString());
			fail('User operations should work after unpause');
		}
		console.log('✓ User buyEntry() successful after unpause');
		console.log(parseTransactionRecord(buyResult[2]));

		console.log('✓ User operations restored after unpause');
	});
});

describe('LazyLotto - Admin Transfer Functions:', function () {
	it('Should allow admin to withdraw HBAR', async function () {
		console.log('\n-Testing transferHbar() function...');

		// Send some HBAR to the contract first
		client.setOperator(operatorId, operatorKey);

		const sendAmount = new Hbar(10);

		await sendHbar(client, operatorId, AccountId.fromString(contractId.toString()), 10, HbarUnit.Hbar);

		console.log(`✓ Sent ${sendAmount.toString()} to contract`);

		// Wait for mirror node sync
		await sleep(5000);

		// Get contract balance before withdrawal
		const contractBalanceBefore = await checkMirrorHbarBalance(env, contractId);
		console.log(`-Contract HBAR balance: ${contractBalanceBefore} tinybars`);

		// Get operator balance before withdrawal
		const operatorBalanceBefore = await checkMirrorHbarBalance(env, operatorId);
		console.log(`-Operator HBAR balance before: ${operatorBalanceBefore} tinybars`);

		// Withdraw HBAR
		const withdrawAmount = new Hbar(5);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'transferHbar',
			[operatorId.toSolidityAddress(), Number(withdrawAmount.toTinybars())],
			500_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'transferHbar',
			[operatorId.toSolidityAddress(), Number(withdrawAmount.toTinybars())],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('transferHbar failed:', result[0]?.status?.toString());
			fail('transferHbar failed');
		}

		console.log(`✓ Withdrew ${withdrawAmount.toString()} successfully (Gas: ${gasEstimate.gasLimit})`);
		console.log(parseTransactionRecord(result[2]));

		// Wait for mirror node sync
		await sleep(5000);

		// Verify operator received the HBAR
		const operatorBalanceAfter = await checkMirrorHbarBalance(env, operatorId);
		console.log(`-Operator HBAR balance after: ${operatorBalanceAfter} tinybars`);

		const expectedIncrease = withdrawAmount.toTinybars().toNumber();
		const actualIncrease = operatorBalanceAfter - operatorBalanceBefore;

		// Allow some tolerance for gas costs
		expect(actualIncrease).to.be.greaterThan(expectedIncrease * 0.9);
		console.log(`✓ Operator received ~${actualIncrease} tinybars (expected ${expectedIncrease})`);
	});

	it('Should reject non-admin HBAR withdrawal', async function () {
		console.log('\n-Testing transferHbar() non-admin rejection...');

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			client.setOperator(aliceId, alicePK);

			const withdrawAmount = new Hbar(1);

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				aliceId,
				'transferHbar',
				[aliceId.toSolidityAddress(), Number(withdrawAmount.toTinybars())],
				500_000,
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'transferHbar',
				[aliceId.toSolidityAddress(), Number(withdrawAmount.toTinybars())],
			);

			if (result[0]?.status?.name == 'NotAdmin') {
				expectedErrors++;
				console.log('✓ Non-admin withdrawal correctly rejected');
			}
			else {
				console.log('result:', result);
				unexpectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});

	it('Should allow admin to withdraw fungible tokens', async function () {
		console.log('\n-Testing transferFungible() function...');

		client.setOperator(operatorId, operatorKey);

		// Send some test fungible tokens to the contract
		const sendAmount = 100;

		await sendFT(
			client,
			testFungibleTokenId,
			sendAmount,
			operatorId,
			AccountId.fromString(storageContractId.toString()),
			'fungible token fuel for withdrawal test',
		);

		console.log(`✓ Sent ${sendAmount} test tokens to storage contract`);

		// Wait for mirror node sync
		await sleep(5000);

		// Get operator balance before withdrawal
		const operatorBalanceBefore = await checkMirrorBalance(
			env,
			operatorId,
			testFungibleTokenId,
		);
		console.log(`-Operator token balance before: ${operatorBalanceBefore}`);

		// Withdraw tokens
		const withdrawAmount = 50;

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'transferFungible',
			[
				testFungibleTokenId.toSolidityAddress(),
				operatorId.toSolidityAddress(),
				withdrawAmount,
			],
			600_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'transferFungible',
			[
				testFungibleTokenId.toSolidityAddress(),
				operatorId.toSolidityAddress(),
				withdrawAmount,
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('transferFungible failed:', result[0]?.status?.toString());
			fail('transferFungible failed');
		}

		console.log(`✓ Withdrew ${withdrawAmount} tokens successfully (Gas: ${gasEstimate.gasLimit})`);

		// Wait for mirror node sync
		await sleep(5000);

		// Verify operator received the tokens
		const operatorBalanceAfter = await checkMirrorBalance(
			env,
			operatorId,
			testFungibleTokenId,
		);
		console.log(`-Operator token balance after: ${operatorBalanceAfter}`);

		expect(operatorBalanceAfter).to.be.greaterThanOrEqual(
			operatorBalanceBefore + withdrawAmount,
		);
		console.log('✓ Operator received tokens successfully');
	});

	it('Should reject non-admin token withdrawal', async function () {
		console.log('\n-Testing transferFungible() non-admin rejection...');

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			client.setOperator(bobId, bobPK);

			const withdrawAmount = 100;

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				bobId,
				'transferFungible',
				[
					testFungibleTokenId.toSolidityAddress(),
					bobId.toSolidityAddress(),
					withdrawAmount,
				],
				600_000,
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'transferFungible',
				[
					testFungibleTokenId.toSolidityAddress(),
					bobId.toSolidityAddress(),
					withdrawAmount,
				],
			);

			if (result[0]?.status?.name == 'NotAdmin') {
				expectedErrors++;
				console.log('✓ Non-admin token withdrawal correctly rejected');
			}
			else {
				console.log('result:', result);
				unexpectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});
});

describe('LazyLotto - Bonus Management Functions:', function () {
	it('Should allow admin to remove a time bonus', async function () {
		console.log('\n-Testing removeTimeBonus() function...');

		client.setOperator(operatorId, operatorKey);

		// First, get current number of time bonuses (now in PoolManager)
		let encodedCommand = poolManagerIface.encodeFunctionData('totalTimeBonuses');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalBonusesBefore = poolManagerIface.decodeFunctionResult('totalTimeBonuses', result)[0];

		console.log(`-Total time bonuses before: ${totalBonusesBefore}`);

		// Add a new time bonus to remove
		const threshold = 300;
		const bps = 500;

		const startTime = Math.floor(Date.now() / 1000);
		const endTime = startTime + threshold;

		let gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			operatorId,
			'setTimeBonus',
			[startTime, endTime, bps],
			400_000,
		);

		let txResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setTimeBonus',
			[startTime, endTime, bps],
		);

		if (txResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('setTimeBonus failed');
		}

		console.log(`✓ Added time bonus: ${threshold}s → ${bps} bps (Gas: ${gasEstimate.gasLimit})`);
		console.log(parseTransactionRecord(txResult[2]));

		// Wait for mirror node sync
		await sleep(5000);

		// Verify bonus was added
		encodedCommand = poolManagerIface.encodeFunctionData('totalTimeBonuses');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalBonusesAfterAdd = poolManagerIface.decodeFunctionResult('totalTimeBonuses', result)[0];

		expect(Number(totalBonusesAfterAdd)).to.be.equal(Number(totalBonusesBefore) + 1);
		console.log(`✓ Total time bonuses after add: ${totalBonusesAfterAdd}`);

		// Now remove the bonus we just added (last index)
		const indexToRemove = Number(totalBonusesAfterAdd) - 1;

		gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			operatorId,
			'removeTimeBonus',
			[indexToRemove],
			400_000,
		);

		txResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'removeTimeBonus',
			[indexToRemove],
		);

		if (txResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('removeTimeBonus failed');
		}

		console.log(`✓ Removed time bonus at index ${indexToRemove} (Gas: ${gasEstimate.gasLimit})`);

		// Wait for mirror node sync
		await sleep(5000);

		// Verify bonus was removed
		encodedCommand = poolManagerIface.encodeFunctionData('totalTimeBonuses');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalBonusesAfterRemove = poolManagerIface.decodeFunctionResult('totalTimeBonuses', result)[0];

		expect(totalBonusesAfterRemove).to.be.equal(totalBonusesBefore);
		console.log(`✓ Total time bonuses after remove: ${totalBonusesAfterRemove}`);
	});

	it('Should allow admin to set burn percentage', async function () {
		console.log('\n-Testing setBurnPercentage() function...');

		client.setOperator(operatorId, operatorKey);

		// Set burn percentage to 25%
		const newBurnPercentage = 25;

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'setBurnPercentage',
			[newBurnPercentage],
			300_000,
		);

		const txResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'setBurnPercentage',
			[newBurnPercentage],
		);

		if (txResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('setBurnPercentage failed');
		}

		console.log(`✓ Set burn percentage to ${newBurnPercentage} bps (Gas: ${gasEstimate.gasLimit})`);
		console.log(parseTransactionRecord(txResult[2]));

		// Wait for mirror node sync
		await sleep(5000);

		// Verify the burn percentage was updated
		const encodedCommand = lazyLottoIface.encodeFunctionData('burnPercentage');
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const burnPercentage = lazyLottoIface.decodeFunctionResult('burnPercentage', result)[0];

		expect(Number(burnPercentage)).to.be.equal(newBurnPercentage);
		console.log(`✓ Burn percentage verified: ${burnPercentage} bps`);
	});

	it('Should allow admin to set LAZY balance bonus', async function () {
		console.log('\n-Testing setLazyBalanceBonus() function...');

		client.setOperator(operatorId, operatorKey);

		// Set LAZY balance bonus: 1000 LAZY = 10% bonus (1000 bps)
		const balanceThreshold = 1000;
		const bonusBps = 1000;

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			operatorId,
			'setLazyBalanceBonus',
			[balanceThreshold, bonusBps],
			300_000,
		);

		const txResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setLazyBalanceBonus',
			[balanceThreshold, bonusBps],
		);

		if (txResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('setLazyBalanceBonus failed');
		}

		console.log(`✓ Set LAZY balance bonus: ${balanceThreshold} → ${bonusBps} bps (Gas: ${gasEstimate.gasLimit})`);
		console.log(parseTransactionRecord(txResult[2]));

		// Wait for mirror node sync
		await sleep(5000);

		// Verify the bonus was set by getting bonus info
		let encodedCommand = poolManagerIface.encodeFunctionData('lazyBalanceThreshold');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const contractBalanceThreshold = poolManagerIface.decodeFunctionResult('lazyBalanceThreshold', result)[0];
		encodedCommand = poolManagerIface.encodeFunctionData('lazyBalanceBonusBps');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const contractBonusBps = poolManagerIface.decodeFunctionResult('lazyBalanceBonusBps', result)[0];

		expect(Number(contractBalanceThreshold)).to.be.equal(balanceThreshold);
		expect(Number(contractBonusBps)).to.be.equal(bonusBps);
		console.log(`✓ LAZY balance bonus verified: ${Number(contractBalanceThreshold)} → ${Number(contractBonusBps)} bps`);
	});

	it('Should allow admin to remove an NFT bonus', async function () {
		console.log('\n-Testing removeNFTBonus() function...');

		client.setOperator(operatorId, operatorKey);

		// First, get current number of NFT bonuses (now in PoolManager)
		let encodedCommand = poolManagerIface.encodeFunctionData('totalNFTBonusTokens');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalNFTBonusesBefore = poolManagerIface.decodeFunctionResult('totalNFTBonusTokens', result)[0];

		console.log(`-Total NFT bonuses before: ${totalNFTBonusesBefore}`);

		// Add a new NFT bonus to remove
		const bonusBps = 750;

		let gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			operatorId,
			'setNFTBonus',
			[testNFTTokenId2.toSolidityAddress(), bonusBps],
			400_000,
		);

		let txResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setNFTBonus',
			[testNFTTokenId2.toSolidityAddress(), bonusBps],
		);

		if (txResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('setNFTBonus failed');
		}

		console.log(`✓ Added NFT bonus for token (Gas: ${gasEstimate.gasLimit})`);

		// Wait for mirror node sync
		await sleep(5000);

		// Verify bonus was added
		encodedCommand = poolManagerIface.encodeFunctionData('totalNFTBonusTokens');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalNFTBonusesAfterAdd = poolManagerIface.decodeFunctionResult('totalNFTBonusTokens', result)[0];

		expect(Number(totalNFTBonusesAfterAdd)).to.be.equal(Number(totalNFTBonusesBefore) + 1);
		console.log(`✓ Total NFT bonuses after add: ${Number(totalNFTBonusesAfterAdd)}`);

		// Now remove the bonus we just added (last index)
		const indexToRemove = Number(totalNFTBonusesAfterAdd) - 1;

		gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			operatorId,
			'removeNFTBonus',
			[indexToRemove],
			400_000,
		);

		txResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'removeNFTBonus',
			[indexToRemove],
		);

		if (txResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('removeNFTBonus failed');
		}

		console.log(`✓ Removed NFT bonus at index ${indexToRemove} (Gas: ${gasEstimate.gasLimit})`);

		// Wait for mirror node sync
		await sleep(5000);

		// Verify bonus was removed
		encodedCommand = poolManagerIface.encodeFunctionData('totalNFTBonusTokens');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalNFTBonusesAfterRemove = poolManagerIface.decodeFunctionResult('totalNFTBonusTokens', result)[0];

		expect(Number(totalNFTBonusesAfterRemove)).to.be.equal(Number(totalNFTBonusesBefore));
		console.log(`✓ Total NFT bonuses after remove: ${Number(totalNFTBonusesAfterRemove)}`);
	});
});

describe('LazyLotto - Admin Buy Entry Function:', function () {
	it('Should allow admin to buy tickets for a user', async function () {
		console.log('\n-Testing adminBuyEntry() function...');

		client.setOperator(operatorId, operatorKey);

		// Use the first pool for this test
		const poolId = 0;
		const ticketCount = 3;
		const recipientAddress = carolId.toSolidityAddress();

		// Get Carol's entries before
		let encodedCommand = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, recipientAddress]);
		let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const entriesBefore = lazyLottoIface.decodeFunctionResult('getUsersEntries', result)[0];

		console.log(`-Carol's entries before: ${entriesBefore}`);

		// Admin buys tickets for Carol
		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'adminGrantEntry',
			[poolId, ticketCount, recipientAddress],
			800_000,
		);

		const txResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'adminGrantEntry',
			[poolId, ticketCount, recipientAddress],
		);

		if (txResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('adminGrantEntry failed');
		}

		console.log(`✓ Admin bought ${ticketCount} tickets for Carol (Gas: ${gasEstimate.gasLimit})`);
		console.log(parseTransactionRecord(txResult[2]));

		// Wait for mirror node sync
		await sleep(5000);

		// Verify Carol's entries increased
		encodedCommand = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, recipientAddress]);
		result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const entriesAfter = lazyLottoIface.decodeFunctionResult('getUsersEntries', result)[0];

		expect(Number(entriesAfter)).to.be.equal(Number(entriesBefore) + ticketCount);
		console.log(`✓ Carol's entries after: ${entriesAfter} (increased by ${ticketCount})`);
	});

	it('Should reject non-admin adminGrantEntry', async function () {
		console.log('\n-Testing adminGrantEntry() non-admin rejection...');

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			client.setOperator(aliceId, alicePK);

			const poolId = 0;
			const ticketCount = 1;
			const recipientAddress = bobId.toSolidityAddress();

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				aliceId,
				'adminGrantEntry',
				[poolId, ticketCount, recipientAddress],
				800_000,
			);

			const txResult = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'adminGrantEntry',
				[poolId, ticketCount, recipientAddress],
			);

			if (txResult[0]?.status?.name == 'NotAdmin') {
				expectedErrors++;
				console.log('✓ Non-admin adminGrantEntry correctly rejected');
			}
			else {
				console.log('txResult:', txResult);
				unexpectedErrors++;
			}
		}
		catch (error) {
			// Contract reverts are expected
			if (error.message?.includes('CONTRACT_REVERT_EXECUTED') || error.message?.includes('NotAdmin')) {
				expectedErrors++;
				console.log('✓ Non-admin adminGrantEntry correctly rejected (via exception)');
			}
			else {
				console.log('✗ Unexpected error:', error.message);
				unexpectedErrors++;
			}
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
	});
});

describe('LazyLotto - View Functions Coverage:', function () {
	it('Should retrieve user entries for a pool', async function () {
		console.log('\n-Testing getUsersEntries() view function...');

		const poolId = 0;
		const userAddress = aliceId.toSolidityAddress();

		const encodedCommand = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, userAddress]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const entries = lazyLottoIface.decodeFunctionResult('getUsersEntries', result)[0];

		console.log(`✓ Alice's entries in pool ${poolId}: ${entries}`);
		expect(Number(entries)).to.be.greaterThan(0);
	});

	it('Should retrieve total number of pools', async function () {
		console.log('\n-Testing totalPools() view function...');

		const encodedCommand = lazyLottoIface.encodeFunctionData('totalPools');
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		const totalPools = lazyLottoIface.decodeFunctionResult('totalPools', result)[0];

		console.log(`✓ Total pools created: ${totalPools}`);
		expect(Number(totalPools)).to.be.greaterThan(0);
	});

	it('Should retrieve total time bonuses', async function () {
		console.log('\n-Testing totalTimeBonuses() view function...');

		const encodedCommand = poolManagerIface.encodeFunctionData('totalTimeBonuses');
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalTimeBonuses = poolManagerIface.decodeFunctionResult('totalTimeBonuses', result)[0];

		console.log(`✓ Total time bonuses: ${totalTimeBonuses}`);
		expect(Number(totalTimeBonuses)).to.be.greaterThan(0);
	});

	it('Should retrieve total NFT bonus tokens', async function () {
		console.log('\n-Testing totalNFTBonusTokens() view function...');

		const encodedCommand = poolManagerIface.encodeFunctionData('totalNFTBonusTokens');
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalNFTBonusTokens = poolManagerIface.decodeFunctionResult('totalNFTBonusTokens', result)[0];

		console.log(`✓ Total NFT bonus tokens: ${totalNFTBonusTokens}`);
		expect(Number(totalNFTBonusTokens)).to.be.greaterThan(0);
	});

	it('Should retrieve pending prize information', async function () {
		console.log('\n-Testing getPendingPrize() view function...');

		let found = false;

		// not sure if anyone has pending prizes, call getPendingPrizesPage() for each user until there is an array.length >0
		for (const userId of [aliceId, bobId, carolId, operatorId]) {

			const prizeIndex = 0;
			const userAddress = userId.toSolidityAddress();

			// Call getPendingPrizesCount() and getPendingPrizesPage() for each user until there is an array.length >0
			const countQuery = lazyLottoIface.encodeFunctionData('getPendingPrizesCount', [userAddress]);
			const countResult = await readOnlyEVMFromMirrorNode(env, contractId, countQuery, operatorId, false);
			const prizeCount = lazyLottoIface.decodeFunctionResult('getPendingPrizesCount', countResult);

			const encodedCommandCheck = lazyLottoIface.encodeFunctionData('getPendingPrizesPage', [userAddress, 0, Number(prizeCount[0])]);
			const resultCheck = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommandCheck, operatorId, false);
			const pendingPrizes = lazyLottoIface.decodeFunctionResult('getPendingPrizesPage', resultCheck)[0];
			console.log(`✓ ${userAddress} has ${pendingPrizes.length} pending prizes`);

			if (pendingPrizes.length > 0) {
				const encodedCommand = lazyLottoIface.encodeFunctionData('getPendingPrize', [userAddress, prizeIndex]);
				const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
				const pendingPrize = lazyLottoIface.decodeFunctionResult('getPendingPrize', result)[0];

				console.log('PP:', pendingPrize);

				console.log(`\n-User ${userAddress} pending prize details:`);
				console.log(`✓ Pending prize at index ${prizeIndex}:`);
				console.log(`  - Pool ID: ${pendingPrize[0]}`);
				console.log(`  - AsNFT: ${pendingPrize[1]}`);
				console.log(`  - Token: ${pendingPrize[2][0]}`);
				console.log(`  - Amount: ${pendingPrize[2][1]}`);
				console.log(`  - NFTs: ${pendingPrize[2][2].map((s) => TokenId.fromEvmAddress(0, 0, s).toString()).join(', ')}`);
				console.log(`  - Serials: ${pendingPrize[2][3].join(', ')}`);

				found = true;
				break;
				// Exit loop after finding first user with pending prizes
			}
		}

		if (!found) {
			console.log('✓ No users with pending prizes found to display details.');
		}
	});
});

describe('LazyLotto - Remove Admin Positive Case:', function () {
	it('Should allow admin removal when multiple admins exist', async function () {
		console.log('\n-Testing removeAdmin() with multiple admins...');

		client.setOperator(operatorId, operatorKey);

		// First, add bob as an additional admin
		let gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'addAdmin',
			[bobId.toSolidityAddress()],
			300_000,
		);

		let txResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'addAdmin',
			[bobId.toSolidityAddress()],
		);

		if (txResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('addAdmin failed');
		}

		console.log(`✓ Added Bob as admin (Gas: ${gasEstimate.gasLimit})`);
		console.log(parseTransactionRecord(txResult[2]));

		// Wait for mirror node sync
		await sleep(5000);

		// Verify Bob is an admin by checking if he can perform admin action
		client.setOperator(bobId, bobPK);

		const encodedCommand = lazyLottoIface.encodeFunctionData('isAdmin', [bobId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, bobId, false);
		const isBobAdmin = lazyLottoIface.decodeFunctionResult('isAdmin', result)[0];

		expect(isBobAdmin).to.be.equal(true);
		console.log('✓ Bob confirmed as admin');

		// Now remove Bob as admin
		client.setOperator(operatorId, operatorKey);

		gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'removeAdmin',
			[bobId.toSolidityAddress()],
			300_000,
		);

		txResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'removeAdmin',
			[bobId.toSolidityAddress()],
		);

		if (txResult[0]?.status?.toString() !== 'SUCCESS') {
			fail('removeAdmin failed');
		}

		console.log(`✓ Removed Bob as admin (Gas: ${gasEstimate.gasLimit})`);

		// Wait for mirror node sync
		await sleep(5000);

		// Verify Bob is no longer an admin
		const encodedCommand2 = lazyLottoIface.encodeFunctionData('isAdmin', [bobId.toSolidityAddress()]);
		const result2 = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand2, operatorId, false);
		const isBobAdminAfter = lazyLottoIface.decodeFunctionResult('isAdmin', result2)[0];

		expect(isBobAdminAfter).to.be.equal(false);
		console.log('✓ Bob confirmed as no longer admin');
	});
});

describe('LazyLotto - Error Handling and Edge Cases:', function () {
	it('Should reject non-admin/PrizeManager prize additions', async () => {
		const prizeAmount = new Hbar(1);
		const nftTokens = [];
		const nftSerials = [];

		const poolId = 0;

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			// Set Alice as operator (non-admin)
			client.setOperator(aliceId, alicePK);

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				aliceId,
				'addPrizePackage',
				[poolId, ZERO_ADDRESS, Number(prizeAmount.toTinybars()), nftTokens, nftSerials],
				2_000_000,
				Number(prizeAmount.toTinybars()),
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'addPrizePackage',
				[poolId, ZERO_ADDRESS, Number(prizeAmount.toTinybars()), nftTokens, nftSerials],
				prizeAmount,
			);

			if (result[0]?.status?.name != 'NotAuthorized') {
				console.log('Operation succeeded unexpectedly:', parseTransactionRecord(result[2]));
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('-Expected error correctly caught');
	});

	it('Should reject invalid pool operations', async () => {
		const invalidPoolId = 999;
		const ticketCount = 1;

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			// Set Carol as operator
			client.setOperator(carolId, carolPK);

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				carolId,
				'buyEntry',
				[invalidPoolId, ticketCount],
				2_000_000,
				Number(new Hbar(1).toTinybars()),
			);

			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit,
				'buyEntry',
				[invalidPoolId, ticketCount],
				new Hbar(1),
			);

			if (!result[0]?.status?.name.startsWith('LottoPoolNotFound')) {
				console.log('Operation succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch {
			unexpectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('-Expected error correctly caught');
	});

	it('Should reject rolling with no entries', async () => {
		let expectedErrors = 0;
		let unexpectedErrors = 0;
		const poolId = 0;

		try {
			// Set Carol as operator
			client.setOperator(carolId, carolPK);

			const gasEstimate = await estimateGas(
				env,
				contractId,
				lazyLottoIface,
				carolId,
				'rollAll',
				[poolId],
				2_000_000,
			);

			// check that Carol has no entries in the pool
			const encodedCommand = lazyLottoIface.encodeFunctionData('getUsersEntries', [poolId, carolId.toSolidityAddress()]);
			let result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, carolId, false);
			const entries = lazyLottoIface.decodeFunctionResult('getUsersEntries', result)[0];

			if (Number(entries) > 0) {
				// add a prize to ensure rollAll can be called
				console.log('-Adding prize package for clean test slate');
				client.setOperator(operatorId, operatorKey);
				const prizeAmount = new Hbar(1);
				const nftTokens = [];
				const nftSerials = [];
				const gasEstimatePrize = await estimateGas(
					env,
					contractId,
					lazyLottoIface,
					operatorId,
					'addPrizePackage',
					[poolId, ZERO_ADDRESS, Number(prizeAmount.toTinybars()), nftTokens, nftSerials],
					2_000_000,
					Number(prizeAmount.toTinybars()),
				);

				result = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimatePrize.gasLimit,
					'addPrizePackage',
					[poolId, ZERO_ADDRESS, Number(prizeAmount.toTinybars()), nftTokens, nftSerials],
					prizeAmount,
				);

				if (result[0]?.status?.toString() !== 'SUCCESS') {
					fail('addPrizePackage failed');
				}

				// set Carol back as operator
				client.setOperator(carolId, carolPK);

				// we need to rollAll twice to clear her entries
				console.log('-Clearing Carol entries for clean test slate');
				result = await contractExecuteFunction(
					contractId,
					lazyLottoIface,
					client,
					gasEstimate.gasLimit * 2,
					'rollAll',
					[poolId],
				);

				if (result[0]?.status?.toString() !== 'SUCCESS') {
					fail('rollAll failed to clear entries');
				}
			}

			result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				gasEstimate.gasLimit * 2,
				'rollAll',
				[poolId],
			);

			if (!result[0]?.status?.name.startsWith('NoTickets')) {
				console.log('Operation succeeded unexpectedly:', result);
				unexpectedErrors++;
			}
			else {
				expectedErrors++;
			}
		}
		catch (error) {
			// Contract reverts are expected
			if (error.message?.includes('CONTRACT_REVERT_EXECUTED') || error.message?.includes('NoTickets')) {
				expectedErrors++;
				console.log('✓ NoTickets correctly rejected (via exception)');
			}
			else {
				console.log('✗ Unexpected error:', error.message);
				unexpectedErrors++;
			}
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('-Expected error correctly caught');
	});
});

describe('LazyLotto - Time-Based Testing Scenarios:', function () {
	it('TIME-SENSITIVE: Bonus Window Activation and Boundary Precision (12s test)', async () => {
		console.log('\n\t🕐 QUICK TIME TEST: Time Bonus Window & Boundaries');
		console.log('\t━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('\t   Tests: Time bonus applies during rolling (not purchase)');

		try {
			// Set Admin as operator
			client.setOperator(adminId, adminPK);

			// clear existing time bonuses
			let encodedCommand = poolManagerIface.encodeFunctionData('totalTimeBonuses');
			let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, adminId, false);
			let totalBonuses = poolManagerIface.decodeFunctionResult('totalTimeBonuses', result)[0];

			while (Number(totalBonuses) > 0) {
				const indexToRemove = Number(totalBonuses) - 1;
				const gasEstimate = await estimateGas(
					env,
					poolManagerId,
					poolManagerIface,
					adminId,
					'removeTimeBonus',
					[indexToRemove],
					2_000_000,
				);
				result = await contractExecuteFunction(
					poolManagerId,
					poolManagerIface,
					client,
					gasEstimate.gasLimit,
					'removeTimeBonus',
					[indexToRemove],
				);
				if (result[0]?.status?.toString() !== 'SUCCESS') {
					console.log('\tFailed to remove existing time bonus:', result[0]?.status?.toString());
					fail('Failed to remove existing time bonus');
				}
				totalBonuses--;
			}

			// remove lazy balance bonus
			const gasEstimateRemoveBalanceBonus = await estimateGas(
				env,
				poolManagerId,
				poolManagerIface,
				adminId,
				'setLazyBalanceBonus',
				[0, 0],
				2_000_000,
			);

			result = await contractExecuteFunction(
				poolManagerId,
				poolManagerIface,
				client,
				gasEstimateRemoveBalanceBonus.gasLimit,
				'setLazyBalanceBonus',
				[0, 0],
			);
			if (result[0]?.status?.toString() !== 'SUCCESS') {
				console.log('\tFailed to remove lazy balance bonus:', result[0]?.status?.toString());
				fail('Failed to remove lazy balance bonus');
			}
			// clear nft bonuses
			encodedCommand = poolManagerIface.encodeFunctionData('totalNFTBonusTokens');
			result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, adminId, false);
			let totalNftBonuses = poolManagerIface.decodeFunctionResult('totalNFTBonusTokens', result)[0];

			while (Number(totalNftBonuses) > 0) {
				const indexToRemove = Number(totalNftBonuses) - 1;
				const gasEstimate = await estimateGas(
					env,
					poolManagerId,
					poolManagerIface,
					adminId,
					'removeNFTBonus',
					[indexToRemove],
					2_000_000,
				);
				result = await contractExecuteFunction(
					poolManagerId,
					poolManagerIface,
					client,
					gasEstimate.gasLimit,
					'removeNFTBonus',
					[indexToRemove],
				);
				if (result[0]?.status?.toString() !== 'SUCCESS') {
					console.log('\tFailed to remove existing NFT bonus:', result[0]?.status?.toString());
					fail('Failed to remove existing NFT bonus');
				}
				totalNftBonuses--;
			}

			console.log('\t✓ Cleared existing bonuses for clean test slate');

			await sleep(5000);


			const currentTime = Math.floor(Date.now() / 1000);
			const startTime = currentTime + 6;
			const endTime = currentTime + 11;
			// 10% bonus (1000 bps)
			const bonusBps = 1000;

			const gasEstimate = await estimateGas(
				env,
				poolManagerId,
				poolManagerIface,
				adminId,
				'setTimeBonus',
				[startTime, endTime, bonusBps],
				2_000_000,
			);

			result = await contractExecuteFunction(
				poolManagerId,
				poolManagerIface,
				client,
				gasEstimate.gasLimit,
				'setTimeBonus',
				[startTime, endTime, bonusBps],
			);			if (result[0]?.status?.toString() !== 'SUCCESS') {
				console.log('\tSetTimeBonus failed:', result[0]?.status?.toString());
				fail('SetTimeBonus failed');
			}

			console.log('\t✓ Bonus window configured (3s -> 11s, 10% bonus = 1000 bps)');

			// Test 1: Before window starts
			console.log('\t⏱️  Test 1: 1 second before bonus start...');
			// sleep until 2s before start
			const sleepDuration1 = (startTime - 2 - Math.floor(Date.now() / 1000)) * 1000;
			await sleep(Math.max(sleepDuration1, 1));

			const boostBefore = await contractExecuteQuery(
				poolManagerId,
				poolManagerIface,
				client,
				200_000,
				'calculateBoost',
				[aliceId.toSolidityAddress()],
			);			const boostValueBefore = Number(boostBefore[0]);
			console.log(`\t   Boost: ${boostValueBefore} (expected 0)`);
			expect(boostValueBefore).to.equal(0, 'Boost should be 0 before window');

			// Test 2: At start boundary (±1s tolerance)
			console.log('\t⏱️  Test 2: At bonus start boundary...');
			await sleep(3250);

			console.log(`\t   (Current time: ${Math.floor(Date.now() / 1000)}, Bonus start: ${startTime} / delta: ${Math.floor(Date.now() / 1000) - startTime}s)`);

			const boostAtStart = await contractExecuteQuery(
				poolManagerId,
				poolManagerIface,
				client,
				200_000,
				'calculateBoost',
				[bobId.toSolidityAddress()],
			);			const boostValueAtStart = Number(boostAtStart[0]);
			console.log(`\t   Boost: ${boostValueAtStart} (expected 10,000,000 = 1000 bps * 10000)`);
			expect(boostValueAtStart).to.equal(10_000_000, 'Boost should be active at start');

			// Test 3: Mid-window
			console.log('\t⏱️  Test 3: Mid-window check...');
			await sleep(1500);

			const boostMidWindow = await contractExecuteQuery(
				poolManagerId,
				poolManagerIface,
				client,
				200_000,
				'calculateBoost',
				[carolId.toSolidityAddress()],
			);			const boostValueMid = Number(boostMidWindow[0]);
			console.log(`\t   Boost: ${boostValueMid} (expected 10,000,000)`);
			expect(boostValueMid).to.equal(10_000_000, 'Boost should be active mid-window');


			// Test 4: After window expires
			console.log('\t⏱️  Test 4: 2 seconds after bonus end...');
			await sleep(4000);

			const boostAfter = await contractExecuteQuery(
				poolManagerId,
				poolManagerIface,
				client,
				200_000,
				'calculateBoost',
				[bobId.toSolidityAddress()],
			);			const boostValueAfter = Number(boostAfter[0]);
			console.log(`\t   Boost: ${boostValueAfter} (expected 0)`);
			expect(boostValueAfter).to.equal(0, 'Boost should be 0 after window expires');

			console.log('\t✅ Time bonus test completed successfully (12s total)');
			console.log('\t   ✓ Time bonus correctly applies only during rolling window');
			console.log('\t   ✓ Boundary timing accuracy: ±1-2 seconds (blockchain limits)');

		}
		catch (error) {
			console.log('\t✗ Time bonus test failed:', error.message);
			expect.fail('Time bonus test failed');
		}
	});
});

describe('LazyLotto - Audit Fix: Admin Withdrawal Safety Checks:', function () {
	it('Should reject transferHbarFromStorage when it would breach combined obligations', async function () {
		console.log('\n-Testing transferHbarFromStorage safety check...');

		client.setOperator(operatorId, operatorKey);

		await sleep(5000);

		// Step 1: Get storage contract HBAR balance
		const storageBalanceTinybars = await checkMirrorHbarBalance(env, storageContractId);
		console.log(`-Storage contract HBAR balance: ${storageBalanceTinybars} tinybars`);

		// Step 2: Query getFungiblesNeededForPrizes for HBAR (address(0))
		const prizesCmd = lazyLottoIface.encodeFunctionData('getFungiblesNeededForPrizes', [ZERO_ADDRESS]);
		const prizesResult = await readOnlyEVMFromMirrorNode(env, contractId, prizesCmd, operatorId, false);
		const prizesNeeded = lazyLottoIface.decodeFunctionResult('getFungiblesNeededForPrizes', prizesResult);
		const prizesAmount = BigInt(prizesNeeded[0]);
		console.log(`-HBAR prizes obligation: ${prizesAmount}`);

		// Step 3: Query PoolManager pendingWithdrawals for HBAR
		const pendingCmd = poolManagerIface.encodeFunctionData('pendingWithdrawals', [ZERO_ADDRESS]);
		const pendingResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, pendingCmd, operatorId, false);
		const pendingAmount = BigInt(poolManagerIface.decodeFunctionResult('pendingWithdrawals', pendingResult)[0]);
		console.log(`-HBAR pending withdrawals: ${pendingAmount}`);

		// Step 4: Query PoolManager getPlatformBalance for HBAR
		const platformCmd = poolManagerIface.encodeFunctionData('getPlatformBalance', [ZERO_ADDRESS]);
		const platformResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, platformCmd, operatorId, false);
		const platformAmount = BigInt(poolManagerIface.decodeFunctionResult('getPlatformBalance', platformResult)[0]);
		console.log(`-HBAR platform balance: ${platformAmount}`);

		// Step 5: Calculate total obligations and surplus
		const totalObligations = prizesAmount + pendingAmount + platformAmount;
		const storageBalance = BigInt(storageBalanceTinybars);
		console.log(`-Total obligations: ${totalObligations}`);
		console.log(`-Storage balance: ${storageBalance}`);

		// Calculate one more than the allowed withdrawal
		const surplus = storageBalance > totalObligations ? storageBalance - totalObligations : 0n;
		const overWithdrawAmount = surplus + 1n;
		console.log(`-Surplus: ${surplus}, attempting to withdraw: ${overWithdrawAmount}`);

		// Step 6: Try to withdraw more than allowed — should revert
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				contractId,
				lazyLottoIface,
				client,
				500_000,
				'transferHbarFromStorage',
				[operatorId.toSolidityAddress(), overWithdrawAmount],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				expectedErrors++;
				console.log(`\t✓ Correctly rejected withdrawal: ${result[0]?.status?.toString()}`);
			}
			else {
				unexpectedErrors++;
				console.log('\t✗ Withdrawal should have been rejected but succeeded');
			}
		}
		catch (error) {
			if (error.message?.includes('CONTRACT_REVERT_EXECUTED') || error.message?.includes('BalanceError')) {
				expectedErrors++;
				console.log('\t✓ Correctly reverted with BalanceError');
			}
			else {
				unexpectedErrors++;
				console.log('\t✗ Unexpected error:', error.message);
			}
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);
		console.log('-Safety check prevents over-withdrawal of HBAR from storage');
	});

	it('Should allow transferHbarFromStorage when sufficient surplus exists', async function () {
		console.log('\n-Testing transferHbarFromStorage with valid surplus...');

		client.setOperator(operatorId, operatorKey);

		await sleep(5000);

		// Step 1: Get storage contract HBAR balance
		const storageBalanceTinybars = await checkMirrorHbarBalance(env, storageContractId);
		console.log(`-Storage contract HBAR balance: ${storageBalanceTinybars} tinybars`);

		// Step 2: Query getFungiblesNeededForPrizes for HBAR
		const prizesCmd = lazyLottoIface.encodeFunctionData('getFungiblesNeededForPrizes', [ZERO_ADDRESS]);
		const prizesResult = await readOnlyEVMFromMirrorNode(env, contractId, prizesCmd, operatorId, false);
		const prizesNeeded = lazyLottoIface.decodeFunctionResult('getFungiblesNeededForPrizes', prizesResult);
		const prizesAmount = BigInt(prizesNeeded[0]);

		// Step 3: Query PoolManager pendingWithdrawals for HBAR
		const pendingCmd = poolManagerIface.encodeFunctionData('pendingWithdrawals', [ZERO_ADDRESS]);
		const pendingResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, pendingCmd, operatorId, false);
		const pendingAmount = BigInt(poolManagerIface.decodeFunctionResult('pendingWithdrawals', pendingResult)[0]);

		// Step 4: Query PoolManager getPlatformBalance for HBAR
		const platformCmd = poolManagerIface.encodeFunctionData('getPlatformBalance', [ZERO_ADDRESS]);
		const platformResult = await readOnlyEVMFromMirrorNode(env, poolManagerId, platformCmd, operatorId, false);
		const platformAmount = BigInt(poolManagerIface.decodeFunctionResult('getPlatformBalance', platformResult)[0]);

		// Step 5: Calculate surplus
		const totalObligations = prizesAmount + pendingAmount + platformAmount;
		const storageBalance = BigInt(storageBalanceTinybars);
		const surplus = storageBalance > totalObligations ? storageBalance - totalObligations : 0n;

		console.log(`-Total obligations: ${totalObligations}`);
		console.log(`-Surplus available: ${surplus}`);

		if (surplus === 0n) {
			console.log('-No surplus available, skipping withdrawal test');
			console.log('\t✓ Test skipped (no surplus to withdraw)');
			return;
		}

		// Withdraw 1 tinybar (minimal safe withdrawal)
		const withdrawAmount = 1n;
		console.log(`-Attempting to withdraw ${withdrawAmount} tinybar...`);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'transferHbarFromStorage',
			[operatorId.toSolidityAddress(), withdrawAmount],
			500_000,
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'transferHbarFromStorage',
			[operatorId.toSolidityAddress(), withdrawAmount],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('\t✗ Withdrawal failed:', result[0]?.status?.toString());
			fail('Valid surplus withdrawal should succeed');
		}

		console.log('\t✓ Successfully withdrew 1 tinybar from surplus');
		console.log(`\t  Transaction ID: ${result[2]?.transactionId?.toString()}`);
		console.log(parseTransactionRecord(result[2]));
	});
});

describe('LazyLotto - Audit Fix: outstandingEntries NFT Fix:', function () {
	// Module-scoped variables for this test suite
	let auditPoolId;
	let auditPoolTokenId;

	it('Should create a new pool for outstandingEntries tracking test', async function () {
		console.log('\n-Creating new pool for outstandingEntries audit test...');

		client.setOperator(operatorId, operatorKey);

		const gasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			operatorId,
			'createPool',
			[
				'Audit Entries Pool',
				'AEP',
				'Pool for testing outstandingEntries fix',
				[],
				'QmAuditTicketCID',
				'QmAuditWinCID',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				ZERO_ADDRESS,
			],
			3_000_000,
			Number(new Hbar(MINT_PAYMENT, HbarUnit.Hbar).toTinybars()),
		);

		const result = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'createPool',
			[
				'Audit Entries Pool',
				'AEP',
				'Pool for testing outstandingEntries fix',
				[],
				'QmAuditTicketCID',
				'QmAuditWinCID',
				WIN_RATE_THRESHOLD,
				ENTRY_FEE_HBAR,
				ZERO_ADDRESS,
			],
			new Hbar(MINT_PAYMENT, HbarUnit.Hbar),
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Pool creation failed:', result[0]?.status?.toString());
			fail('Audit test pool creation failed');
		}

		auditPoolId = Number(result[1][0]);
		console.log(`-Created audit test Pool ID: ${auditPoolId}`);
		console.log(parseTransactionRecord(result[2]));

		await sleep(5000);

		// Get the pool token ID for association
		const poolCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [auditPoolId]);
		const poolResult = await readOnlyEVMFromMirrorNode(env, contractId, poolCommand, operatorId, false);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', poolResult);
		auditPoolTokenId = TokenId.fromSolidityAddress(poolDetails[6]);
		console.log(`-Pool ticket token: ${auditPoolTokenId.toString()}`);

		// Associate Bob with the new pool's ticket token
		client.setOperator(bobId, bobPK);
		const assocResult = await associateTokensToAccount(
			client,
			bobId,
			bobPK,
			[auditPoolTokenId],
		);
		expect(assocResult).to.be.equal('SUCCESS');
		console.log(`-Associated ticket token to Bob (${bobId.toString()})`);
	});

	it('Should correctly track outstandingEntries after redeemEntriesToNFT', async function () {
		console.log('\n-Testing outstandingEntries tracking after NFT redemption...');

		const ticketCount = 5;

		// Step 1: Bob buys 5 entries
		console.log(`-Bob buying ${ticketCount} entries in pool ${auditPoolId}...`);
		client.setOperator(bobId, bobPK);

		const totalFee = ENTRY_FEE_HBAR * ticketCount;

		const buyGasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			bobId,
			'buyEntry',
			[auditPoolId, ticketCount],
			1_500_000,
			totalFee,
		);

		const buyResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			buyGasEstimate.gasLimit,
			'buyEntry',
			[auditPoolId, ticketCount],
			new Hbar(totalFee, HbarUnit.Tinybar),
		);

		if (buyResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('buyEntry failed:', buyResult[0]?.status?.toString());
			fail('Bob should be able to buy entries');
		}

		console.log('\t✓ Bob purchased 5 entries');
		console.log(parseTransactionRecord(buyResult[2]));

		await sleep(5000);

		// Step 2: Verify outstandingEntries == 5
		let poolCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [auditPoolId]);
		let poolResult = await readOnlyEVMFromMirrorNode(env, contractId, poolCommand, operatorId, false);
		let poolDetails = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', poolResult);
		const outstandingAfterBuy = Number(poolDetails[5]);
		console.log(`-outstandingEntries after buy: ${outstandingAfterBuy}`);
		expect(outstandingAfterBuy).to.be.equal(ticketCount, 'Should have 5 outstanding entries after purchase');
		console.log('\t✓ outstandingEntries == 5 after purchase');

		// Step 3: Bob redeems 3 entries to NFTs
		const redeemCount = 3;
		console.log(`-Bob redeeming ${redeemCount} entries to NFTs...`);
		client.setOperator(bobId, bobPK);

		const redeemGasEstimate = await estimateGas(
			env,
			contractId,
			lazyLottoIface,
			bobId,
			'redeemEntriesToNFT',
			[auditPoolId, redeemCount],
			1_500_000,
		);

		const redeemResult = await contractExecuteFunction(
			contractId,
			lazyLottoIface,
			client,
			redeemGasEstimate.gasLimit,
			'redeemEntriesToNFT',
			[auditPoolId, redeemCount],
		);

		if (redeemResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('redeemEntriesToNFT failed:', redeemResult[0]?.status?.toString());
			fail('Bob should be able to redeem entries to NFTs');
		}

		console.log('\t✓ Bob redeemed 3 entries to NFTs');
		console.log(parseTransactionRecord(redeemResult[2]));

		await sleep(5000);

		// Step 4: Verify outstandingEntries == 2 (NOT still 5)
		poolCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [auditPoolId]);
		poolResult = await readOnlyEVMFromMirrorNode(env, contractId, poolCommand, operatorId, false);
		poolDetails = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', poolResult);
		const outstandingAfterRedeem = Number(poolDetails[5]);
		console.log(`-outstandingEntries after redeem: ${outstandingAfterRedeem}`);
		expect(outstandingAfterRedeem).to.be.equal(
			ticketCount - redeemCount,
			`Should have ${ticketCount - redeemCount} outstanding entries after redeeming ${redeemCount}`,
		);
		console.log(`\t✓ outstandingEntries == ${ticketCount - redeemCount} after redeeming ${redeemCount} to NFTs`);
		console.log('\t✓ Audit fix verified: outstandingEntries correctly decremented on NFT redemption');
	});
});

describe('LazyLotto - Cleanup:', function () {
	it('Should clear allowances for cleanup', async function () {
		console.log('\n-Starting cleanup...');

		// Parallelize clearing LAZY allowances
		const clearancePromises = lazyAllowancesSet.map(async (account) => {
			client.setOperator(account.id, account.key);

			const allowanceList = [
				{ tokenId: lazyTokenId, owner: account.id, spender: lazyGasStationId },
			];

			await clearFTAllowances(client, allowanceList);
			return account;
		});

		await Promise.all(clearancePromises);

		console.log('-Allowances cleared');
	});

	it('Should sweep HBAR from test accounts', async function () {
		await sleep(5000);
		client.setOperator(operatorId, operatorKey);
		// Parallelize HBAR sweeping
		const sweepPromises = createdAccounts.map(async (account) => {
			const hbarAmount = await checkMirrorHbarBalance(env, account.id);
			if (hbarAmount && hbarAmount > 1000000) {
				console.log(`-Account ${account.id.toString()} HBAR balance: ${hbarAmount} tinybars`);

				const sweepResult = await sweepHbar(
					client,
					account.id,
					account.key,
					operatorId,
					new Hbar(hbarAmount - 500000, HbarUnit.Tinybar),
				);
				if (sweepResult !== 'SUCCESS') {
					console.log(`HBAR sweep failed for ${account.id.toString()}:`, sweepResult);
				}
			}
			return account;
		});

		await Promise.all(sweepPromises);

		console.log('-HBAR sweep completed');
	});
});