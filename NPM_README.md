# @lazysuperheroes/lazy-lotto

LazyLotto and LazyTradeLotto lottery systems on Hedera - ABIs and CLI tools.

## Overview

This package provides:

1. **ABIs** for integrating LazyLotto and LazyTradeLotto into your dApp
2. **CLI tools** for interacting with LazyLotto directly from the command line

### LazyLotto

A multi-pool lottery system where users can:
- Buy entries into different prize pools
- Roll entries to try winning prizes
- Win HBAR, HTS tokens, and NFTs

### LazyTradeLotto

A trade-based reward system triggered by NFT marketplace trades. Rolls require backend counter-signing, so only ABIs are exposed (no CLI commands).

## Installation

```bash
npm install @lazysuperheroes/lazy-lotto
```

## For dApp Developers

### Importing ABIs

```javascript
const {
  LazyLottoABI,
  LazyLottoStorageABI,
  LazyTradeLottoABI,
  LazyGasStationABI,
  LazyDelegateRegistryABI
} = require('@lazysuperheroes/lazy-lotto');

// Or use the abi object for dynamic access
const { abi } = require('@lazysuperheroes/lazy-lotto');
console.log(abi.LazyLotto); // Same as LazyLottoABI
```

### Using with ethers.js

```javascript
const { ethers } = require('ethers');
const { LazyLottoABI } = require('@lazysuperheroes/lazy-lotto');

// Create contract instance
const lazyLotto = new ethers.Contract(
  '0.0.YOUR_CONTRACT_ID',  // Hedera contract address
  LazyLottoABI,
  provider
);

// Read pool info
const poolInfo = await lazyLotto.getPoolBasicInfo(0);
console.log('Win rate:', poolInfo.winRate);

// Buy entries (requires signer)
const tx = await lazyLotto.buyEntry(0, 5, { value: entryFee * 5 });
await tx.wait();
```

### Available ABIs

| ABI | Description |
|-----|-------------|
| `LazyLottoABI` | Main lottery contract |
| `LazyLottoStorageABI` | Token handling (approve tokens here) |
| `LazyLottoPoolManagerABI` | Community pool creation |
| `LazyTradeLottoABI` | Trade-based lottery |
| `LazyGasStationABI` | Automatic gas refills |
| `LazyDelegateRegistryABI` | NFT delegation |
| `HederaTokenServiceABI` | HTS precompile |
| `PrngSystemContractABI` | PRNG precompile |

### Contract Addresses

```javascript
const { getAddresses } = require('@lazysuperheroes/lazy-lotto');

// Get addresses for a network
const testnetAddresses = getAddresses('testnet');
console.log(testnetAddresses.lazyLotto);  // Contract ID
```

## For CLI Users

### Setup

1. Create a `.env` file in your project:

```bash
ACCOUNT_ID=0.0.YOUR_ACCOUNT
PRIVATE_KEY=your_ed25519_private_key
ENVIRONMENT=testnet
LAZY_LOTTO_CONTRACT_ID=0.0.CONTRACT_ADDRESS
```

2. Run commands:

```bash
npx lazy-lotto --help
```

Or install globally:

```bash
npm install -g @lazysuperheroes/lazy-lotto
lazy-lotto --help
```

### Commands

#### Query Commands (read-only, no gas cost)

```bash
# List all lottery pools
lazy-lotto pools

# Get detailed info about a specific pool
lazy-lotto pool 0

# Check your entries and prizes across all pools
lazy-lotto user

# Check another user's state
lazy-lotto user 0.0.12345

# View contract configuration
lazy-lotto info

# System health check
lazy-lotto health
```

#### Transaction Commands (requires HBAR for gas)

```bash
# Buy 5 entries in pool 0
lazy-lotto buy 0 5

# Roll all your entries in pool 0
lazy-lotto roll 0

# Roll specific number of entries
lazy-lotto roll 0 10

# Claim all your won prizes
lazy-lotto claim
```

### JSON Output

All commands support `--json` for scripting:

```bash
lazy-lotto pools --json | jq '.pools[0].winRate'
lazy-lotto user --json > my_state.json
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ACCOUNT_ID` | Yes | Your Hedera account (0.0.xxxxx) |
| `PRIVATE_KEY` | Yes | ED25519 private key |
| `ENVIRONMENT` | Yes | TEST, MAIN, or PREVIEW |
| `LAZY_LOTTO_CONTRACT_ID` | For most commands | LazyLotto contract address |
| `LAZY_LOTTO_STORAGE` | For claiming NFTs | Storage contract address |
| `LAZY_TOKEN_ID` | Optional | $LAZY token for fee payments |

## Documentation

Additional documentation included in the package:

- **LazyLotto-BUSINESS_LOGIC.md** - Game mechanics and rules
- **LazyTradeLotto-BUSINESS_LOGIC.md** - Trade lottery mechanics
- **LazyLotto-UX_IMPLEMENTATION_GUIDE.md** - User experience flows
- **LazyTradeLotto-UX_IMPLEMENTATION_GUIDE.md** - Trade lottery UX
- **docs/MULTISIG_*.md** - Multi-signature admin operations

## Key Concepts

### Entry Flow

1. **Buy entries** - Pay entry fee (HBAR or token) to get entries
2. **Roll entries** - Play your entries against the win rate
3. **Claim prizes** - Collect any prizes you've won

### Win Rate

Win rates are expressed in "thousandths of basis points" (0.0001% precision):
- `10000` = 1% win rate
- `100000` = 10% win rate
- `500000` = 50% win rate

### Boosts

Users can earn win rate boosts from:
- Holding $LAZY tokens
- Owning LSH NFTs
- Delegated NFTs

### Token Allowances

When paying with tokens (not HBAR):
- Approve tokens to **LazyLottoStorage** contract (not LazyLotto)
- For $LAZY payments, approve to **LazyGasStation** contract

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| `PoolPaused` | Pool is temporarily paused | Wait or try another pool |
| `PoolClosed` | Pool no longer accepts entries | Try another pool |
| `InsufficientBalance` | Not enough tokens | Add funds |
| `InsufficientAllowance` | Token not approved | Approve $LAZY to GasStation, other tokens to Storage |
| `NoEntries` | No entries to roll | Buy entries first |
| `NoPrizes` | No prizes to claim | Win some prizes first |

## License

ISC

## Links

- [GitHub Repository](https://github.com/lazysuperheroes/hedera-SC-lazy-lotto)
- [Issue Tracker](https://github.com/lazysuperheroes/hedera-SC-lazy-lotto/issues)
