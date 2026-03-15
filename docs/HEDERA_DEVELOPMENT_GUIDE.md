# Hedera Development Guide for Claude

This document captures Hedera-specific development patterns, nuances, and best practices learned from real-world projects. It is designed to help Claude understand how to work with Hedera smart contracts correctly, avoiding common mistakes that occur when applying standard Ethereum patterns.

**Target Audience**: Claude (AI assistant) working on Hedera projects
**Purpose**: Ensure consistent, correct Hedera development across projects
**Portability**: Copy this file to any Hedera project's docs folder

---

## Table of Contents

1. [Critical Differences from Ethereum](#1-critical-differences-from-ethereum)
2. [Mirror Node vs Consensus Network](#2-mirror-node-vs-consensus-network)
3. [Transaction ID Formats](#3-transaction-id-formats)
4. [HTS Tokens vs ERC-20](#4-hts-tokens-vs-erc-20)
5. [Token Association (Hedera-Specific)](#5-token-association-hedera-specific)
6. [Allowances and the Storage Contract Pattern](#6-allowances-and-the-storage-contract-pattern)
7. [Client Setup and Environment Handling](#7-client-setup-and-environment-handling)
8. [Ethers.js Integration Patterns](#8-ethersjs-integration-patterns)
9. [Contract Interaction Patterns](#9-contract-interaction-patterns)
10. [Testing Patterns](#10-testing-patterns)
11. [Multi-Signature Considerations](#11-multi-signature-considerations)
12. [Account and Address Formats](#12-account-and-address-formats)
13. [PRNG (Random Numbers)](#13-prng-random-numbers)
14. [Gas and Contract Size Limits](#14-gas-and-contract-size-limits)
15. [Common Pitfalls and Corrections](#15-common-pitfalls-and-corrections)

---

## 1. Critical Differences from Ethereum

**STOP AND READ THIS FIRST.** These are the most common mistakes when applying Ethereum knowledge to Hedera:

| Aspect | Ethereum | Hedera |
|--------|----------|--------|
| Token transfers | Just send | Must **associate** token first |
| Allowances | Approve the contract you're calling | May need to approve a **different** contract (storage pattern) |
| Reading data | Call the node (costs gas) | Use **mirror node** (free) |
| Transaction records | Available immediately | Wait **5+ seconds** for mirror node |
| Account format | 0x address only | `0.0.XXXXX` AND 0x address |
| Token standard | ERC-20/721 | HTS (Hedera Token Service) via precompile |
| RPC endpoints | Standard JSON-RPC | Hedera SDK + Mirror Node REST API |

---

## 2. Mirror Node vs Consensus Network

### Understanding the Difference

- **Consensus Network**: The actual Hedera network where transactions execute. Queries cost gas/fees. Requires signing.
- **Mirror Node**: A read-only copy of the network state. Queries are **free**. No signing required.

### When to Use Each

| Use Case | Use Mirror Node | Use Consensus |
|----------|-----------------|---------------|
| Read contract state | ✅ Yes (free) | Avoid (costs gas) |
| Get transaction receipt | ✅ Yes (after delay) | Only if immediate |
| Get transaction record | ✅ Yes (free) | Requires signing |
| Execute transactions | ❌ No | ✅ Yes |
| Real-time data | ❌ No (5s delay) | ✅ Yes |

### Mirror Node URLs

```javascript
function getBaseURL(env) {
    const envLower = env.toLowerCase();
    if (envLower === 'test' || envLower === 'testnet') {
        return 'https://testnet.mirrornode.hedera.com';
    }
    else if (envLower === 'main' || envLower === 'mainnet') {
        return 'https://mainnet-public.mirrornode.hedera.com';
    }
    else if (envLower === 'preview' || envLower === 'previewnet') {
        return 'https://previewnet.mirrornode.hedera.com';
    }
    else if (envLower === 'local') {
        return 'http://localhost:8000';
    }
    throw new Error(`Unknown environment: ${env}`);
}
```

### Key Mirror Node Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/v1/accounts/{id}` | Account balance, info |
| `/api/v1/accounts/{id}/tokens` | Token balances |
| `/api/v1/accounts/{id}/allowances/tokens` | FT allowances |
| `/api/v1/accounts/{id}/allowances/nfts` | NFT approvals |
| `/api/v1/contracts/call` | Read-only EVM calls (free!) |
| `/api/v1/contracts/results/{txId}` | Contract execution results |
| `/api/v1/contracts/{id}/results/logs` | Contract events |
| `/api/v1/transactions/{txId}` | Transaction status |
| `/api/v1/tokens/{id}` | Token details |

### Mirror Node Propagation Delay

**CRITICAL**: After a transaction executes, wait **5 seconds minimum** before querying mirror node.

```javascript
async function getContractResultWithRetry(env, transactionId, options = {}) {
    const {
        initialDelay = 5000,  // 5 seconds - critical for mirror propagation
        retryDelay = 3000,    // 3 seconds between retries
        maxRetries = 10,
    } = options;

    // Wait for mirror node propagation
    console.log(`Waiting ${initialDelay / 1000}s for mirror node propagation...`);
    await new Promise(resolve => setTimeout(resolve, initialDelay));

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await queryMirrorNode(env, transactionId);
            if (result.success) return result;
        } catch (e) {
            // Continue retrying
        }

        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    throw new Error('Transaction not available on mirror node after retries');
}
```

### Read-Only Contract Calls via Mirror Node

**This is the preferred way to read contract state** - it's free and doesn't require signing:

```javascript
async function readOnlyEVMFromMirrorNode(env, contractId, encodedData, fromAccount) {
    const baseUrl = getBaseURL(env);

    const body = {
        block: 'latest',
        data: encodedData,  // Encoded function call from ethers
        estimate: false,
        from: fromAccount.toSolidityAddress(),
        gas: 300000,
        gasPrice: 100000000,
        to: contractId.toSolidityAddress(),
        value: 0,
    };

    const response = await axios.post(`${baseUrl}/api/v1/contracts/call`, body);
    return response.data?.result;  // Encoded result - decode with ethers
}

// Usage:
const iface = new ethers.Interface(contractAbi);
const encoded = iface.encodeFunctionData('balanceOf', [userAddress]);
const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId);
const balance = iface.decodeFunctionResult('balanceOf', result)[0];
```

---

## 3. Transaction ID Formats

Hedera has TWO transaction ID formats. Converting between them is essential.

### SDK Format (Used by Hedera SDK)
```
0.0.1234@1234567890.123456789
```
- Format: `{accountId}@{seconds}.{nanoseconds}`

### Mirror Node Format (Used in REST API)
```
0.0.1234-1234567890-123456789
```
- Format: `{accountId}-{seconds}-{nanoseconds}`

### Conversion Function

```javascript
function formatTransactionIdForMirror(transactionIdStr) {
    if (!transactionIdStr) return transactionIdStr;

    // Already in mirror format
    if (!transactionIdStr.includes('@')) {
        return transactionIdStr;
    }

    // Convert from SDK format to mirror format
    const parts = transactionIdStr.split('@');
    if (parts.length !== 2) return transactionIdStr;

    const timeParts = parts[1].split('.');
    if (timeParts.length !== 2) return transactionIdStr;

    return `${parts[0]}-${timeParts[0]}-${timeParts[1]}`;
}

// SDK format: 0.0.1234@1234567890.123456789
// Mirror format: 0.0.1234-1234567890-123456789
```

---

## 4. HTS Tokens vs ERC-20

Hedera Token Service (HTS) is **NOT** ERC-20, even though Hedera has EVM compatibility.

### Key Differences

| Feature | ERC-20 | HTS |
|---------|--------|-----|
| Implementation | Smart contract | Native precompile (0x167) |
| Association | Not required | **Required before receiving** |
| Allowances | Standard approve() | Via SDK or precompile |
| Response codes | Revert on failure | Status codes (check!) |
| Gas cost | Higher | Lower (native operation) |

### HTS Precompile Address

```solidity
// In Solidity contracts
address constant HTS_PRECOMPILE = address(0x167);
```

### Checking HTS Response Codes

**Always check response codes** - HTS operations don't always revert on failure:

```solidity
// In Solidity
import "./HederaResponseCodes.sol";

int responseCode = HederaTokenService.transferToken(token, from, to, amount);
require(responseCode == HederaResponseCodes.SUCCESS, "Transfer failed");
```

```javascript
// In JavaScript - check receipt status
const receipt = await transaction.getReceipt(client);
if (receipt.status.toString() !== 'SUCCESS') {
    throw new Error(`HTS operation failed: ${receipt.status}`);
}
```

---

## 5. Token Association (Hedera-Specific)

**THIS IS THE #1 GOTCHA FOR ETHEREUM DEVELOPERS**

On Hedera, accounts **MUST associate with a token BEFORE they can receive it**. This is a deliberate anti-spam mechanism.

### Why This Exists

- Prevents spam tokens being sent to accounts
- Account owner must explicitly opt-in to each token
- Accounts have limited auto-association slots

### How to Associate Tokens

```javascript
const { TokenAssociateTransaction } = require('@hashgraph/sdk');

async function associateTokenToAccount(client, accountId, accountKey, tokenId) {
    const transaction = await new TokenAssociateTransaction()
        .setAccountId(accountId)
        .setTokenIds([tokenId])
        .freezeWith(client)
        .sign(accountKey);  // MUST be signed by the receiving account

    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);

    return receipt.status.toString();  // Should be 'SUCCESS'
}

// Associate multiple tokens at once
async function associateTokensToAccount(client, accountId, accountKey, tokenIds) {
    const transaction = await new TokenAssociateTransaction()
        .setAccountId(accountId)
        .setTokenIds(tokenIds)  // Array of token IDs
        .freezeWith(client)
        .sign(accountKey);

    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);

    return receipt.status.toString();
}
```

### Auto-Association

Accounts can have auto-association slots that automatically associate new tokens:

```javascript
const { AccountCreateTransaction } = require('@hashgraph/sdk');

// Create account with auto-association slots
const response = await new AccountCreateTransaction()
    .setInitialBalance(new Hbar(10))
    .setMaxAutomaticTokenAssociations(10)  // Auto-associate up to 10 tokens
    .setKey(privateKey.publicKey)
    .execute(client);
```

### Checking Association Status

```javascript
async function isTokenAssociated(env, accountId, tokenId) {
    const baseUrl = getBaseURL(env);
    const url = `${baseUrl}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`;

    try {
        const response = await axios.get(url);
        return response.data.tokens.length > 0;
    } catch (e) {
        return false;
    }
}
```

---

## 6. Allowances and the Storage Contract Pattern

**CRITICAL PATTERN**: In many Hedera contracts, users approve tokens to a **STORAGE CONTRACT**, not the main contract they're interacting with.

### Why This Pattern Exists

- Main contracts often delegate HTS operations to a library/storage contract
- The storage contract is the one actually calling `transferFrom()`
- If you approve the wrong contract, transfers will fail

### The LazyLotto Example

```
┌─────────────────┐        ┌──────────────────────┐
│   LazyLotto     │───────>│  LazyLottoStorage    │
│   (Main)        │        │  (Does HTS calls)    │
└─────────────────┘        └──────────────────────┘
                                     │
                                     │ transferFrom()
                                     ▼
                           ┌──────────────────────┐
                           │   User's Tokens      │
                           └──────────────────────┘

$LAZY approvals → LazyGasStation (handles burn logic)
Other token/NFT approvals → LazyLottoStorage (holds all non-LAZY assets)
HBAR → no allowance needed (sent as msg.value)
```

### Setting Allowances Correctly

```javascript
const { AccountAllowanceApproveTransaction } = require('@hashgraph/sdk');

// Fungible Token Allowance
async function setFTAllowance(client, tokenId, ownerId, spenderId, amount) {
    const transaction = new AccountAllowanceApproveTransaction()
        .approveTokenAllowance(
            tokenId,
            ownerId,    // Token owner (user)
            spenderId,  // STORAGE CONTRACT - not main contract!
            amount,
        )
        .freezeWith(client);

    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);

    console.log(`Allowance set: ${tokenId} owner=${ownerId} spender=${spenderId}`);
    return receipt.status.toString();
}

// HBAR Allowance (for paying fees via contract)
async function setHbarAllowance(client, ownerId, spenderId, amountHbar) {
    const transaction = new AccountAllowanceApproveTransaction()
        .approveHbarAllowance(ownerId, spenderId, new Hbar(amountHbar))
        .freezeWith(client);

    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);

    return receipt.status.toString();
}
```

### Checking Existing Allowances

```javascript
async function checkTokenAllowance(env, ownerId, tokenId) {
    const baseUrl = getBaseURL(env);
    const url = `${baseUrl}/api/v1/accounts/${ownerId}/allowances/tokens`;

    const response = await axios.get(url);

    for (const allowance of response.data.allowances || []) {
        if (allowance.token_id === tokenId.toString()) {
            return {
                spender: allowance.spender,
                amount: allowance.amount,
            };
        }
    }

    return null;
}
```

---

## 7. Client Setup and Environment Handling

### Standard Client Initialization Pattern

```javascript
const {
    Client,
    AccountId,
    PrivateKey,
} = require('@hashgraph/sdk');
require('dotenv').config();

function initializeClient() {
    // Load credentials
    const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
    const operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
    const env = process.env.ENVIRONMENT || 'testnet';

    // Create client based on environment
    const envUpper = env.toUpperCase();
    let client;

    if (envUpper === 'MAINNET' || envUpper === 'MAIN') {
        client = Client.forMainnet();
        console.log('Using MAINNET');
    }
    else if (envUpper === 'TESTNET' || envUpper === 'TEST') {
        client = Client.forTestnet();
        console.log('Using TESTNET');
    }
    else if (envUpper === 'PREVIEWNET' || envUpper === 'PREVIEW') {
        client = Client.forPreviewnet();
        console.log('Using PREVIEWNET');
    }
    else if (envUpper === 'LOCAL') {
        const node = { '127.0.0.1:50211': new AccountId(3) };
        client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
        console.log('Using LOCAL');
    }
    else {
        throw new Error(`Unknown environment: ${env}`);
    }

    client.setOperator(operatorId, operatorKey);

    return { client, operatorId, operatorKey, env };
}
```

### Environment Variable Pattern

```env
# .env file
ENVIRONMENT=testnet
ACCOUNT_ID=0.0.123456
PRIVATE_KEY=302e020100300506032b657004220420...

# Contract addresses
LAZY_LOTTO_CONTRACT_ID=0.0.234567
LAZY_LOTTO_STORAGE=0.0.234568

# Token configuration
LAZY_TOKEN_ID=0.0.345678
LAZY_DECIMALS=1
```

### Key Type Detection

Hedera supports both ED25519 and ECDSA keys. Detect by DER prefix:

```javascript
function detectKeyType(privateKeyHex) {
    if (privateKeyHex.startsWith('302e')) {
        return 'ED25519';
    }
    else if (privateKeyHex.startsWith('3030')) {
        return 'ECDSA';
    }
    return 'UNKNOWN';
}

function loadPrivateKey(keyString) {
    const keyType = detectKeyType(keyString);

    if (keyType === 'ED25519') {
        return PrivateKey.fromStringED25519(keyString);
    }
    else if (keyType === 'ECDSA') {
        return PrivateKey.fromStringECDSA(keyString);
    }
    else {
        // Try DER format (auto-detect)
        return PrivateKey.fromStringDer(keyString);
    }
}
```

---

## 8. Ethers.js Integration Patterns

Ethers.js works excellently with Hedera for ABI encoding/decoding, even though Hedera isn't standard Ethereum.

### Creating an Interface

```javascript
const { ethers } = require('ethers');
const fs = require('fs');

// From compiled artifact
const contractJson = JSON.parse(
    fs.readFileSync('./artifacts/contracts/MyContract.sol/MyContract.json')
);
const iface = new ethers.Interface(contractJson.abi);

// From ABI file
const abi = JSON.parse(fs.readFileSync('./abi/MyContract.json'));
const iface = new ethers.Interface(abi);
```

### Encoding Function Calls

```javascript
// Simple encoding
const encoded = iface.encodeFunctionData('transfer', [recipient, amount]);

// For mirror node queries
const encodedQuery = iface.encodeFunctionData('balanceOf', [userAddress]);

// With complex parameters
const encoded = iface.encodeFunctionData('createPool', [
    tokenAddress,
    BigInt(1000000),  // Use BigInt for large numbers
    true,
    [addr1, addr2],   // Arrays work fine
]);
```

### Decoding Results

```javascript
// Decode function return value
const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId);
const decoded = iface.decodeFunctionResult('balanceOf', result);
const balance = decoded[0];  // First return value

// Decode multiple return values
const decoded = iface.decodeFunctionResult('getPoolInfo', result);
const [name, balance, isActive] = decoded;
```

### Parsing Events

```javascript
// Parse event from log data
function parseEvent(iface, logData, topics) {
    const event = iface.parseLog({ data: logData, topics: topics });

    return {
        name: event.name,
        args: event.args,
    };
}

// From mirror node logs
async function getContractEvents(env, contractId, iface) {
    const baseUrl = getBaseURL(env);
    const url = `${baseUrl}/api/v1/contracts/${contractId}/results/logs?order=desc&limit=100`;

    const response = await axios.get(url);
    const events = [];

    for (const log of response.data.logs) {
        if (log.data === '0x') continue;

        try {
            const event = iface.parseLog({ topics: log.topics, data: log.data });
            events.push({
                name: event.name,
                args: event.args,
                transactionHash: log.transaction_hash,
                blockNumber: log.block_number,
            });
        } catch (e) {
            // Unknown event, skip
        }
    }

    return events;
}
```

### Parsing Errors

```javascript
function parseError(iface, errorData) {
    if (!errorData) {
        return 'Unknown error: no data';
    }

    // Standard revert with string message
    if (errorData.startsWith('0x08c379a0')) {
        const content = `0x${errorData.substring(10)}`;
        const message = ethers.AbiCoder.defaultAbiCoder().decode(['string'], content);
        return `Revert: ${message}`;
    }

    // Panic error (from Solidity compiler)
    if (errorData.startsWith('0x4e487b71')) {
        const content = `0x${errorData.substring(10)}`;
        const code = ethers.AbiCoder.defaultAbiCoder().decode(['uint'], content);

        const panicCodes = {
            0x00: 'Generic compiler panic',
            0x01: 'Assert failed',
            0x11: 'Arithmetic overflow/underflow',
            0x12: 'Division by zero',
            0x21: 'Invalid enum value',
            0x22: 'Storage byte array encoding error',
            0x31: 'pop() on empty array',
            0x32: 'Array index out of bounds',
            0x41: 'Too much memory allocated',
            0x51: 'Called invalid internal function',
        };

        return `Panic: ${panicCodes[Number(code)] || `Unknown code ${code}`}`;
    }

    // Try custom error from contract ABI
    try {
        const parsed = iface.parseError(errorData);
        if (parsed) {
            const args = parsed.args.map(a => a.toString()).join(', ');
            return `${parsed.name}(${args})`;
        }
    } catch (e) {
        // Not a known custom error
    }

    return `Unknown error: ${errorData}`;
}
```

---

## 9. Contract Interaction Patterns

### Standard Contract Execution

```javascript
const { ContractExecuteTransaction, Hbar } = require('@hashgraph/sdk');

async function executeContract(client, contractId, iface, functionName, params, gas = 300000, payableHbar = 0) {
    // Encode function call
    const encoded = iface.encodeFunctionData(functionName, params);

    // Build transaction
    let tx = new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(gas)
        .setFunctionParameters(Buffer.from(encoded.slice(2), 'hex'));

    // Add HBAR if payable
    if (payableHbar > 0) {
        tx = tx.setPayableAmount(new Hbar(payableHbar));
    }

    // Execute
    const response = await tx.execute(client);
    const receipt = await response.getReceipt(client);

    // Check status
    if (receipt.status.toString() !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${receipt.status}`);
    }

    return { response, receipt };
}
```

### Multi-Sig Aware Execution

For scripts that should support multi-sig, use a wrapper function:

```javascript
async function executeContractFunction(options) {
    const {
        contractId,
        iface,
        client,
        functionName,
        params = [],
        gas = 300000,
        payableAmount = 0,
    } = options;

    // Check if multi-sig mode is enabled
    if (process.argv.includes('--multisig')) {
        return await executeWithMultiSig(options);
    }

    // Standard single-sig execution
    try {
        const encoded = iface.encodeFunctionData(functionName, params);

        let tx = new ContractExecuteTransaction()
            .setContractId(contractId)
            .setGas(gas)
            .setFunctionParameters(Buffer.from(encoded.slice(2), 'hex'));

        if (payableAmount > 0) {
            tx = tx.setPayableAmount(Hbar.from(payableAmount, HbarUnit.Tinybar));
        }

        const response = await tx.execute(client);
        const receipt = await response.getReceipt(client);

        return {
            success: receipt.status.toString() === 'SUCCESS',
            receipt,
            transactionId: response.transactionId.toString(),
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
        };
    }
}
```

### Query Contract State (Free via Mirror)

```javascript
async function queryContract(env, contractId, iface, functionName, params = []) {
    const encoded = iface.encodeFunctionData(functionName, params);

    const result = await readOnlyEVMFromMirrorNode(
        env,
        contractId,
        encoded,
        AccountId.fromString('0.0.1'),  // Dummy "from" address for queries
    );

    return iface.decodeFunctionResult(functionName, result);
}

// Usage
const balance = await queryContract(env, contractId, iface, 'balanceOf', [userAddress]);
const poolInfo = await queryContract(env, contractId, iface, 'getPoolInfo', [poolId]);
```

---

## 10. Testing Patterns

### Hardhat Configuration for Hedera

```javascript
// hardhat.config.js
module.exports = {
    solidity: {
        version: '0.8.18',
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: true,  // Required for complex contracts near size limit
        },
    },
    mocha: {
        timeout: 100000,  // 100 seconds - Hedera operations are slower
        slow: 100000,
    },
    contractSizer: {
        strict: true,  // Fail if any contract exceeds 24KB
    },
};
```

### Test Setup Pattern

```javascript
const { expect } = require('chai');
const { Client, AccountId, PrivateKey, Hbar } = require('@hashgraph/sdk');

describe('MyContract', function() {
    let client;
    let operatorId, operatorKey;
    let contractId;
    let testAccounts = [];

    before(async function() {
        // Initialize client
        operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
        operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
        client = Client.forTestnet().setOperator(operatorId, operatorKey);

        // Deploy contract (or use existing)
        contractId = await deployContract(client, ...);
    });

    beforeEach(async function() {
        // Create fresh test accounts for each test
        const aliceKey = PrivateKey.generateED25519();
        const aliceId = await accountCreator(client, aliceKey, 100);
        testAccounts.push({ id: aliceId, key: aliceKey });
    });

    afterEach(async function() {
        // Cleanup test accounts (optional - transfer HBAR back)
    });

    after(async function() {
        client.close();
    });
});
```

### Account Creation for Tests

```javascript
async function accountCreator(client, privateKey, initialHbar, autoAssociations = 0) {
    const response = await new AccountCreateTransaction()
        .setInitialBalance(new Hbar(initialHbar))
        .setMaxAutomaticTokenAssociations(autoAssociations)
        .setKey(privateKey.publicKey)
        .execute(client);

    const receipt = await response.getReceipt(client);
    return receipt.accountId;
}
```

### Token Setup for Tests

```javascript
describe('Token operations', function() {
    before(async function() {
        // 1. Create test token
        testTokenId = await createFungibleToken(client, ...);

        // 2. Associate token with test accounts
        for (const account of testAccounts) {
            await associateTokenToAccount(
                client,
                account.id,
                account.key,
                testTokenId
            );
        }

        // 3. Set allowances to STORAGE contract (not main contract!)
        for (const account of testAccounts) {
            await setFTAllowance(
                client,
                testTokenId,
                account.id,
                storageContractId,  // STORAGE!
                BigInt(Number.MAX_SAFE_INTEGER),
            );
        }

        // 4. Transfer tokens to test accounts
        for (const account of testAccounts) {
            await transferToken(client, testTokenId, operatorId, account.id, 10000);
        }
    });
});
```

### Deterministic PRNG for Tests

```javascript
// In tests, mock the PRNG contract to return predictable values
// This allows testing specific outcomes

async function mockPrngSeed(prngContract, seedValue) {
    // Implementation depends on your PRNG mock
    await prngContract.setNextSeed(seedValue);
}

it('should handle winning outcome', async function() {
    // Set PRNG to return winning seed
    await mockPrngSeed(prngContract, WINNING_SEED);

    // Execute operation that uses PRNG
    await contract.play({ from: alice });

    // Verify winning behavior
    expect(await contract.lastResult()).to.equal('WIN');
});
```

---

## 11. Multi-Signature Considerations

### Transaction Validity Window

Hedera transactions are only valid for **119 seconds** after creation. For multi-sig:

```javascript
const HEDERA_TX_VALIDITY = 119;  // seconds
const SAFE_TIMEOUT = 110;        // Leave 9 second buffer

// When collecting signatures, check remaining time
function getRemainingTime(transaction) {
    const validStart = transaction.transactionValidStart;
    const now = Date.now() / 1000;
    const elapsed = now - validStart.seconds;
    return HEDERA_TX_VALIDITY - elapsed;
}
```

### Getting Transaction Records After Multi-Sig

**Problem**: After multi-sig execution, you can't call `getRecord()` without signing again.
**Solution**: Use mirror node (free, no signing required).

```javascript
async function getTransactionResultAfterMultiSig(env, transactionId) {
    // Wait for mirror node propagation
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Query mirror node instead of consensus
    const mirrorTxId = formatTransactionIdForMirror(transactionId);
    const baseUrl = getBaseURL(env);
    const url = `${baseUrl}/api/v1/transactions/${mirrorTxId}`;

    const response = await axios.get(url);
    return response.data;
}
```

### Freezing Transactions for Multi-Sig

```javascript
async function freezeTransactionForSignatures(client, transaction) {
    // Freeze the transaction - makes it immutable
    const frozenTx = await transaction.freezeWith(client);

    // Get bytes for signing
    const txBytes = frozenTx.toBytes();

    return {
        frozenTransaction: frozenTx,
        bytes: txBytes,
        transactionId: frozenTx.transactionId.toString(),
    };
}

// Each signer signs the bytes
function signTransactionBytes(txBytes, privateKey) {
    const signature = privateKey.sign(txBytes);
    return {
        publicKey: privateKey.publicKey.toStringRaw(),
        signature: Buffer.from(signature).toString('hex'),
    };
}
```

---

## 12. Account and Address Formats

### Hedera Account ID

```
0.0.123456
 │  │   │
 │  │   └── Entity number
 │  └────── Realm (always 0 for now)
 └───────── Shard (always 0 for now)
```

### Converting Between Formats

```javascript
const { AccountId, ContractId } = require('@hashgraph/sdk');

// Hedera ID to Solidity address
const accountId = AccountId.fromString('0.0.123456');
const evmAddress = accountId.toSolidityAddress();
// Returns: 0x000000000000000000000000000000000001e240

// Solidity address to Hedera ID
const evmAddress = '0x000000000000000000000000000000000001e240';
const accountId = AccountId.fromEvmAddress(0, 0, evmAddress);
// Returns: 0.0.123456

// Same for contracts
const contractId = ContractId.fromString('0.0.234567');
const contractEvmAddress = contractId.toSolidityAddress();
```

### In Solidity Contracts

```solidity
// Convert Hedera account to address
function hederaAccountToAddress(uint64 accountNum) internal pure returns (address) {
    return address(uint160(accountNum));
}

// The reverse is trickier - use events or return values
```

---

## 13. PRNG (Random Numbers)

### Hedera PRNG Precompile

```solidity
// Address: 0x169
interface IPrngSystemContract {
    function getPseudorandomSeed() external returns (bytes32);
}

contract MyContract {
    address constant PRNG = address(0x169);

    function getRandomNumber() internal returns (bytes32) {
        (bool success, bytes memory result) = PRNG.call(
            abi.encodeWithSignature("getPseudorandomSeed()")
        );
        require(success, "PRNG call failed");
        return abi.decode(result, (bytes32));
    }
}
```

### Processing PRNG Seeds

The PRNG returns a single seed. For multiple random values, hash with nonces:

```solidity
function getMultipleRandomValues(uint256 count) internal returns (uint256[] memory) {
    bytes32 seed = getRandomNumber();
    uint256[] memory values = new uint256[](count);

    for (uint256 i = 0; i < count; i++) {
        values[i] = uint256(keccak256(abi.encodePacked(seed, i)));
    }

    return values;
}

// For a value in range [0, max)
function randomInRange(bytes32 seed, uint256 nonce, uint256 max) internal pure returns (uint256) {
    return uint256(keccak256(abi.encodePacked(seed, nonce))) % max;
}
```

---

## 14. Gas and Contract Size Limits

### Contract Size Limit

Hedera enforces the same **24KB** contract size limit as Ethereum. Strategies to manage:

1. **Use Libraries**: Extract logic to library contracts
2. **Enable viaIR**: `viaIR: true` in compiler settings
3. **Optimize**: `optimizer.enabled: true, runs: 200`
4. **Split Contracts**: Use storage/logic separation pattern

```javascript
// hardhat.config.js
module.exports = {
    solidity: {
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,  // Lower = smaller bytecode, higher gas per call
            },
            viaIR: true,  // Can reduce size for complex contracts
        },
    },
};
```

### Gas Estimation

```javascript
async function estimateGas(client, contractId, iface, functionName, params) {
    const encoded = iface.encodeFunctionData(functionName, params);

    const query = new ContractCallQuery()
        .setContractId(contractId)
        .setFunctionParameters(Buffer.from(encoded.slice(2), 'hex'))
        .setGas(1000000);  // High gas for estimation

    try {
        const result = await query.execute(client);
        // Estimate is roughly the gas used
        return result.gasUsed * 1.2;  // Add 20% buffer
    } catch (e) {
        // If it fails, use a safe default
        return 300000;
    }
}
```

### Batch Operations

Hedera's gas model makes batch operations important:

```solidity
// Instead of multiple single transfers
function batchTransfer(
    address token,
    address[] calldata recipients,
    uint256[] calldata amounts
) external {
    for (uint256 i = 0; i < recipients.length; i++) {
        // Single HTS call is more efficient than multiple
        _transfer(token, msg.sender, recipients[i], amounts[i]);
    }
}
```

---

## 15. Common Pitfalls and Corrections

### Pitfall 1: Forgetting Token Association

**Wrong:**
```javascript
// This will fail!
await transferToken(client, tokenId, sender, recipient, amount);
```

**Correct:**
```javascript
// First associate, then transfer
await associateTokenToAccount(client, recipient, recipientKey, tokenId);
await transferToken(client, tokenId, sender, recipient, amount);
```

### Pitfall 2: Approving Wrong Contract

**Wrong:**
```javascript
// Approving the main contract - WRONG!
await setFTAllowance(client, tokenId, user, mainContractId, amount);
```

**Correct:**
```javascript
// Approve the storage contract that actually calls transferFrom
await setFTAllowance(client, tokenId, user, storageContractId, amount);
```

### Pitfall 3: Querying Mirror Too Soon

**Wrong:**
```javascript
await executeTransaction(client, tx);
const result = await queryMirrorNode(env, txId);  // May fail!
```

**Correct:**
```javascript
await executeTransaction(client, tx);
await new Promise(r => setTimeout(r, 5000));  // Wait 5 seconds
const result = await queryMirrorNode(env, txId);
```

### Pitfall 4: Using Wrong Transaction ID Format

**Wrong:**
```javascript
// SDK format in mirror URL - WRONG!
const url = `${baseUrl}/api/v1/transactions/0.0.123@456.789`;
```

**Correct:**
```javascript
// Mirror format in mirror URL
const txId = formatTransactionIdForMirror('0.0.123@456.789');
const url = `${baseUrl}/api/v1/transactions/${txId}`;
// URL: .../0.0.123-456-789
```

### Pitfall 5: Assuming ERC-20 Compatibility

**Wrong:**
```javascript
// Assuming standard ERC-20 approve
await token.approve(spender, amount);
```

**Correct:**
```javascript
// Use Hedera SDK for HTS tokens
await new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(tokenId, owner, spender, amount)
    .execute(client);
```

### Pitfall 6: Not Checking HTS Response Codes

**Wrong:**
```solidity
// Assuming success
HederaTokenService.transferToken(token, from, to, amount);
```

**Correct:**
```solidity
int responseCode = HederaTokenService.transferToken(token, from, to, amount);
require(responseCode == HederaResponseCodes.SUCCESS, "Transfer failed");
```

### Pitfall 7: Using getRecord() After Multi-Sig

**Wrong:**
```javascript
// This requires signing - fails in multi-sig mode
const record = await response.getRecord(client);
```

**Correct:**
```javascript
// Use mirror node instead (free, no signing)
await new Promise(r => setTimeout(r, 5000));
const result = await queryMirrorNode(env, transactionId);
```

### Pitfall 8: Hardcoding Environment

**Wrong:**
```javascript
const client = Client.forTestnet();  // Always testnet
```

**Correct:**
```javascript
const env = process.env.ENVIRONMENT || 'testnet';
const client = env === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
```

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│                    HEDERA QUICK REFERENCE                       │
├─────────────────────────────────────────────────────────────────┤
│ Mirror Node Delay:        5 seconds minimum                     │
│ Transaction Validity:     119 seconds (use 110 for safety)      │
│ Contract Size Limit:      24KB                                  │
│ HTS Precompile:           0x167                                 │
│ PRNG Precompile:          0x169                                 │
├─────────────────────────────────────────────────────────────────┤
│ BEFORE receiving tokens:  Associate first!                      │
│ BEFORE spending tokens:   Approve STORAGE contract!             │
│ BEFORE querying mirror:   Wait 5 seconds!                       │
│ BEFORE multi-sig record:  Use mirror node, not getRecord()!     │
├─────────────────────────────────────────────────────────────────┤
│ TX ID SDK format:         0.0.123@456.789                       │
│ TX ID Mirror format:      0.0.123-456-789                       │
│ Account to EVM:           accountId.toSolidityAddress()         │
│ EVM to Account:           AccountId.fromEvmAddress(0, 0, addr)  │
├─────────────────────────────────────────────────────────────────┤
│ Mirror URLs:                                                    │
│   Testnet:  https://testnet.mirrornode.hedera.com               │
│   Mainnet:  https://mainnet-public.mirrornode.hedera.com        │
│   Preview:  https://previewnet.mirrornode.hedera.com            │
│   Local:    http://localhost:8000                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Document Maintenance

- **Last Updated**: 2025-12-29
- **Source Project**: hedera-SC-lazy-lotto
- **Portability**: Copy to any Hedera project's docs folder
- **Target Reader**: Claude (AI assistant)

When copying to a new project:
1. Copy this file to `docs/HEDERA_DEVELOPMENT_GUIDE.md`
2. Reference in CLAUDE.md: "See docs/HEDERA_DEVELOPMENT_GUIDE.md for Hedera patterns"
3. Update project-specific details if needed (contract names, storage addresses)

---

*This guide captures lessons learned from real Hedera development. It prioritizes practical patterns over exhaustive documentation.*
