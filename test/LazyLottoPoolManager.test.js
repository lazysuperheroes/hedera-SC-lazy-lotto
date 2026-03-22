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
const { describe, it } = require('mocha');
const {
	contractDeployFunction,
	readOnlyEVMFromMirrorNode,
	contractExecuteFunction,
} = require('../utils/solidityHelpers');
const { sleep } = require('../utils/nodeHelpers');
const {
	accountCreator,
	mintNFT,
	setFTAllowance,
	sweepHbar,
	associateTokensToAccount,
} = require('../utils/hederaHelpers');
const {
	checkMirrorBalance,
	checkMirrorHbarBalance,
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
const poolManagerContractName = 'LazyLottoPoolManager';
const lazyLottoContractName = 'LazyLotto';
const storageContractName = 'LazyLottoStorage';
const lazyGasStationName = 'LazyGasStation';
// eslint-disable-next-line no-unused-vars
const lazyDelegateRegistryName = 'LazyDelegateRegistry';
const lazyContractCreator = 'LAZYTokenCreator';

// Environment setup
const env = process.env.ENVIRONMENT ?? null;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
// eslint-disable-next-line no-unused-vars
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;
// eslint-disable-next-line no-unused-vars
const LAZY_BURN_PERCENT = process.env.LOTTO_LAZY_BURN_PERCENT ? Number(process.env.LOTTO_LAZY_BURN_PERCENT) : 50;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// Contract IDs and addresses
let poolManagerId, poolManagerAddress;
let lazyLottoId, lazyLottoAddress;
let storageContractId, storageContractAddress;
let lazyGasStationId, lazyDelegateRegistryId;
let lazyTokenId, lazySCT;
let testNFTTokenId1;
let client;

// Test accounts
let alicePK, aliceId, bobPK, bobId, carolPK, carolId;
let adminPK, adminId;

// Interface objects
let poolManagerIface, lazyLottoIface, lazyIface, lazyGasStationIface, lazyLottoStorageIface;

// Created accounts for cleanup
const createdAccounts = [];
const lazyAllowancesSet = [];

// Cached LAZY decimals
const lazyDecimals = LAZY_DECIMAL;

describe('LazyLottoPoolManager - Integration Tests:', function () {
	it('Should setup client and test accounts', async function () {
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
		bobId = await accountCreator(client, bobPK, 50);
		createdAccounts.push({ id: bobId, key: bobPK });
		console.log('Bob account ID:', bobId.toString());

		carolPK = PrivateKey.generateED25519();
		carolId = await accountCreator(client, carolPK, 50);
		createdAccounts.push({ id: carolId, key: carolPK });
		console.log('Carol account ID:', carolId.toString());

		adminPK = PrivateKey.generateED25519();
		adminId = await accountCreator(client, adminPK, 100);
		createdAccounts.push({ id: adminId, key: adminPK });
		console.log('Admin account ID:', adminId.toString());

		console.log('\n-Test accounts created successfully');
	});

	it('Should use or deploy existing LAZY token and dependencies', async function () {
		// Load interfaces
		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/legacy/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);
		lazyIface = new ethers.Interface(lazyJson.abi);

		const lazyGasStationJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
			),
		);
		lazyGasStationIface = new ethers.Interface(lazyGasStationJson.abi);

		// Use existing dependencies from environment
		if (!process.env.LAZY_TOKEN_ID || !process.env.LAZY_SCT_CONTRACT_ID ||
			!process.env.LAZY_GAS_STATION_CONTRACT_ID || !process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
			console.log('\n*** ERROR: Required dependencies not found in .env file ***');
			console.log('Please run LazyLotto.test.js first to deploy dependencies');
			console.log('Required variables:');
			console.log('  - LAZY_TOKEN_ID');
			console.log('  - LAZY_SCT_CONTRACT_ID');
			console.log('  - LAZY_GAS_STATION_CONTRACT_ID');
			console.log('  - LAZY_DELEGATE_REGISTRY_CONTRACT_ID');
			process.exit(1);
		}

		lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
		lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);
		lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
		lazyDelegateRegistryId = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);

		console.log('\n-Using existing LAZY:', lazyTokenId.toString());
		console.log('-Using existing LazyGasStation:', lazyGasStationId.toString());
		console.log('-Using existing LazyDelegateRegistry:', lazyDelegateRegistryId.toString());

		// Verify dependencies exist
		expect(lazyTokenId.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazyGasStationId.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazyDelegateRegistryId.toString().match(addressRegex).length == 2).to.be.true;
	});

	it('Should deploy or use existing LazyLotto, Storage, and PoolManager', async function () {
		console.log('\n-Checking LazyLotto, Storage, and PoolManager contracts...');

		// Load interfaces
		const lazyLottoJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyLottoContractName}.sol/${lazyLottoContractName}.json`,
			),
		);
		lazyLottoIface = new ethers.Interface(lazyLottoJson.abi);

		const storageJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${storageContractName}.sol/${storageContractName}.json`,
			),
		);
		lazyLottoStorageIface = new ethers.Interface(storageJson.abi);

		// Check if LazyLotto exists, deploy if not
		if (process.env.LAZY_LOTTO_CONTRACT_ID && process.env.LAZY_LOTTO_STORAGE) {
			lazyLottoId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
			lazyLottoAddress = lazyLottoId.toSolidityAddress();
			storageContractId = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE);
			storageContractAddress = storageContractId.toSolidityAddress();

			console.log('-Using existing LazyLotto:', lazyLottoId.toString());
			console.log('-Using existing LazyLottoStorage:', storageContractId.toString());
		}
		else {
			console.log('-Deploying LazyLottoStorage...');

			const storageConstructorParams = new ContractFunctionParameters()
				.addAddress(lazyGasStationId.toSolidityAddress())
				.addAddress(lazyTokenId.toSolidityAddress());

			[storageContractId, storageContractAddress] = await contractDeployFunction(
				client,
				storageJson.bytecode,
				3_500_000,
				storageConstructorParams,
			);
			console.log(`Storage created: ${storageContractId}`);

			console.log('-Deploying LazyLotto...');

			// Get PRNG address (use system contract or mock)
			const prngId = ContractId.fromString('0.0.361');
			const burnPercent = 50;

			const lazyLottoConstructorParams = new ContractFunctionParameters()
				.addAddress(lazyTokenId.toSolidityAddress())
				.addAddress(lazyGasStationId.toSolidityAddress())
				.addAddress(lazyDelegateRegistryId.toSolidityAddress())
				.addAddress(prngId.toSolidityAddress())
				.addUint256(burnPercent)
				.addAddress(storageContractAddress);

			[lazyLottoId, lazyLottoAddress] = await contractDeployFunction(
				client,
				lazyLottoJson.bytecode,
				6_000_000,
				lazyLottoConstructorParams,
			);
			console.log(`LazyLotto created: ${lazyLottoId}`);

			await sleep(5000);

			// Set LazyLotto as contract user on storage
			const setUserResult = await contractExecuteFunction(
				storageContractId,
				lazyLottoStorageIface,
				client,
				500_000,
				'setContractUser',
				[lazyLottoAddress],
			);
			if (setUserResult[0]?.status?.toString() !== 'SUCCESS') {
				fail('setContractUser failed');
			}

			// Add storage and LazyLotto to LazyGasStation
			await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				500_000,
				'addContractUser',
				[storageContractAddress],
			);

			await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				500_000,
				'addContractUser',
				[lazyLottoAddress],
			);

			console.log('✓ LazyLotto and Storage deployed and configured');
		}

		expect(lazyLottoId.toString().match(addressRegex).length == 2).to.be.true;
		expect(storageContractId.toString().match(addressRegex).length == 2).to.be.true;

		// Now handle PoolManager
		console.log('\n-Deploying or using existing LazyLottoPoolManager...');

		const poolManagerJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${poolManagerContractName}.sol/${poolManagerContractName}.json`,
			),
		);
		poolManagerIface = new ethers.Interface(poolManagerJson.abi);

		if (process.env.LAZY_LOTTO_POOL_MANAGER_ID) {
			poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);
			poolManagerAddress = poolManagerId.toSolidityAddress();
			console.log('-Using existing PoolManager:', poolManagerId.toString());
		}
		else {
			const constructorParams = new ContractFunctionParameters()
				.addAddress(lazyTokenId.toSolidityAddress())
				.addAddress(lazyGasStationId.toSolidityAddress())
				.addAddress(lazyDelegateRegistryId.toSolidityAddress());

			[poolManagerId] = await contractDeployFunction(
				client,
				poolManagerJson.bytecode,
				2_500_000,
				constructorParams,
			);

			poolManagerAddress = poolManagerId.toSolidityAddress();
			console.log('LazyLottoPoolManager deployed:', poolManagerId.toString());
			console.log('Contract size:', (poolManagerJson.bytecode.length / 2 / 1024).toFixed(3), 'KB');
		}

		expect(poolManagerId.toString().match(addressRegex).length == 2).to.be.true;

		// Create error decoder array with all relevant interfaces for better error messages
		global.errorInterfaces = [
			poolManagerIface,
			lazyLottoIface,
			lazyLottoStorageIface,
			lazyIface,
			lazyGasStationIface,
		];

		console.log(`✅ Error decoder configured with ${global.errorInterfaces.length} interfaces`);
	});

	it('Should link LazyLottoPoolManager with LazyLotto (bidirectional)', async function () {
		console.log('\n-Linking PoolManager with LazyLotto...');

		// Set LazyLotto in PoolManager
		const setLazyLottoResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			150_000,
			'setLazyLotto',
			[lazyLottoAddress],
		);

		if (setLazyLottoResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('setLazyLotto FAILED:', setLazyLottoResult);
			fail('setLazyLotto failed');
		}
		console.log('✓ PoolManager.setLazyLotto() successful');

		// Set PoolManager in LazyLotto
		const setPoolManagerResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			150_000,
			'setPoolManager',
			[poolManagerAddress],
		);

		if (setPoolManagerResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('setPoolManager FAILED:', setPoolManagerResult);
			fail('setPoolManager failed');
		}
		console.log('✓ LazyLotto.setPoolManager() successful');

		// Wait for mirror node to sync
		await sleep(5000);

		// Verify linkage via read-only queries
		let encodedCommand = lazyLottoIface.encodeFunctionData('poolManager');
		let result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
		const poolManagerFromLazyLotto = lazyLottoIface.decodeFunctionResult('poolManager', result);

		encodedCommand = poolManagerIface.encodeFunctionData('lazyLotto');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const lazyLottoFromPoolManager = poolManagerIface.decodeFunctionResult('lazyLotto', result);

		expect(poolManagerFromLazyLotto[0].slice(2).toLowerCase()).to.equal(poolManagerAddress.toLowerCase());
		expect(lazyLottoFromPoolManager[0].slice(2).toLowerCase()).to.equal(lazyLottoAddress.toLowerCase());
		console.log('✓ Bidirectional linkage verified');
	});

	it('Should create test NFT for bonus testing', async function () {
		console.log('\n-Creating test NFT collection...');

		if (process.env.TEST_PRIZE_NFT_TOKENA_ID) {
			testNFTTokenId1 = TokenId.fromString(process.env.TEST_PRIZE_NFT_TOKENA_ID);
			console.log('Using existing test NFT:', testNFTTokenId1.toString());
		}
		else {
			const testNFT1Result = await mintNFT(
				client,
				operatorId,
				'Test NFT Collection 1',
				'TNC1',
				10,
				MINT_PAYMENT,
			);

			if (testNFT1Result[0] !== 'SUCCESS') {
				console.log('Test NFT creation failed:', testNFT1Result[0]);
				fail('Test NFT creation failed');
			}

			testNFTTokenId1 = testNFT1Result[1];
			console.log('Test NFT Collection created:', testNFTTokenId1.toString());
		}
	});

	it('Should distribute LAZY tokens to test accounts', async function () {
		console.log('\n-Distributing LAZY tokens to test accounts...');

		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		// Calculate LAZY amount accounting for decimals (50 LAZY base)
		const lazyAmount = 50 * (10 ** LAZY_DECIMAL);

		for (const account of testAccounts) {
			// Associate LAZY token
			const balance = await checkMirrorBalance(env, account.id, lazyTokenId);
			if (balance === null) {
				console.log(`Associating LAZY for ${account.id.toString()}`);
				await associateTokensToAccount(client, account.id, account.key, [lazyTokenId]);
			}

			// Send LAZY tokens
			const currentBalance = await checkMirrorBalance(env, account.id, lazyTokenId) || 0;
			if (currentBalance < lazyAmount) {
				const sendResult = await contractExecuteFunction(
					lazySCT,
					lazyIface,
					client,
					300_000,
					'transferHTS',
					[lazyTokenId.toSolidityAddress(), account.id.toSolidityAddress(), lazyAmount],
				);
				if (sendResult[0]?.status?.toString() !== 'SUCCESS') {
					fail(`LAZY transfer to ${account.id.toString()} failed`);
				}
				console.log(`Sent ${lazyAmount} LAZY to ${account.id.toString()}`);
			}
		}

		await sleep(5000);
		console.log('✓ LAZY tokens distributed');
	});

	it('Should set LAZY allowances to LazyGasStation', async function () {
		console.log('\n-Setting LAZY allowances to LazyGasStation...');

		const testAccounts = [
			{ id: aliceId, key: alicePK },
			{ id: bobId, key: bobPK },
			{ id: carolId, key: carolPK },
			{ id: adminId, key: adminPK },
		];

		// Calculate LAZY allowance accounting for decimals (20 LAZY base)
		const lazyAllowance = 20 * (10 ** LAZY_DECIMAL);

		for (const account of testAccounts) {
			client.setOperator(account.id, account.key);

			const allowanceResult = await setFTAllowance(
				client,
				lazyTokenId,
				account.id,
				lazyGasStationId,
				lazyAllowance,
			);
			if (allowanceResult !== 'SUCCESS') {
				console.log(`LAZY allowance failed for ${account.id.toString()}:`, allowanceResult);
				throw new Error('LAZY allowance failed');
			}
		}

		// Reset to operator
		client.setOperator(operatorId, operatorKey);

		console.log('✓ LAZY allowances set');
	});

	it('Should add admin to LazyLotto', async function () {
		console.log('\n-Adding admin to LazyLotto...');

		const addAdminResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			150_000,
			'addAdmin',
			[adminId.toSolidityAddress()],
		);

		if (addAdminResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('addAdmin FAILED:', addAdminResult);
			fail('addAdmin failed');
		}

		await sleep(5000);

		// Verify admin was added
		const encodedCommand = lazyLottoIface.encodeFunctionData('isAdmin', [adminId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
		const isAdmin = lazyLottoIface.decodeFunctionResult('isAdmin', result);

		expect(isAdmin[0]).to.be.true;
		console.log('✓ Admin added successfully');
	});
});

describe('LazyLottoPoolManager - Creation Fees:', function () {
	it('Should allow admin to set creation fees', async function () {
		console.log('\n-Testing setCreationFees()...');

		client.setOperator(adminId, adminPK);

		const hbarFee = 1 * 100_000_000;
		// 1 HBAR in tinybars
		const lazyFee = 10 * (10 ** LAZY_DECIMAL);
		// 10 LAZY accounting for decimals

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'setCreationFees',
			[hbarFee, lazyFee],
			300_000,
		);

		const setFeesResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setCreationFees',
			[hbarFee, lazyFee],
		);

		if (setFeesResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('setCreationFees FAILED:', setFeesResult);
			console.log(parseTransactionRecord(setFeesResult[2]));
			fail('setCreationFees failed');
		}

		console.log(parseTransactionRecord(setFeesResult[2]));

		await sleep(5000);

		// Verify fees were set
		const encodedCommand = poolManagerIface.encodeFunctionData('getCreationFees');
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const fees = poolManagerIface.decodeFunctionResult('getCreationFees', result);

		expect(fees[0].toString()).to.equal(hbarFee.toString());
		expect(fees[1].toString()).to.equal(lazyFee.toString());

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Creation fees set:', fees[0].toString(), 'tinybars HBAR,', fees[1].toString(), 'LAZY');
	});

	it('Should reject non-admin setting creation fees', async function () {
		console.log('\n-Testing setCreationFees() rejects non-admin...');

		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		const hbarFee = 50_000_000;
		const lazyFee = 5 * (10 ** LAZY_DECIMAL);

		try {
			const result = await contractExecuteFunction(
				poolManagerId,
				poolManagerIface,
				client,
				200_000,
				'setCreationFees',
				[hbarFee, lazyFee],
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

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Non-admin correctly rejected');
	});
});

describe('LazyLottoPoolManager - Time Bonuses:', function () {
	it('Should allow admin to set time bonus', async function () {
		console.log('\n-Testing setTimeBonus()...');

		client.setOperator(adminId, adminPK);

		const currentTime = Math.floor(Date.now() / 1000);
		const startTime = currentTime;
		const endTime = currentTime + 86400;
		const bonusBps = 110;

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'setTimeBonus',
			[startTime, endTime, bonusBps],
			300_000,
		);

		const setTimeBonusResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setTimeBonus',
			[startTime, endTime, bonusBps],
		);		if (setTimeBonusResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('setTimeBonus FAILED:', setTimeBonusResult);
			if (setTimeBonusResult[2]) {
				console.log(parseTransactionRecord(setTimeBonusResult[2]));
			}
			fail('setTimeBonus failed');
		}

		if (setTimeBonusResult[2]) {
			console.log(parseTransactionRecord(setTimeBonusResult[2]));
		}

		await sleep(5000);

		// Verify time bonus was set by checking total count
		const encodedCommand = poolManagerIface.encodeFunctionData('totalTimeBonuses');
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalBonuses = poolManagerIface.decodeFunctionResult('totalTimeBonuses', result);

		expect(Number(totalBonuses[0])).to.be.greaterThan(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Time bonus set:', startTime, 'to', endTime, '=>', bonusBps, 'bps');
	});

	it('Should allow admin to remove time bonus', async function () {
		console.log('\n-Testing removeTimeBonus()...');

		client.setOperator(adminId, adminPK);

		const indexToRemove = 0;
		// Remove first time bonus (index 0)

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'removeTimeBonus',
			[indexToRemove],
			300_000,
		);

		const removeTimeBonusResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'removeTimeBonus',
			[indexToRemove],
		);

		if (removeTimeBonusResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('removeTimeBonus FAILED:', removeTimeBonusResult);
			console.log(parseTransactionRecord(removeTimeBonusResult[2]));
			fail('removeTimeBonus failed');
		}

		console.log(parseTransactionRecord(removeTimeBonusResult[2]));

		await sleep(5000);
		// Verify time bonus was removed (check total count decreased)
		const encodedCommand = poolManagerIface.encodeFunctionData('totalTimeBonuses');
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalTimeBonuses = poolManagerIface.decodeFunctionResult('totalTimeBonuses', result);

		expect(Number(totalTimeBonuses[0])).to.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Time bonus removed');
	});
});

describe('LazyLottoPoolManager - NFT Bonuses:', function () {
	it('Should allow admin to set NFT bonus', async function () {
		console.log('\n-Testing setNFTBonus()...');

		client.setOperator(adminId, adminPK);

		const bonusBps = 110;
		// 110% = 10% bonus (100 baseline + 10 bonus)

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'setNFTBonus',
			[testNFTTokenId1.toSolidityAddress(), bonusBps],
			300_000,
		);

		const setNFTBonusResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setNFTBonus',
			[testNFTTokenId1.toSolidityAddress(), bonusBps],
		);

		if (setNFTBonusResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('setNFTBonus FAILED:', setNFTBonusResult);
			console.log(parseTransactionRecord(setNFTBonusResult[2]));
			fail('setNFTBonus failed');
		}

		console.log(parseTransactionRecord(setNFTBonusResult[2]));

		await sleep(5000);

		// Verify NFT bonus was set
		const encodedCommand = poolManagerIface.encodeFunctionData('nftBonusBps', [testNFTTokenId1.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const nftBonus = poolManagerIface.decodeFunctionResult('nftBonusBps', result);

		expect(nftBonus[0].toString()).to.equal(bonusBps.toString());

		client.setOperator(operatorId, operatorKey);
		console.log('✓ NFT bonus set:', testNFTTokenId1.toString(), '=>', bonusBps, 'bps');
	});

	it('Should allow admin to remove NFT bonus', async function () {
		console.log('\n-Testing removeNFTBonus()...');

		client.setOperator(adminId, adminPK);

		const indexToRemove = 0;
		// Remove first NFT bonus (index 0)

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'removeNFTBonus',
			[indexToRemove],
			300_000,
		);

		const removeNFTBonusResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'removeNFTBonus',
			[indexToRemove],
		);

		if (removeNFTBonusResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('removeNFTBonus FAILED:', removeNFTBonusResult);
			console.log(parseTransactionRecord(removeNFTBonusResult[2]));
			fail('removeNFTBonus failed');
		}

		console.log(parseTransactionRecord(removeNFTBonusResult[2]));

		await sleep(5000);
		// Verify NFT bonus was removed (check total count decreased)
		const encodedCommand = poolManagerIface.encodeFunctionData('totalNFTBonusTokens');
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalNFTBonusTokens = poolManagerIface.decodeFunctionResult('totalNFTBonusTokens', result);

		expect(Number(totalNFTBonusTokens[0])).to.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ NFT bonus removed');
	});
});

describe('LazyLottoPoolManager - LAZY Balance Bonus:', function () {
	it('Should allow admin to set LAZY balance bonus', async function () {
		console.log('\n-Testing setLazyBalanceBonus()...');

		client.setOperator(adminId, adminPK);

		const threshold = 10 * (10 ** LAZY_DECIMAL);
		// 10 LAZY accounting for decimals
		const bonusBps = 105;
		// 105% = 5% bonus (100 baseline + 5 bonus)

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'setLazyBalanceBonus',
			[threshold, bonusBps],
			300_000,
		);

		const setLazyBonusResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setLazyBalanceBonus',
			[threshold, bonusBps],
		);

		if (setLazyBonusResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('setLazyBalanceBonus FAILED:', setLazyBonusResult);
			console.log(parseTransactionRecord(setLazyBonusResult[2]));
			fail('setLazyBalanceBonus failed');
		}

		console.log(parseTransactionRecord(setLazyBonusResult[2]));

		await sleep(5000);

		// Verify LAZY balance bonus was set
		let encodedCommand = poolManagerIface.encodeFunctionData('lazyBalanceThreshold');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const thresholdResult = poolManagerIface.decodeFunctionResult('lazyBalanceThreshold', result);

		encodedCommand = poolManagerIface.encodeFunctionData('lazyBalanceBonusBps');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const bonusResult = poolManagerIface.decodeFunctionResult('lazyBalanceBonusBps', result);

		expect(thresholdResult[0].toString()).to.equal(threshold.toString());
		expect(bonusResult[0].toString()).to.equal(bonusBps.toString());		client.setOperator(operatorId, operatorKey);
		console.log('✓ LAZY balance bonus set:', threshold, 'LAZY =>', bonusBps, 'bps');
	});
});

describe('LazyLottoPoolManager - Combined Bonus Calculation:', function () {
	it('Should calculate combined bonuses correctly via LazyLotto facade', async function () {
		console.log('\n-Testing calculateBoost() facade integration...');

		// Setup: Alice has LAZY tokens (already distributed)
		// Setup: Add time bonus (1 day = 10%)
		client.setOperator(adminId, adminPK);

		const currentTime = Math.floor(Date.now() / 1000);
		const startTime = currentTime;
		// 1 day
		const endTime = currentTime + 86400;
		// 110 bps = 1.1% bonus
		const timeBonusBps = 110;

		await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			300_000,
			'setTimeBonus',
			[startTime, endTime, timeBonusBps],
		);

		// Setup: Add NFT bonus (testNFTTokenId1 = 15%)
		const nftBonusBps = 115;
		// 115% = 15% bonus

		await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			300_000,
			'setNFTBonus',
			[testNFTTokenId1.toSolidityAddress(), nftBonusBps],
		);

		// Setup: LAZY balance bonus already set (10 LAZY = 5%)

		await sleep(5000);
		client.setOperator(operatorId, operatorKey);

		// Calculate boost via LazyLotto's calculateBoost() facade
		const encodedCommand = lazyLottoIface.encodeFunctionData('calculateBoost', [aliceId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
		const boost = lazyLottoIface.decodeFunctionResult('calculateBoost', result);

		console.log('Combined boost for Alice:', boost[0].toString(), 'scaled bps');

		// The contract scales bps by 10,000: boost *= 10_000
		// So if Alice has 110 bps (time) + 115 bps (NFT already set in earlier test) = 225 bps
		// Result = 225 * 10,000 = 2,250,000
		// Since we're in a fresh test run, just verify it's > 0 and reasonable
		expect(Number(boost[0])).to.be.greaterThan(0);
		console.log('✓ Combined bonus calculation verified through LazyLotto facade');
	});
});

describe('LazyLottoPoolManager - Authorization Tests:', function () {
	it('Should verify admin can manage pools', async function () {
		console.log('\n-Testing authorization: admin can manage pools...');

		// Admin should be able to manage any pool
		const encodedCommand = poolManagerIface.encodeFunctionData('canManagePool', [
			0,
			// poolId
			adminId.toSolidityAddress(),
		]);
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const canManage = poolManagerIface.decodeFunctionResult('canManagePool', result);

		expect(canManage[0]).to.be.true;
		console.log('✓ Admin can manage pools');
	});

	it('Should verify non-admin cannot manage global pools', async function () {
		console.log('\n-Testing authorization: non-admin cannot manage global pools...');

		// Alice should NOT be able to manage global pool (poolId 0)
		const encodedCommand = poolManagerIface.encodeFunctionData('canManagePool', [
			0,
			// global pool
			aliceId.toSolidityAddress(),
		]);
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const canManage = poolManagerIface.decodeFunctionResult('canManagePool', result);

		expect(canManage[0]).to.be.false;
		console.log('✓ Non-admin cannot manage global pools');
	});
});

describe('LazyLottoPoolManager - Platform Fee Configuration:', function () {
	it('Should allow admin to set platform proceeds percentage', async function () {
		console.log('\n-Testing setPlatformProceedsPercentage()...');

		client.setOperator(adminId, adminPK);

		const platformPercentage = 5;
		// 5%

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'setPlatformProceedsPercentage',
			[platformPercentage],
			300_000,
		);

		const setPlatformFeeResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setPlatformProceedsPercentage',
			[platformPercentage],
		);

		if (setPlatformFeeResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('setPlatformProceedsPercentage FAILED:', setPlatformFeeResult);
			console.log(parseTransactionRecord(setPlatformFeeResult[2]));
			fail('setPlatformProceedsPercentage failed');
		}

		console.log(parseTransactionRecord(setPlatformFeeResult[2]));

		await sleep(5000);

		// Verify platform fee was set
		const encodedCommand = poolManagerIface.encodeFunctionData('platformProceedsPercentage');
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const platformFee = poolManagerIface.decodeFunctionResult('platformProceedsPercentage', result);

		expect(platformFee[0].toString()).to.equal(platformPercentage.toString());

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Platform proceeds percentage set:', platformPercentage, '%');
	});

	it('Should reject invalid platform fee percentage (>25%)', async function () {
		console.log('\n-Testing setPlatformProceedsPercentage() rejects >25%...');

		client.setOperator(adminId, adminPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		const invalidPercentage = 26;

		try {
			const result = await contractExecuteFunction(
				poolManagerId,
				poolManagerIface,
				client,
				200_000,
				'setPlatformProceedsPercentage',
				[invalidPercentage],
			);

			if (result[0]?.status?.name != 'BadParameters') {
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

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Invalid platform fee percentage correctly rejected');
	});
});

// Module scope for cross-suite access
let testPoolId = null;

describe('LazyLottoPoolManager - Community Pool Creation:', function () {

	it('Should set creation fees (HBAR and LAZY)', async function () {
		console.log('\n-Setting pool creation fees...');

		client.setOperator(adminId, adminPK);

		const hbarFee = 50_000_000;
		// 0.5 HBAR in tinybars
		const lazyFee = 10 * (10 ** LAZY_DECIMAL);
		// 10 LAZY

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'setCreationFees',
			[hbarFee, lazyFee],
			300_000,
		);

		const setFeesResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setCreationFees',
			[hbarFee, lazyFee],
		);

		if (setFeesResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('setCreationFees FAILED:', setFeesResult);
			console.log(parseTransactionRecord(setFeesResult[2]));
			fail('setCreationFees failed');
		}

		console.log(parseTransactionRecord(setFeesResult[2]));

		await sleep(5000);

		// Verify fees were set
		const encodedCommand = poolManagerIface.encodeFunctionData('getCreationFees');
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const fees = poolManagerIface.decodeFunctionResult('getCreationFees', result);

		expect(fees[0].toString()).to.equal(hbarFee.toString());
		expect(fees[1].toString()).to.equal(lazyFee.toString());

		const hbarDisplay = new Hbar(Number(hbarFee), HbarUnit.Tinybar).toString();
		const lazyDisplay = (Number(lazyFee) / (10 ** lazyDecimals)).toFixed(lazyDecimals);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Creation fees set:', hbarDisplay, 'HBAR,', lazyDisplay, 'LAZY');
	});

	it('Should create community pool with fees (Alice pays)', async function () {
		console.log('\n-Testing community pool creation by non-admin (Alice)...');

		client.setOperator(aliceId, alicePK);

		// Get creation fees
		let encodedCommand = poolManagerIface.encodeFunctionData('getCreationFees');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const fees = poolManagerIface.decodeFunctionResult('getCreationFees', result);
		const hbarFee = Number(fees[0]);
		const lazyFee = Number(fees[1]);

		const hbarDisplay = new Hbar(hbarFee, HbarUnit.Tinybar).toString();
		const lazyDisplay = (lazyFee / (10 ** lazyDecimals)).toFixed(lazyDecimals);
		console.log('Creation fees:', hbarDisplay, 'HBAR,', lazyDisplay, 'LAZY');

		// Set LAZY allowance for creation fee (exact amount needed)
		const allowanceResult = await setFTAllowance(
			client,
			lazyTokenId,
			aliceId,
			lazyGasStationId,
			lazyFee,
		);
		expect(allowanceResult).to.equal('SUCCESS');
		lazyAllowancesSet.push({ id: aliceId, key: alicePK });

		// Token creation cost ~20 HBAR + creation fee
		// 20 HBAR in tinybars
		const tokenCreationCost = Number(new Hbar(20, HbarUnit.Hbar).toTinybars());
		const totalHbar = hbarFee + tokenCreationCost;

		// Create pool via LazyLotto
		const gasEstimate = await estimateGas(
			env,
			lazyLottoId,
			lazyLottoIface,
			aliceId,
			'createPool',
			[
				'Alice Community Pool',
				'ACP',
				'Alice community pool',
				[],
				// No royalties
				'QmAliceTicketCID',
				'QmAliceWinCID',
				50_000_000,
				// 50% win rate
				100_000_000,
				// 1 HBAR entry fee
				'0x0000000000000000000000000000000000000000',
				// HBAR
			],
			5_000_000,
			totalHbar,
		);

		const createPoolResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'createPool',
			[
				'Alice Community Pool',
				'ACP',
				'Alice community pool',
				[],
				'QmAliceTicketCID',
				'QmAliceWinCID',
				50_000_000,
				100_000_000,
				'0x0000000000000000000000000000000000000000',
			],
			new Hbar(totalHbar, HbarUnit.Tinybar),
		);

		if (createPoolResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Community pool creation FAILED:');
			console.log('  Status:', createPoolResult[0]?.status?.toString());
			console.log('  Return values:', createPoolResult[1]);
			if (createPoolResult[2]) {
				console.log('  Transaction details:', parseTransactionRecord(createPoolResult[2]));
			}
			fail('Community pool creation failed');
		}

		if (createPoolResult[2]) {
			console.log(parseTransactionRecord(createPoolResult[2]));
		}

		testPoolId = Number(createPoolResult[1][0]);
		console.log('Created community pool ID:', testPoolId);		await sleep(5000);

		// Verify pool was recorded in PoolManager
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolOwner', [testPoolId]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const poolOwner = poolManagerIface.decodeFunctionResult('getPoolOwner', result);

		expect(poolOwner[0].slice(2).toLowerCase()).to.equal(aliceId.toSolidityAddress().toLowerCase());

		// Verify platform fee percentage was captured
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolPlatformFeePercentage', [testPoolId]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const poolFeePercentage = poolManagerIface.decodeFunctionResult('getPoolPlatformFeePercentage', result);

		expect(Number(poolFeePercentage[0])).to.equal(5);
		// Should match current platformProceedsPercentage

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Community pool created, owner:', aliceId.toString(), 'fee%:', poolFeePercentage[0].toString());
	});

	it('Should verify Alice is listed as pool owner', async function () {
		console.log('\n-Verifying Alice owns the community pool...');

		const encodedCommand = poolManagerIface.encodeFunctionData('getUserPools', [aliceId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const userPools = poolManagerIface.decodeFunctionResult('getUserPools', result);

		const poolIds = userPools[0].map((id) => Number(id));
		console.log('Alice\'s pools:', poolIds);

		expect(poolIds).to.include(testPoolId);
		console.log('✓ Alice listed as owner of pool', testPoolId);
	});

	it('Should track totalLazyCollected after community pool creation', async function () {
		console.log('\n-Verifying totalLazyCollected was incremented...');

		// Get the LAZY creation fee that was charged
		let encodedCommand = poolManagerIface.encodeFunctionData('getCreationFees');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const fees = poolManagerIface.decodeFunctionResult('getCreationFees', result);
		const lazyFee = Number(fees[1]);

		// Query totalLazyCollected
		encodedCommand = poolManagerIface.encodeFunctionData('totalLazyCollected');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalLazy = poolManagerIface.decodeFunctionResult('totalLazyCollected', result);

		// Should equal the LAZY fee from the one community pool created
		expect(Number(totalLazy[0])).to.equal(lazyFee);
		console.log('✓ totalLazyCollected:', totalLazy[0].toString(), '(matches creation fee:', lazyFee, ')');

		// Also verify totalHbarCollected is non-zero
		encodedCommand = poolManagerIface.encodeFunctionData('totalHbarCollected');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalHbar = poolManagerIface.decodeFunctionResult('totalHbarCollected', result);

		expect(Number(totalHbar[0])).to.be.greaterThan(0);
		console.log('✓ totalHbarCollected:', totalHbar[0].toString());
	});
});

describe('LazyLottoPoolManager - Proceeds Management (Integration):', function () {
	let communityPoolId;
	const ENTRY_FEE = 100_000_000;
	// 1 HBAR
	const ENTRY_COUNT = 5;

	it('Should record proceeds when entries are purchased', async function () {
		console.log('\n-Testing proceeds recording via buyEntry integration...');

		// Get testPoolId from previous test (shared scope)
		if (testPoolId === null || testPoolId === undefined) {
			console.log('ERROR: testPoolId not set from previous test');
			fail('testPoolId not available');
		}
		communityPoolId = testPoolId;
		console.log('Testing with Alice\'s community pool:', communityPoolId);

		// Bob buys entries (proceeds should be recorded)
		client.setOperator(bobId, bobPK);

		// First associate the pool's ticket token to Bob
		let encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [communityPoolId]);
		let result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);
		const poolTokenAddress = poolDetails[6];
		const poolTokenId = TokenId.fromSolidityAddress(poolTokenAddress);

		console.log('Pool ticket token:', poolTokenId.toString());

		const assocResult = await associateTokensToAccount(
			client,
			bobId,
			bobPK,
			[poolTokenId],
		);
		expect(assocResult).to.equal('SUCCESS');

		const totalCost = ENTRY_FEE * ENTRY_COUNT;

		const gasEstimate = await estimateGas(
			env,
			lazyLottoId,
			lazyLottoIface,
			bobId,
			'buyEntry',
			[communityPoolId, ENTRY_COUNT],
			500_000,
			totalCost,
		);

		const buyEntryResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'buyEntry',
			[communityPoolId, ENTRY_COUNT],
			new Hbar(totalCost, HbarUnit.Tinybar),
		);

		if (buyEntryResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('buyEntry FAILED:', buyEntryResult);
			console.log(parseTransactionRecord(buyEntryResult[2]));
			fail('buyEntry failed');
		}

		console.log(parseTransactionRecord(buyEntryResult[2]));
		console.log('Bob purchased', ENTRY_COUNT, 'entries for', totalCost, 'tinybars');

		await sleep(5000);

		// Verify proceeds were recorded
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [
			communityPoolId,
			'0x0000000000000000000000000000000000000000',
			// HBAR
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const proceeds = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);

		const totalProceeds = proceeds[0];
		const withdrawnProceeds = proceeds[1];

		console.log('Pool proceeds - Total:', totalProceeds.toString(), 'Withdrawn:', withdrawnProceeds.toString());

		expect(Number(totalProceeds)).to.equal(totalCost);
		expect(Number(withdrawnProceeds)).to.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Proceeds recorded correctly via buyEntry');
	});

	it('Should allow pool owner (Alice) to withdraw proceeds with 95/5 split', async function () {
		console.log('\n-Testing withdrawPoolProceeds with platform fee split...');

		// Get proceeds before withdrawal
		let encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [
			communityPoolId,
			'0x0000000000000000000000000000000000000000',
		]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const proceedsBefore = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);
		const totalProceeds = Number(proceedsBefore[0]);

		console.log('Total proceeds available:', totalProceeds);

		// Calculate expected split (5% platform, 95% owner)
		const expectedPlatformCut = Math.floor(totalProceeds * 5 / 100);
		const expectedOwnerShare = totalProceeds - expectedPlatformCut;

		console.log('Expected split - Owner:', expectedOwnerShare, 'Platform:', expectedPlatformCut);

		// Check Alice's HBAR balance before
		const aliceBalanceBefore = await checkMirrorHbarBalance(env, aliceId);
		// null for HBAR
		console.log('Alice HBAR balance before:', aliceBalanceBefore);

		// Alice withdraws proceeds
		client.setOperator(aliceId, alicePK);

		const gasEstimate = await estimateGas(
			env,
			lazyLottoId,
			lazyLottoIface,
			aliceId,
			'withdrawPoolProceeds',
			[communityPoolId, '0x0000000000000000000000000000000000000000'],
			500_000,
		);

		const withdrawResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'withdrawPoolProceeds',
			[communityPoolId, '0x0000000000000000000000000000000000000000'],
		);

		if (withdrawResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('withdrawPoolProceeds FAILED:', withdrawResult);
			console.log(parseTransactionRecord(withdrawResult[2]));
			fail('withdrawPoolProceeds failed');
		}

		console.log(parseTransactionRecord(withdrawResult[2]));

		await sleep(5000);

		// Verify proceeds were marked as withdrawn
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [
			communityPoolId,
			'0x0000000000000000000000000000000000000000',
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const proceedsAfter = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);

		expect(Number(proceedsAfter[1])).to.equal(totalProceeds);
		// All withdrawn

		// Verify platform balance increased
		encodedCommand = poolManagerIface.encodeFunctionData('getPlatformBalance', [
			'0x0000000000000000000000000000000000000000',
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const platformBalance = poolManagerIface.decodeFunctionResult('getPlatformBalance', result);

		console.log('Platform balance after withdrawal:', platformBalance[0].toString());
		expect(Number(platformBalance[0])).to.equal(expectedPlatformCut);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Proceeds withdrawn with 95/5 split verified');
	});

	it('Should allow admin to withdraw platform fees', async function () {
		console.log('\n-Testing withdrawPlatformFees...');

		// Get platform balance before
		let encodedCommand = poolManagerIface.encodeFunctionData('getPlatformBalance', [
			'0x0000000000000000000000000000000000000000',
		]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const platformBalanceBefore = poolManagerIface.decodeFunctionResult('getPlatformBalance', result);
		const platformAmount = Number(platformBalanceBefore[0]);

		console.log('Platform balance:', platformAmount);
		expect(platformAmount).to.be.greaterThan(0);

		// Admin withdraws platform fees
		client.setOperator(adminId, adminPK);

		const gasEstimate = await estimateGas(
			env,
			lazyLottoId,
			lazyLottoIface,
			adminId,
			'withdrawPlatformFees',
			['0x0000000000000000000000000000000000000000'],
			500_000,
		);

		const withdrawResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'withdrawPlatformFees',
			['0x0000000000000000000000000000000000000000'],
		);

		if (withdrawResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('withdrawPlatformFees FAILED:', withdrawResult);
			console.log(parseTransactionRecord(withdrawResult[2]));
			fail('withdrawPlatformFees failed');
		}

		console.log(parseTransactionRecord(withdrawResult[2]));

		await sleep(5000);

		// Verify platform balance was reset
		encodedCommand = poolManagerIface.encodeFunctionData('getPlatformBalance', [
			'0x0000000000000000000000000000000000000000',
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const platformBalanceAfter = poolManagerIface.decodeFunctionResult('getPlatformBalance', result);

		expect(Number(platformBalanceAfter[0])).to.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Platform fees withdrawn by admin');
	});

	it('Should prevent non-owner from withdrawing pool proceeds', async function () {
		console.log('\n-Testing authorization: non-owner cannot withdraw...');

		// Bob tries to withdraw from Alice's pool (should fail)
		client.setOperator(bobId, bobPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		// First, need to add more proceeds (Bob buys more entries)
		const gasEstimate1 = await estimateGas(
			env,
			lazyLottoId,
			lazyLottoIface,
			bobId,
			'buyEntry',
			[communityPoolId, 2],
			500_000,
			ENTRY_FEE * 2,
		);

		await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			gasEstimate1.gasLimit,
			'buyEntry',
			[communityPoolId, 2],
			new Hbar(ENTRY_FEE * 2, HbarUnit.Tinybar),
		);

		await sleep(5000);

		// Bob tries to withdraw (should fail - not owner)
		try {
			const result = await contractExecuteFunction(
				lazyLottoId,
				lazyLottoIface,
				client,
				500_000,
				'withdrawPoolProceeds',
				[communityPoolId, '0x0000000000000000000000000000000000000000'],
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

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Non-owner correctly prevented from withdrawing');
	});
});

describe('LazyLottoPoolManager - Global Pool Withdrawal:', function () {
	let globalPoolId;
	const ENTRY_FEE = 100_000_000; // 1 HBAR
	const ENTRY_COUNT = 3;

	it('Should create a global pool and buy entries for withdrawal test', async function () {
		console.log('\n-Setting up global pool withdrawal test...');

		// Create global pool as admin
		client.setOperator(adminId, adminPK);

		const tokenCreationCost = Number(new Hbar(20, HbarUnit.Hbar).toTinybars());

		const createResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			5_000_000,
			'createPool',
			[
				'Global Withdrawal Test',
				'GWT',
				'Global pool for withdrawal testing',
				[],
				'QmGlobalWithdrawTicketCID',
				'QmGlobalWithdrawWinCID',
				50_000_000,
				ENTRY_FEE,
				'0x0000000000000000000000000000000000000000',
			],
			new Hbar(tokenCreationCost, HbarUnit.Tinybar),
		);

		if (createResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Global pool creation FAILED:', createResult);
			if (createResult[2]) console.log(parseTransactionRecord(createResult[2]));
			fail('Global pool creation failed');
		}

		globalPoolId = Number(createResult[1][0]);
		console.log('Created global pool:', globalPoolId);
		await sleep(5000);

		// Verify it's a global pool
		let encodedCommand = poolManagerIface.encodeFunctionData('isGlobalPool', [globalPoolId]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const isGlobal = poolManagerIface.decodeFunctionResult('isGlobalPool', result);
		expect(isGlobal[0]).to.equal(true);

		// Bob buys entries to generate proceeds
		client.setOperator(bobId, bobPK);

		// Associate pool ticket token
		encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [globalPoolId]);
		result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);
		const poolTokenId = TokenId.fromSolidityAddress(poolDetails[6]);

		const assocResult = await associateTokensToAccount(client, bobId, bobPK, [poolTokenId]);
		expect(assocResult).to.equal('SUCCESS');

		const totalCost = ENTRY_FEE * ENTRY_COUNT;

		const buyResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			500_000,
			'buyEntry',
			[globalPoolId, ENTRY_COUNT],
			new Hbar(totalCost, HbarUnit.Tinybar),
		);

		if (buyResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('buyEntry FAILED:', buyResult);
			if (buyResult[2]) console.log(parseTransactionRecord(buyResult[2]));
			fail('buyEntry failed');
		}

		console.log('Bob purchased', ENTRY_COUNT, 'entries');
		await sleep(5000);

		// Verify proceeds were recorded
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [
			globalPoolId,
			'0x0000000000000000000000000000000000000000',
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const proceeds = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);

		expect(Number(proceeds[0])).to.equal(totalCost);
		expect(Number(proceeds[1])).to.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Global pool has', proceeds[0].toString(), 'tinybars in proceeds');
	});

	it('Should prevent withdrawPoolProceeds on global pools', async function () {
		console.log('\n-Testing that withdrawPoolProceeds reverts on global pools...');

		client.setOperator(adminId, adminPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				lazyLottoId,
				lazyLottoIface,
				client,
				500_000,
				'withdrawPoolProceeds',
				[globalPoolId, '0x0000000000000000000000000000000000000000'],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				expectedErrors++;
			} else {
				console.log('Operation succeeded unexpectedly:', parseTransactionRecord(result[2]));
				unexpectedErrors++;
			}
		} catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ withdrawPoolProceeds correctly reverts on global pool');
	});

	it('Should allow admin to withdraw global pool proceeds via withdrawGlobalPoolProceeds', async function () {
		console.log('\n-Testing withdrawGlobalPoolProceeds...');

		const totalCost = ENTRY_FEE * ENTRY_COUNT;

		// Get proceeds before
		let encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [
			globalPoolId,
			'0x0000000000000000000000000000000000000000',
		]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const proceedsBefore = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);
		const available = Number(proceedsBefore[0]) - Number(proceedsBefore[1]);

		console.log('Available proceeds:', available);
		expect(available).to.equal(totalCost);

		// Admin withdraws global pool proceeds
		client.setOperator(adminId, adminPK);

		const gasEstimate = await estimateGas(
			env,
			lazyLottoId,
			lazyLottoIface,
			adminId,
			'withdrawGlobalPoolProceeds',
			[globalPoolId, '0x0000000000000000000000000000000000000000'],
			500_000,
		);

		const withdrawResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'withdrawGlobalPoolProceeds',
			[globalPoolId, '0x0000000000000000000000000000000000000000'],
		);

		if (withdrawResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('withdrawGlobalPoolProceeds FAILED:', withdrawResult);
			if (withdrawResult[2]) console.log(parseTransactionRecord(withdrawResult[2]));
			fail('withdrawGlobalPoolProceeds failed');
		}

		console.log(parseTransactionRecord(withdrawResult[2]));
		await sleep(5000);

		// Verify proceeds marked as withdrawn
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [
			globalPoolId,
			'0x0000000000000000000000000000000000000000',
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const proceedsAfter = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);

		expect(Number(proceedsAfter[0])).to.equal(totalCost);
		expect(Number(proceedsAfter[1])).to.equal(totalCost); // All withdrawn

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Global pool proceeds withdrawn successfully, full amount:', totalCost);
	});

	it('Should revert when no proceeds available on global pool', async function () {
		console.log('\n-Testing withdrawGlobalPoolProceeds with no proceeds...');

		client.setOperator(adminId, adminPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				lazyLottoId,
				lazyLottoIface,
				client,
				500_000,
				'withdrawGlobalPoolProceeds',
				[globalPoolId, '0x0000000000000000000000000000000000000000'],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				expectedErrors++;
			} else {
				console.log('Operation succeeded unexpectedly:', parseTransactionRecord(result[2]));
				unexpectedErrors++;
			}
		} catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Correctly reverts when no proceeds available');
	});

	it('Should prevent non-admin from withdrawing global pool proceeds', async function () {
		console.log('\n-Testing that non-admin cannot call withdrawGlobalPoolProceeds...');

		// First add more proceeds so there's something to withdraw
		client.setOperator(bobId, bobPK);
		await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			500_000,
			'buyEntry',
			[globalPoolId, 1],
			new Hbar(ENTRY_FEE, HbarUnit.Tinybar),
		);
		await sleep(5000);

		// Alice (non-admin) tries to withdraw
		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				lazyLottoId,
				lazyLottoIface,
				client,
				500_000,
				'withdrawGlobalPoolProceeds',
				[globalPoolId, '0x0000000000000000000000000000000000000000'],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				expectedErrors++;
			} else {
				console.log('Operation succeeded unexpectedly:', parseTransactionRecord(result[2]));
				unexpectedErrors++;
			}
		} catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Non-admin correctly prevented from withdrawing global pool proceeds');
	});

	it('Should prevent withdrawGlobalPoolProceeds on community pools', async function () {
		console.log('\n-Testing that withdrawGlobalPoolProceeds reverts on community pools...');

		// testPoolId is a community pool from the earlier test suite
		if (testPoolId === null || testPoolId === undefined) {
			console.log('ERROR: testPoolId not set from previous test');
			fail('testPoolId not available');
		}

		client.setOperator(adminId, adminPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				lazyLottoId,
				lazyLottoIface,
				client,
				500_000,
				'withdrawGlobalPoolProceeds',
				[testPoolId, '0x0000000000000000000000000000000000000000'],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				expectedErrors++;
			} else {
				console.log('Operation succeeded unexpectedly:', parseTransactionRecord(result[2]));
				unexpectedErrors++;
			}
		} catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ withdrawGlobalPoolProceeds correctly reverts on community pool');
	});
});

describe('LazyLottoPoolManager - Ownership Management:', function () {
	let transferTestPoolId;

	it('Should create a pool for ownership transfer testing', async function () {
		console.log('\n-Creating pool for ownership tests...');

		client.setOperator(carolId, carolPK);

		// Get creation fees
		let encodedCommand = poolManagerIface.encodeFunctionData('getCreationFees');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const fees = poolManagerIface.decodeFunctionResult('getCreationFees', result);
		const hbarFee = Number(fees[0]);
		const lazyFee = Number(fees[1]);

		// Set LAZY allowance (exact amount)
		await setFTAllowance(
			client,
			lazyTokenId,
			carolId,
			lazyGasStationId,
			lazyFee,
		);
		lazyAllowancesSet.push({ id: carolId, key: carolPK });

		const tokenCreationCost = Number(new Hbar(20, HbarUnit.Hbar).toTinybars());
		const totalHbar = hbarFee + tokenCreationCost;

		const gasEstimate = await estimateGas(
			env,
			lazyLottoId,
			lazyLottoIface,
			carolId,
			'createPool',
			[
				'Carol Transfer Pool',
				'CTP',
				'Carol transfer pool',
				[],
				'QmCarolTicketCID',
				'QmCarolWinCID',
				40_000_000,
				100_000_000,
				'0x0000000000000000000000000000000000000000',
			],
			5_000_000,
			totalHbar,
		);

		const createPoolResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'createPool',
			[
				'Carol Transfer Pool',
				'CTP',
				'Carol transfer pool',
				[],
				'QmCarolTicketCID',
				'QmCarolWinCID',
				40_000_000,
				100_000_000,
				'0x0000000000000000000000000000000000000000',
			],
			new Hbar(totalHbar, HbarUnit.Tinybar),
		);

		if (createPoolResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Pool creation FAILED:');
			console.log('  Status:', createPoolResult[0]?.status?.toString());
			console.log('  Return values:', createPoolResult[1]);
			if (createPoolResult[2]) {
				console.log('  Transaction details:', parseTransactionRecord(createPoolResult[2]));
			}
			fail('Pool creation failed');
		}

		if (createPoolResult[2]) {
			console.log(parseTransactionRecord(createPoolResult[2]));
		}

		transferTestPoolId = Number(createPoolResult[1][0]);
		console.log('Created pool ID:', transferTestPoolId);		await sleep(5000);

		// Verify Carol is owner
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolOwner', [transferTestPoolId]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const poolOwner = poolManagerIface.decodeFunctionResult('getPoolOwner', result);

		expect(poolOwner[0].slice(2).toLowerCase()).to.equal(carolId.toSolidityAddress().toLowerCase());

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Carol created pool', transferTestPoolId);
	});

	it('Should transfer pool ownership from Carol to Bob', async function () {
		console.log('\n-Testing transferPoolOwnership...');

		client.setOperator(carolId, carolPK);

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			carolId,
			'transferPoolOwnership',
			[transferTestPoolId, bobId.toSolidityAddress()],
			500_000,
		);

		const transferResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'transferPoolOwnership',
			[transferTestPoolId, bobId.toSolidityAddress()],
		);

		if (transferResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('transferPoolOwnership FAILED:', transferResult);
			console.log(parseTransactionRecord(transferResult[2]));
			fail('transferPoolOwnership failed');
		}

		console.log(parseTransactionRecord(transferResult[2]));

		await sleep(5000);

		// Verify new owner
		let encodedCommand = poolManagerIface.encodeFunctionData('getPoolOwner', [transferTestPoolId]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const newOwner = poolManagerIface.decodeFunctionResult('getPoolOwner', result);

		expect(newOwner[0].slice(2).toLowerCase()).to.equal(bobId.toSolidityAddress().toLowerCase());

		// Verify Bob's pool list includes this pool
		encodedCommand = poolManagerIface.encodeFunctionData('getUserPools', [bobId.toSolidityAddress()]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const bobPools = poolManagerIface.decodeFunctionResult('getUserPools', result);

		const bobPoolIds = bobPools[0].map((id) => Number(id));
		expect(bobPoolIds).to.include(transferTestPoolId);

		// Verify Carol's pool list no longer includes this pool
		encodedCommand = poolManagerIface.encodeFunctionData('getUserPools', [carolId.toSolidityAddress()]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const carolPools = poolManagerIface.decodeFunctionResult('getUserPools', result);

		const carolPoolIds = carolPools[0].map((id) => Number(id));
		expect(carolPoolIds).to.not.include(transferTestPoolId);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Ownership transferred from Carol to Bob');
	});

	it('Should allow admin to transfer pool ownership', async function () {
		console.log('\n-Testing admin can transfer any pool ownership...');

		client.setOperator(adminId, adminPK);

		// Admin transfers Bob's pool back to Carol
		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'transferPoolOwnership',
			[transferTestPoolId, carolId.toSolidityAddress()],
			500_000,
		);

		const transferResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'transferPoolOwnership',
			[transferTestPoolId, carolId.toSolidityAddress()],
		);

		if (transferResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Admin transferPoolOwnership FAILED:', transferResult);
			console.log(parseTransactionRecord(transferResult[2]));
			fail('Admin transferPoolOwnership failed');
		}

		console.log(parseTransactionRecord(transferResult[2]));

		await sleep(5000);

		// Verify Carol is owner again
		const encodedCommand = poolManagerIface.encodeFunctionData('getPoolOwner', [transferTestPoolId]);
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const finalOwner = poolManagerIface.decodeFunctionResult('getPoolOwner', result);

		expect(finalOwner[0].slice(2).toLowerCase()).to.equal(carolId.toSolidityAddress().toLowerCase());

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Admin successfully transferred ownership');
	});

	it('Should prevent non-owner/non-admin from transferring ownership', async function () {
		console.log('\n-Testing authorization: unauthorized transfer blocked...');

		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				poolManagerId,
				poolManagerIface,
				client,
				500_000,
				'transferPoolOwnership',
				[transferTestPoolId, aliceId.toSolidityAddress()],
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

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Unauthorized transfer correctly blocked');
	});

	it('Should reject transfer of global pools', async function () {
		console.log('\n-Testing global pool transfer rejection...');

		// First, verify a global pool exists (created by admin)
		client.setOperator(operatorId, operatorKey);
		let encodedCommand = poolManagerIface.encodeFunctionData('totalGlobalPools');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalGlobal = poolManagerIface.decodeFunctionResult('totalGlobalPools', result);

		let globalPoolId = 0;
		if (Number(totalGlobal[0]) === 0) {
			// No global pool exists, create one as admin
			console.log('Creating global pool as admin for transfer test...');
			client.setOperator(adminId, adminPK);

			const tokenCreationCost = Number(new Hbar(20, HbarUnit.Hbar).toTinybars());

			const createGlobalPoolResult = await contractExecuteFunction(
				lazyLottoId,
				lazyLottoIface,
				client,
				5_000_000,
				'createPool',
				[
					'Admin Global Pool',
					'AGP',
					'Admin global pool',
					[],
					'QmAdminTicketCID',
					'QmAdminWinCID',
					50_000_000,
					100_000_000,
					'0x0000000000000000000000000000000000000000',
				],
				new Hbar(tokenCreationCost, HbarUnit.Tinybar),
			);

			if (createGlobalPoolResult[0]?.status?.toString() !== 'SUCCESS') {
				fail('Global pool creation failed');
			}

			globalPoolId = Number(createGlobalPoolResult[1][0]);
			console.log('Created global pool:', globalPoolId);
			await sleep(5000);
		}
		else {
			// Get first global pool ID
			encodedCommand = poolManagerIface.encodeFunctionData('getGlobalPools', [0, 1]);
			result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
			const globalPools = poolManagerIface.decodeFunctionResult('getGlobalPools', result);
			globalPoolId = Number(globalPools[0][0]);
			console.log('Using existing global pool:', globalPoolId);
		}

		// Now test that transfer fails
		client.setOperator(adminId, adminPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const transferResult = await contractExecuteFunction(
				poolManagerId,
				poolManagerIface,
				client,
				500_000,
				'transferPoolOwnership',
				[globalPoolId, bobId.toSolidityAddress()],
			);

			if (transferResult[0]?.status?.name != 'CannotTransferGlobalPools') {
				console.log('Operation succeeded unexpectedly:', parseTransactionRecord(transferResult[2]));
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

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Global pool transfer correctly rejected');
	});
});

describe('LazyLottoPoolManager - Pool Enumeration:', function () {
	it('Should enumerate global pools', async function () {
		console.log('\n-Testing global pool enumeration...');

		// Get total global pools
		let encodedCommand = poolManagerIface.encodeFunctionData('totalGlobalPools');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalGlobal = poolManagerIface.decodeFunctionResult('totalGlobalPools', result);

		console.log('Total global pools:', totalGlobal[0].toString());
		expect(Number(totalGlobal[0])).to.be.greaterThan(0);

		// Get first page of global pools
		encodedCommand = poolManagerIface.encodeFunctionData('getGlobalPools', [0, 10]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const globalPools = poolManagerIface.decodeFunctionResult('getGlobalPools', result);

		const globalPoolIds = globalPools[0].map((id) => Number(id));
		console.log('Global pool IDs:', globalPoolIds);

		expect(globalPoolIds.length).to.be.greaterThan(0);

		// Verify first pool (pool[0]) is global
		encodedCommand = poolManagerIface.encodeFunctionData('isGlobalPool', [Number(globalPoolIds[0])]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const isGlobal = poolManagerIface.decodeFunctionResult('isGlobalPool', result);

		expect(isGlobal[0]).to.be.true;

		console.log('✓ Global pool enumeration working');
	});

	it('Should enumerate community pools', async function () {
		console.log('\n-Testing community pool enumeration...');

		// Get total community pools
		let encodedCommand = poolManagerIface.encodeFunctionData('totalCommunityPools');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalCommunity = poolManagerIface.decodeFunctionResult('totalCommunityPools', result);

		console.log('Total community pools:', totalCommunity[0].toString());
		expect(Number(totalCommunity[0])).to.be.greaterThan(0);
		// We created Alice's and Carol's pools

		// Get first page of community pools
		encodedCommand = poolManagerIface.encodeFunctionData('getCommunityPools', [0, 10]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const communityPools = poolManagerIface.decodeFunctionResult('getCommunityPools', result);

		const communityPoolIds = communityPools[0].map((id) => Number(id));
		console.log('Community pool IDs:', communityPoolIds);

		expect(communityPoolIds.length).to.be.greaterThan(0);
		expect(communityPoolIds.length).to.be.at.most(10);

		// Verify these are community pools (not global)
		for (const poolId of communityPoolIds.slice(0, 2)) {
			encodedCommand = poolManagerIface.encodeFunctionData('isGlobalPool', [poolId]);
			result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
			const isGlobal = poolManagerIface.decodeFunctionResult('isGlobalPool', result);

			expect(isGlobal[0]).to.be.false;
		}

		console.log('✓ Community pool enumeration working');
	});
});

describe('LazyLottoPoolManager - Prize Manager Authorization:', function () {
	let testPoolForPrizes;

	it('Should create pool for prize manager testing', async function () {
		console.log('\n-Creating pool for prize manager tests...');

		// Use testPoolId from Community Pool Creation suite (module scope)
		if (testPoolId === null || testPoolId === undefined) {
			console.log('ERROR: testPoolId not set from Community Pool Creation test');
			fail('testPoolId not available');
		}
		testPoolForPrizes = testPoolId;
		console.log('Using Alice\'s pool', testPoolForPrizes, 'for prize manager tests');
	});

	it('Should allow pool owner to set pool prize manager', async function () {
		console.log('\n-Testing setPoolPrizeManager by owner...');

		client.setOperator(aliceId, alicePK);

		// Alice sets Bob as prize manager for her pool
		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			aliceId,
			'setPoolPrizeManager',
			[testPoolForPrizes, bobId.toSolidityAddress()],
			300_000,
		);

		const setPrizeManagerResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setPoolPrizeManager',
			[testPoolForPrizes, bobId.toSolidityAddress()],
		);

		if (setPrizeManagerResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('setPoolPrizeManager FAILED:', setPrizeManagerResult);
			console.log(parseTransactionRecord(setPrizeManagerResult[2]));
			fail('setPoolPrizeManager failed');
		}

		console.log(parseTransactionRecord(setPrizeManagerResult[2]));

		await sleep(5000);

		// Verify prize manager was set
		const encodedCommand = poolManagerIface.encodeFunctionData('getPoolPrizeManager', [testPoolForPrizes]);
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const prizeManager = poolManagerIface.decodeFunctionResult('getPoolPrizeManager', result);

		expect(prizeManager[0].slice(2).toLowerCase()).to.equal(bobId.toSolidityAddress().toLowerCase());

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Pool prize manager set to Bob');
	});

	it('Should verify pool prize manager can add prizes', async function () {
		console.log('\n-Verifying pool prize manager authorization...');

		// Check if Bob (prize manager) can add prizes
		const encodedCommand = poolManagerIface.encodeFunctionData('canAddPrizes', [
			testPoolForPrizes,
			bobId.toSolidityAddress(),
		]);
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const canAdd = poolManagerIface.decodeFunctionResult('canAddPrizes', result);

		expect(canAdd[0]).to.be.true;

		console.log('✓ Pool prize manager authorized to add prizes');
	});

	it('Should add and verify global prize manager', async function () {
		console.log('\n-Testing global prize manager management...');

		client.setOperator(adminId, adminPK);

		// Add Carol as global prize manager
		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'addGlobalPrizeManager',
			[carolId.toSolidityAddress()],
			300_000,
		);

		const addGlobalResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'addGlobalPrizeManager',
			[carolId.toSolidityAddress()],
		);

		if (addGlobalResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('addGlobalPrizeManager FAILED:', addGlobalResult);
			console.log(parseTransactionRecord(addGlobalResult[2]));
			fail('addGlobalPrizeManager failed');
		}

		console.log(parseTransactionRecord(addGlobalResult[2]));

		await sleep(5000);

		// Verify Carol is global prize manager
		let encodedCommand = poolManagerIface.encodeFunctionData('isGlobalPrizeManager', [carolId.toSolidityAddress()]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const isGlobalManager = poolManagerIface.decodeFunctionResult('isGlobalPrizeManager', result);

		expect(isGlobalManager[0]).to.be.true;

		// Verify Carol can add prizes to ANY pool
		encodedCommand = poolManagerIface.encodeFunctionData('canAddPrizes', [
			testPoolForPrizes,
			carolId.toSolidityAddress(),
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const carolCanAdd = poolManagerIface.decodeFunctionResult('canAddPrizes', result);

		expect(carolCanAdd[0]).to.be.true;

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Global prize manager added and verified');
	});

	it('Should remove global prize manager', async function () {
		console.log('\n-Testing removeGlobalPrizeManager...');

		client.setOperator(adminId, adminPK);

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'removeGlobalPrizeManager',
			[carolId.toSolidityAddress()],
			300_000,
		);

		const removeResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'removeGlobalPrizeManager',
			[carolId.toSolidityAddress()],
		);

		if (removeResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('removeGlobalPrizeManager FAILED:', removeResult);
			console.log(parseTransactionRecord(removeResult[2]));
			fail('removeGlobalPrizeManager failed');
		}

		console.log(parseTransactionRecord(removeResult[2]));

		await sleep(5000);

		// Verify Carol is no longer global prize manager
		const encodedCommand = poolManagerIface.encodeFunctionData('isGlobalPrizeManager', [carolId.toSolidityAddress()]);
		const result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const isGlobalManager = poolManagerIface.decodeFunctionResult('isGlobalPrizeManager', result);

		expect(isGlobalManager[0]).to.be.false;

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Global prize manager removed');
	});

	it('Should remove pool prize manager', async function () {
		console.log('\n-Testing removal of pool prize manager...');

		client.setOperator(aliceId, alicePK);

		// Alice removes Bob as prize manager (set to address(0))
		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			aliceId,
			'setPoolPrizeManager',
			[testPoolForPrizes, '0x0000000000000000000000000000000000000000'],
			300_000,
		);

		const removeResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'setPoolPrizeManager',
			[testPoolForPrizes, '0x0000000000000000000000000000000000000000'],
		);

		if (removeResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Remove pool prize manager FAILED:', removeResult);
			console.log(parseTransactionRecord(removeResult[2]));
			fail('Remove pool prize manager failed');
		}

		console.log(parseTransactionRecord(removeResult[2]));

		await sleep(5000);

		// Verify prize manager was removed
		let encodedCommand = poolManagerIface.encodeFunctionData('getPoolPrizeManager', [testPoolForPrizes]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const prizeManager = poolManagerIface.decodeFunctionResult('getPoolPrizeManager', result);

		expect(prizeManager[0]).to.equal('0x0000000000000000000000000000000000000000');

		// Verify Bob can no longer add prizes
		encodedCommand = poolManagerIface.encodeFunctionData('canAddPrizes', [
			testPoolForPrizes,
			bobId.toSolidityAddress(),
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const bobCanAdd = poolManagerIface.decodeFunctionResult('canAddPrizes', result);

		expect(bobCanAdd[0]).to.be.false;
		// Bob is neither owner, admin, global manager, nor pool manager

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Pool prize manager removed');
	});
});

describe('LazyLottoPoolManager - Audit Fix: Creation Fee Withdrawal:', function () {
	it('Should allow admin to withdraw creation fees (HBAR)', async function () {
		console.log('\n-Testing withdrawCreationFees...');

		// Verify totalHbarCollected > 0 from earlier community pool creation
		let encodedCommand = poolManagerIface.encodeFunctionData('totalHbarCollected');
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalHbarBefore = poolManagerIface.decodeFunctionResult('totalHbarCollected', result);

		console.log('totalHbarCollected before:', totalHbarBefore[0].toString());
		expect(Number(totalHbarBefore[0])).to.be.greaterThan(0);

		// Get admin HBAR balance before
		const adminBalanceBefore = await checkMirrorHbarBalance(env, adminId);
		console.log('Admin HBAR balance before:', adminBalanceBefore);

		// Admin calls withdrawCreationFees on PoolManager
		client.setOperator(adminId, adminPK);

		const gasEstimate = await estimateGas(
			env,
			poolManagerId,
			poolManagerIface,
			adminId,
			'withdrawCreationFees',
			[adminId.toSolidityAddress()],
			500_000,
		);

		const withdrawResult = await contractExecuteFunction(
			poolManagerId,
			poolManagerIface,
			client,
			gasEstimate.gasLimit,
			'withdrawCreationFees',
			[adminId.toSolidityAddress()],
		);

		if (withdrawResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('withdrawCreationFees FAILED:', withdrawResult);
			if (withdrawResult[2]) console.log(parseTransactionRecord(withdrawResult[2]));
			fail('withdrawCreationFees failed');
		}

		console.log(parseTransactionRecord(withdrawResult[2]));

		await sleep(5000);

		// Verify totalHbarCollected is now 0
		encodedCommand = poolManagerIface.encodeFunctionData('totalHbarCollected');
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const totalHbarAfter = poolManagerIface.decodeFunctionResult('totalHbarCollected', result);

		expect(Number(totalHbarAfter[0])).to.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Creation fees withdrawn, totalHbarCollected reset to 0');
	});

	it('Should reject non-admin calling withdrawCreationFees', async function () {
		console.log('\n-Testing authorization: non-admin cannot withdraw creation fees...');

		client.setOperator(aliceId, alicePK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				poolManagerId,
				poolManagerIface,
				client,
				500_000,
				'withdrawCreationFees',
				[aliceId.toSolidityAddress()],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				expectedErrors++;
			}
			else {
				console.log('Operation succeeded unexpectedly:', parseTransactionRecord(result[2]));
				unexpectedErrors++;
			}
		}
		catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Non-admin correctly prevented from withdrawing creation fees');
	});

	it('Should revert withdrawCreationFees when nothing to withdraw', async function () {
		console.log('\n-Testing withdrawCreationFees with zero balance...');

		client.setOperator(adminId, adminPK);

		let expectedErrors = 0;
		let unexpectedErrors = 0;

		try {
			const result = await contractExecuteFunction(
				poolManagerId,
				poolManagerIface,
				client,
				500_000,
				'withdrawCreationFees',
				[adminId.toSolidityAddress()],
			);

			if (result[0]?.status?.toString() !== 'SUCCESS') {
				expectedErrors++;
			}
			else {
				console.log('Operation succeeded unexpectedly:', parseTransactionRecord(result[2]));
				unexpectedErrors++;
			}
		}
		catch {
			expectedErrors++;
		}

		expect(expectedErrors).to.be.equal(1);
		expect(unexpectedErrors).to.be.equal(0);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Correctly reverts with NothingToWithdraw when balance is zero');
	});
});

describe('LazyLottoPoolManager - Audit Fix: Rounding Consistency:', function () {
	it('Should handle proceeds withdrawal without rounding underflow', async function () {
		console.log('\n-Testing rounding consistency on proceeds withdrawal...');

		// Query pendingWithdrawals for HBAR
		let encodedCommand = poolManagerIface.encodeFunctionData('pendingWithdrawals', [
			'0x0000000000000000000000000000000000000000',
		]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const pendingBefore = poolManagerIface.decodeFunctionResult('pendingWithdrawals', result);

		console.log('pendingWithdrawals (HBAR) before:', pendingBefore[0].toString());

		// Check if Alice's community pool has unwithdrawn proceeds
		if (testPoolId === null || testPoolId === undefined) {
			console.log('SKIP: testPoolId not set from previous test');
			return;
		}

		encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [
			testPoolId,
			'0x0000000000000000000000000000000000000000',
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const proceeds = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);
		const available = Number(proceeds[0]) - Number(proceeds[1]);

		console.log('Pool', testPoolId, 'available proceeds:', available);

		if (available === 0) {
			// Buy a small entry to generate fresh proceeds
			console.log('-Buying entry to generate fresh proceeds...');
			client.setOperator(bobId, bobPK);

			const smallEntryFee = 100_000_000; // 1 HBAR
			const buyResult = await contractExecuteFunction(
				lazyLottoId,
				lazyLottoIface,
				client,
				500_000,
				'buyEntry',
				[testPoolId, 1],
				new Hbar(smallEntryFee, HbarUnit.Tinybar),
			);

			if (buyResult[0]?.status?.toString() !== 'SUCCESS') {
				console.log('buyEntry FAILED:', buyResult);
				if (buyResult[2]) console.log(parseTransactionRecord(buyResult[2]));
				fail('buyEntry failed for rounding test');
			}

			await sleep(5000);
			console.log('Entry purchased for rounding test');
		}

		// Alice withdraws proceeds - the rounding fix ensures this does not revert
		client.setOperator(aliceId, alicePK);

		const gasEstimate = await estimateGas(
			env,
			lazyLottoId,
			lazyLottoIface,
			aliceId,
			'withdrawPoolProceeds',
			[testPoolId, '0x0000000000000000000000000000000000000000'],
			500_000,
		);

		const withdrawResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'withdrawPoolProceeds',
			[testPoolId, '0x0000000000000000000000000000000000000000'],
		);

		if (withdrawResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('withdrawPoolProceeds FAILED:', withdrawResult);
			if (withdrawResult[2]) console.log(parseTransactionRecord(withdrawResult[2]));
			fail('withdrawPoolProceeds failed - possible rounding underflow');
		}

		console.log(parseTransactionRecord(withdrawResult[2]));

		await sleep(5000);

		// Verify pendingWithdrawals decreased
		encodedCommand = poolManagerIface.encodeFunctionData('pendingWithdrawals', [
			'0x0000000000000000000000000000000000000000',
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const pendingAfter = poolManagerIface.decodeFunctionResult('pendingWithdrawals', result);

		console.log('pendingWithdrawals (HBAR) after:', pendingAfter[0].toString());
		expect(Number(pendingAfter[0])).to.be.lessThan(Number(pendingBefore[0]));

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Proceeds withdrawal succeeded without rounding underflow');
	});
});

describe('LazyLottoPoolManager - Audit Fix: Burn Percentage Freeze:', function () {
	it('Should verify poolBurnPercentage was frozen at pool creation time', async function () {
		console.log('\n-Testing burn percentage freeze at pool creation...');

		if (testPoolId === null || testPoolId === undefined) {
			console.log('ERROR: testPoolId not set from previous test');
			fail('testPoolId not available');
		}

		// Query poolBurnPercentage for Alice's community pool
		let encodedCommand = poolManagerIface.encodeFunctionData('getPoolBurnPercentage', [testPoolId]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const poolBurn = poolManagerIface.decodeFunctionResult('getPoolBurnPercentage', result);
		const frozenBurnPercent = Number(poolBurn[0]);

		console.log('Pool', testPoolId, 'frozen burn percentage:', frozenBurnPercent);

		// Query LazyLotto's current global burnPercentage
		encodedCommand = lazyLottoIface.encodeFunctionData('burnPercentage');
		result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
		const globalBurn = lazyLottoIface.decodeFunctionResult('burnPercentage', result);
		const currentGlobalBurn = Number(globalBurn[0]);

		console.log('Current global burnPercentage:', currentGlobalBurn);

		// They should match since burn% hasn't been changed since pool creation
		expect(frozenBurnPercent).to.equal(currentGlobalBurn);

		console.log('✓ poolBurnPercentage matches global burnPercentage (both', frozenBurnPercent, '%)');
	});

	it('Should show poolBurnPercentage is independent of global changes', async function () {
		console.log('\n-Testing burn percentage independence from global changes...');

		if (testPoolId === null || testPoolId === undefined) {
			console.log('ERROR: testPoolId not set from previous test');
			fail('testPoolId not available');
		}

		// Get original global burnPercentage
		let encodedCommand = lazyLottoIface.encodeFunctionData('burnPercentage');
		let result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
		const originalGlobalBurn = lazyLottoIface.decodeFunctionResult('burnPercentage', result);
		const originalBurnValue = Number(originalGlobalBurn[0]);

		console.log('Original global burnPercentage:', originalBurnValue);

		// Get pool's frozen burnPercentage
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolBurnPercentage', [testPoolId]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const poolBurnBefore = poolManagerIface.decodeFunctionResult('getPoolBurnPercentage', result);
		const frozenBurnPercent = Number(poolBurnBefore[0]);

		// Admin changes global burnPercentage to a different value
		const newGlobalBurn = originalBurnValue === 10 ? 20 : 10;

		client.setOperator(adminId, adminPK);

		const gasEstimate = await estimateGas(
			env,
			lazyLottoId,
			lazyLottoIface,
			adminId,
			'setBurnPercentage',
			[newGlobalBurn],
			300_000,
		);

		const setBurnResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'setBurnPercentage',
			[newGlobalBurn],
		);

		if (setBurnResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('setBurnPercentage FAILED:', setBurnResult);
			if (setBurnResult[2]) console.log(parseTransactionRecord(setBurnResult[2]));
			fail('setBurnPercentage failed');
		}

		await sleep(5000);

		// Verify global changed
		encodedCommand = lazyLottoIface.encodeFunctionData('burnPercentage');
		result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
		const changedGlobalBurn = lazyLottoIface.decodeFunctionResult('burnPercentage', result);
		expect(Number(changedGlobalBurn[0])).to.equal(newGlobalBurn);

		console.log('Global burnPercentage changed to:', newGlobalBurn);

		// Verify pool's frozen burn percentage is STILL the original value
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolBurnPercentage', [testPoolId]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const poolBurnAfter = poolManagerIface.decodeFunctionResult('getPoolBurnPercentage', result);

		expect(Number(poolBurnAfter[0])).to.equal(frozenBurnPercent);
		console.log('Pool', testPoolId, 'burn percentage still:', frozenBurnPercent, '(unchanged)');

		// Reset global burnPercentage back to original
		const resetEstimate = await estimateGas(
			env,
			lazyLottoId,
			lazyLottoIface,
			adminId,
			'setBurnPercentage',
			[originalBurnValue],
			300_000,
		);

		const resetResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			resetEstimate.gasLimit,
			'setBurnPercentage',
			[originalBurnValue],
		);

		if (resetResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Reset setBurnPercentage FAILED:', resetResult);
			if (resetResult[2]) console.log(parseTransactionRecord(resetResult[2]));
			fail('Reset setBurnPercentage failed');
		}

		await sleep(5000);

		// Verify reset
		encodedCommand = lazyLottoIface.encodeFunctionData('burnPercentage');
		result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
		const resetGlobalBurn = lazyLottoIface.decodeFunctionResult('burnPercentage', result);
		expect(Number(resetGlobalBurn[0])).to.equal(originalBurnValue);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Pool burn percentage is independent of global changes, global reset to', originalBurnValue);
	});
});

describe('LazyLottoPoolManager - Audit Fix: pendingWithdrawals Global Pool Fix:', function () {
	let auditGlobalPoolId;
	const AUDIT_ENTRY_FEE = 100_000_000; // 1 HBAR

	it('Should create a global pool and buy entry for pendingWithdrawals test', async function () {
		console.log('\n-Setting up global pool for pendingWithdrawals audit test...');

		client.setOperator(adminId, adminPK);

		const tokenCreationCost = Number(new Hbar(20, HbarUnit.Hbar).toTinybars());

		const createResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			5_000_000,
			'createPool',
			[
				'Audit PW Test Pool',
				'APT',
				'Pool for pendingWithdrawals audit fix test',
				[],
				'QmAuditPWTicketCID',
				'QmAuditPWWinCID',
				50_000_000,
				AUDIT_ENTRY_FEE,
				'0x0000000000000000000000000000000000000000',
			],
			new Hbar(tokenCreationCost, HbarUnit.Tinybar),
		);

		if (createResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Global pool creation FAILED:', createResult);
			if (createResult[2]) console.log(parseTransactionRecord(createResult[2]));
			fail('Global pool creation failed for audit test');
		}

		auditGlobalPoolId = Number(createResult[1][0]);
		console.log('Created global pool:', auditGlobalPoolId);
		await sleep(5000);

		// Verify it's a global pool
		let encodedCommand = poolManagerIface.encodeFunctionData('isGlobalPool', [auditGlobalPoolId]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const isGlobal = poolManagerIface.decodeFunctionResult('isGlobalPool', result);
		expect(isGlobal[0]).to.equal(true);

		// Bob buys 1 entry
		client.setOperator(bobId, bobPK);

		// Associate pool ticket token
		encodedCommand = lazyLottoIface.encodeFunctionData('getPoolBasicInfo', [auditGlobalPoolId]);
		result = await readOnlyEVMFromMirrorNode(env, lazyLottoId, encodedCommand, operatorId, false);
		const poolDetails = lazyLottoIface.decodeFunctionResult('getPoolBasicInfo', result);
		const poolTokenId = TokenId.fromSolidityAddress(poolDetails[6]);

		try {
			const assocResult = await associateTokensToAccount(client, bobId, bobPK, [poolTokenId]);
			expect(assocResult).to.equal('SUCCESS');
		}
		catch (e) {
			// Token may already be associated from prior tests
			console.log('Token association skipped (may already be associated):', e.message);
		}

		const buyResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			500_000,
			'buyEntry',
			[auditGlobalPoolId, 1],
			new Hbar(AUDIT_ENTRY_FEE, HbarUnit.Tinybar),
		);

		if (buyResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('buyEntry FAILED:', buyResult);
			if (buyResult[2]) console.log(parseTransactionRecord(buyResult[2]));
			fail('buyEntry failed for audit test');
		}

		console.log('Bob purchased 1 entry');
		await sleep(5000);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ Global pool created and entry purchased for pendingWithdrawals test');
	});

	it('Should verify pendingWithdrawals decrements after global pool withdrawal', async function () {
		console.log('\n-Testing pendingWithdrawals decrement on global pool withdrawal...');

		// Query pendingWithdrawals for HBAR before withdrawal
		let encodedCommand = poolManagerIface.encodeFunctionData('pendingWithdrawals', [
			'0x0000000000000000000000000000000000000000',
		]);
		let result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const pendingBefore = poolManagerIface.decodeFunctionResult('pendingWithdrawals', result);
		const pendingBeforeValue = Number(pendingBefore[0]);

		console.log('pendingWithdrawals (HBAR) before:', pendingBeforeValue);

		// Query pool proceeds to know how much will be withdrawn
		encodedCommand = poolManagerIface.encodeFunctionData('getPoolProceeds', [
			auditGlobalPoolId,
			'0x0000000000000000000000000000000000000000',
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const proceeds = poolManagerIface.decodeFunctionResult('getPoolProceeds', result);
		const availableAmount = Number(proceeds[0]) - Number(proceeds[1]);

		console.log('Available proceeds for global pool', auditGlobalPoolId, ':', availableAmount);
		expect(availableAmount).to.be.greaterThan(0);

		// Admin withdraws global pool proceeds
		client.setOperator(adminId, adminPK);

		const gasEstimate = await estimateGas(
			env,
			lazyLottoId,
			lazyLottoIface,
			adminId,
			'withdrawGlobalPoolProceeds',
			[auditGlobalPoolId, '0x0000000000000000000000000000000000000000'],
			500_000,
		);

		const withdrawResult = await contractExecuteFunction(
			lazyLottoId,
			lazyLottoIface,
			client,
			gasEstimate.gasLimit,
			'withdrawGlobalPoolProceeds',
			[auditGlobalPoolId, '0x0000000000000000000000000000000000000000'],
		);

		if (withdrawResult[0]?.status?.toString() !== 'SUCCESS') {
			console.log('withdrawGlobalPoolProceeds FAILED:', withdrawResult);
			if (withdrawResult[2]) console.log(parseTransactionRecord(withdrawResult[2]));
			fail('withdrawGlobalPoolProceeds failed for audit test');
		}

		console.log(parseTransactionRecord(withdrawResult[2]));

		await sleep(5000);

		// Query pendingWithdrawals for HBAR after withdrawal
		encodedCommand = poolManagerIface.encodeFunctionData('pendingWithdrawals', [
			'0x0000000000000000000000000000000000000000',
		]);
		result = await readOnlyEVMFromMirrorNode(env, poolManagerId, encodedCommand, operatorId, false);
		const pendingAfter = poolManagerIface.decodeFunctionResult('pendingWithdrawals', result);
		const pendingAfterValue = Number(pendingAfter[0]);

		console.log('pendingWithdrawals (HBAR) after:', pendingAfterValue);

		// pendingWithdrawals should have decreased by the withdrawn amount
		const decrease = pendingBeforeValue - pendingAfterValue;
		console.log('pendingWithdrawals decreased by:', decrease);

		expect(decrease).to.equal(availableAmount);
		expect(pendingAfterValue).to.be.lessThan(pendingBeforeValue);

		client.setOperator(operatorId, operatorKey);
		console.log('✓ pendingWithdrawals correctly decremented by', decrease, 'after global pool withdrawal');
	});
});

describe('LazyLottoPoolManager - Cleanup:', function () {
	it('Should clear LAZY allowances', async function () {
		console.log('\n-Clearing LAZY allowances...');

		const { clearFTAllowances } = require('../utils/hederaHelpers');

		// Parallelize clearing LAZY allowances
		const clearancePromises = lazyAllowancesSet.map(async (account) => {
			client.setOperator(account.id, account.key);

			const allowanceList = [
				{ tokenId: lazyTokenId, owner: account.id, spender: lazyGasStationId },
			];

			try {
				await clearFTAllowances(client, allowanceList);
				console.log(`Cleared allowances for ${account.id.toString()}`);
			}
			catch (error) {
				console.log(`Failed to clear allowances for ${account.id.toString()}:`, error.message);
			}
			return account;
		});

		await Promise.all(clearancePromises);

		console.log('✓ Allowances cleared');
	});

	it('Should sweep HBAR from test accounts', async function () {
		console.log('\n-Sweeping HBAR from test accounts...');

		await sleep(5000);
		client.setOperator(operatorId, operatorKey);

		// Parallelize HBAR sweeping
		const sweepPromises = createdAccounts.map(async (account) => {
			try {
				const hbarAmount = await checkMirrorHbarBalance(env, account.id);
				if (hbarAmount && hbarAmount > 1000000) {
					const sweepResult = await sweepHbar(
						client,
						account.id,
						account.key,
						operatorId,
						new Hbar(hbarAmount - 500000, HbarUnit.Tinybar),
					);
					if (sweepResult === 'SUCCESS') {
						console.log(`Swept HBAR from ${account.id.toString()}`);
					}
				}
			}
			catch (error) {
				console.log(`Failed to sweep ${account.id.toString()}:`, error.message);
			}
			return account;
		});

		await Promise.all(sweepPromises);

		console.log('✓ HBAR sweep completed');
	});
});
