# Hedera Smart Contract Lazy Lotto

A comprehensive decentralized lottery and rewards system built on the Hedera network, featuring two distinct lottery mechanisms: a flexible multi-pool lottery system (LazyLotto) and a trade-based reward system (LazyTradeLotto).

## 🎯 Project Overview

This project implements sophisticated lottery and reward systems that leverage Hedera's native capabilities including HTS (Hedera Token Service), PRNG (Pseudo-Random Number Generation), and smart contract functionality. The system is designed to provide fair, verifiable, and engaging lottery experiences while maintaining security and scalability.

## 🏗️ Architecture

### Core Contracts

#### 1. **LazyLotto** - Multi-Pool Lottery System
A comprehensive lottery platform supporting multiple independent lottery pools with various prize types, ticket systems, and bonus mechanisms. Operates as a three-contract system with LazyLottoPoolManager and LazyLottoStorage.

**Breaking Changes - December 2025:** Contract API updated to v2.1 with paginated query functions. See [API Breaking Changes Guide](./LazyLotto-API_BREAKING_CHANGES.md) for migration instructions.

**Key Features:**
- Multiple independent lottery pools with customizable parameters
- **Community pool creation**: Any user can create and own lottery pools
- Support for HBAR, HTS tokens, and NFT prizes
- Dual ticket system: memory-based (gas efficient) and NFT-based (tradeable)
- Sophisticated boost system for enhanced win rates
- Prize management system with convertible prize NFTs
- Admin-controlled and community-owned pool lifecycle management
- **Paginated queries** for scalability with 100+ prizes/pools
- **Documentation**: See [Business Logic](./LazyLotto-BUSINESS_LOGIC.md), [UX Guide](./LazyLotto-UX_IMPLEMENTATION_GUIDE.md), and [API Changes](./LazyLotto-API_BREAKING_CHANGES.md)
- **Scripts**: 22 interaction scripts in `scripts/interactions/LazyLotto/`
- **Tests**: Comprehensive test suite in `test/LazyLotto.test.js`
- **Contract Size**: 23.782 KB / 24 KB (optimized)

#### 2. **LazyLottoPoolManager** - Pool Ownership and Community Pools
Companion contract to LazyLotto that manages pool ownership, community pool creation, bonus system, proceeds tracking, and prize manager authorization.

**Key Features:**
- Community pool creation with configurable HBAR + $LAZY creation fees
- Pool ownership tracking with transfer capability
- Proceeds management with platform fee split (locked per-pool at creation time)
- Global and per-pool prize manager authorization
- Bonus/boost system (time windows, NFT holdings, $LAZY balance)
- Pool enumeration (global vs community pools, paginated)
- Platform fee percentage management (capped at 25%)
- **Tests**: Comprehensive test suite in `test/LazyLottoPoolManager.test.js`

#### 3. **LazyTradeLotto** - Trade-Based Reward System
A reward mechanism that incentivizes NFT trading activity with lottery-style prizes and a progressive jackpot system.

**Key Features:**
- Trade-triggered lottery rolls for both buyers and sellers
- Progressive jackpot system with automatic growth
- LSH NFT holder benefits (zero burn rate)
- Cryptographic security with signature validation
- Anti-replay protection with trade fingerprinting
- Comprehensive analytics and event tracking
- **Documentation**: See [LazyTradeLotto Business Logic](./LazyTradeLotto-BUSINESS_LOGIC.md)
- **Scripts**: 12 interaction scripts in `scripts/interactions/LazyTradeLotto/`
- **Tests**: Complete test suite in `test/LazyTradeLotto.test.js`

#### 4. **HTSLazyLottoLibrary** - HTS Operations Library
A specialized library handling complex Hedera Token Service operations required by the lottery systems.

**Key Features:**
- NFT collection creation and management
- Batch NFT minting, transfers, and burning
- Token association and validation
- Royalty fee configuration
- Optimized batch operations with gas management

### Supporting Infrastructure

#### External Dependencies
- **LazyGasStation**: Manages automatic HBAR/$LAZY refills and token operations (1 query script)
- **LazyDelegateRegistry**: Handles NFT delegation for bonus calculations (2 scripts, test suite)
- **LazySecureTrade**: Peer-to-peer NFT trading platform that triggers LazyTradeLotto (3 admin scripts)
- **PrngSystemContract**: Provides verifiable random number generation
- **LSH NFT Collections**: Gen1, Gen2, and Gen1 Mutant collections for holder benefits

#### Project Structure
```
hedera-SC-lazy-lotto/
├── contracts/              # Solidity smart contracts
├── test/                   # Test suites (7 test files)
├── scripts/
│   ├── deployments/       # Contract deployment scripts
│   ├── interactions/      # 41 CLI scripts organized by contract
│   ├── debug/             # Debugging and development tools
│   └── testing/           # Testing helper scripts
├── abi/                   # Generated contract ABIs
├── utils/                 # Shared JavaScript utilities (clientFactory, abiLoader, queryHelpers, addressHelpers, promptHelpers, tokenHelpers, scriptHelpers, multiSigIntegration)
├── lib/multiSig/          # Multi-signature library (isolated, zero project deps)
├── docs/                  # Generated HTML documentation
└── [Documentation]        # 10+ markdown documentation files
```

## 🎮 Use Cases

### LazyLotto Use Cases

1. **Traditional Lottery Player**
   - Purchase tickets with various tokens
   - Roll for prizes immediately or accumulate tickets
   - Claim prizes directly or convert to tradeable NFTs

2. **NFT Ticket Trader**
   - Buy tickets as NFTs for secondary market trading
   - Purchase tickets from other users
   - Roll accumulated NFT tickets when ready

3. **Prize Collector**
   - Win various prize types (HBAR, tokens, NFTs)
   - Convert prizes to NFTs for trading
   - Build a portfolio of won prizes

4. **Strategic Player**
   - Monitor time-based bonuses for optimal entry timing
   - Maintain NFT holdings for bonus rates
   - Accumulate $LAZY for balance bonuses

5. **Community Pool Creator**
   - Create custom lottery pools by paying creation fees (HBAR + $LAZY)
   - Add prizes and manage pool lifecycle as pool owner
   - Earn proceeds from entry fees minus platform fee percentage
   - Delegate prize management to partners
   - Transfer pool ownership when needed

### LazyTradeLotto Use Cases

1. **Active NFT Trader**
   - Complete trades on Lazy Secure Trade platform
   - Claim lottery rewards for both buying and selling
   - Benefit from progressive jackpot growth

2. **LSH NFT Holder**
   - Receive zero burn rate on all lottery winnings
   - Delegate NFTs to provide benefits to others
   - Enjoy enhanced value from trading activity

3. **Casual Trader**
   - Participate in occasional trades
   - Contribute to jackpot growth while eligible for wins
   - Potential for significant jackpot wins

## 🎲 How LazyLotto Works

### The Game Loop

LazyLotto is a multi-pool lottery. Each pool has its own win rate, entry fee, and prize collection. The player journey is:

```
Buy Tickets → Roll Tickets → Win or Lose → Claim Prizes
```

1. **Buy** — Pay the pool's entry fee (HBAR or a specific token) to get tickets
2. **Roll** — Each ticket is tested against the pool's win rate using Hedera's verifiable random number generator
3. **Win** — If a ticket wins, a random prize from the pool is assigned to you
4. **Claim** — Collect your won prizes (HBAR, tokens, or NFTs)

### Ticket Modes: Memory vs NFT

When you buy tickets, you choose how to hold them:

| | Memory Tickets | NFT Tickets |
|---|---|---|
| **How to buy** | `buyEntry()` | `buyAndRedeemEntry()` |
| **Gas cost** | Lower (no minting) | Higher (mints NFTs) |
| **Tradeable?** | No — locked to your account | Yes — trade on any NFT marketplace |
| **How to roll** | `rollAll()` or `rollBatch()` | `rollWithNFT(serialNumbers)` |
| **Convert between** | `redeemEntriesToNFT()` → NFTs | Rolling burns the NFT |
| **Best for** | Players who want to roll immediately | Players who want to trade or gift tickets |

**One-shot mode**: `buyAndRollEntry()` buys and rolls in a single transaction — cheapest gas for immediate play.

### Prize Types

Pools can offer three types of prizes, combined in any way:

| Prize Type | Example | Allowance | How It's Added |
|---|---|---|---|
| **HBAR** | 10 HBAR | None (sent as msg.value) | Send HBAR with `addPrizePackage()` |
| **$LAZY** | 500 $LAZY | Approve to **LazyGasStation** | `addPrizePackage()` pulls via GasStation |
| **Other Tokens** | 1000 USDC | Approve to **Storage Contract** | `addPrizePackage()` pulls via Storage |
| **NFTs** | Serial #42 from 0.0.123 | Approve to **Storage Contract** | `addPrizePackage()` transfers via Storage |
| **Combo** | 5 HBAR + 2 NFTs | Per above rules | Single `addPrizePackage()` call |

Won prizes can be claimed directly or converted to tradeable "Prize NFTs" via `redeemPrizeToNFT()` — letting winners sell their prizes before claiming the underlying assets.

### Win Rate & Boosts

Each pool has a base **win rate** (e.g., 1 in 10 chance). Players can boost their odds through:

- **Time bonuses** — Active during promotional windows (e.g., +5% during launch week)
- **NFT holding bonuses** — Hold specific NFT collections for a permanent boost
- **$LAZY balance bonuses** — Maintain a minimum $LAZY balance for an extra boost

Boosts stack additively. A player with all three active gets the sum of all bonuses.

### Example: Complete Player Flow

```bash
# 1. Check what pools are available
node scripts/interactions/LazyLotto/queries/enumeratePools.js

# 2. See details for pool #0 (win rate, entry fee, prizes)
node scripts/interactions/LazyLotto/queries/poolInfo.js

# 3. Buy 5 tickets for pool #0 (pays entry fee x5)
node scripts/interactions/LazyLotto/user/buyEntry.js

# 4. Roll all your tickets — find out if you won!
node scripts/interactions/LazyLotto/user/rollTickets.js

# 5. Check what prizes you've won
node scripts/interactions/LazyLotto/queries/userState.js

# 6. Claim all won prizes to your wallet
node scripts/interactions/LazyLotto/user/claimAllPrizes.js
```

### Example: Buy and Roll in One Shot

```bash
# Buy 3 tickets and roll them immediately (cheapest gas option)
node scripts/interactions/LazyLotto/user/buyAndRoll.js
```

The script prompts for pool ID and ticket count, then shows your results:
- How many tickets won vs lost
- What prizes were awarded
- Total value won

### Example: Adding NFT Prizes to a Pool

```bash
# Interactive wizard — prompts for all parameters:
node scripts/interactions/LazyLotto/admin/addPrizePackage.js

# The wizard asks:
#   Pool ID: 0
#   FT token: none                    (no fungible token component)
#   HBAR amount: 0                    (no HBAR component)
#   NFT token: 0.0.123456             (the NFT collection)
#   Serial numbers: 1,2,3             (specific NFTs to award)
#
# The script verifies you own the NFTs, sets allowances,
# and submits the prize package to the contract.
```

For batch operations, use `addPrizesBatch.js` with a JSON file:
```json
{
  "poolId": 0,
  "packages": [
    { "hbar": 10 },
    { "ft": { "token": "0.0.LAZY_TOKEN", "amount": "100" } },
    { "nfts": [{ "token": "0.0.NFT_COLLECTION", "serials": [42, 43] }] }
  ]
}
```

### Example: Creating a Community Pool

Any user can create their own lottery pool:

```bash
# Interactive wizard — prompts for pool configuration:
node scripts/interactions/LazyLotto/user/createCommunityPool.js

# You configure:
#   Pool name and ticket artwork (IPFS CIDs)
#   Win rate (e.g., 1 in 20 chance)
#   Entry fee (e.g., 2 HBAR per ticket)
#   Fee token (HBAR or a specific HTS token)
#
# You pay:
#   Creation fee in HBAR (covers HTS token creation)
#   Creation fee in $LAZY (platform fee)
#
# You earn:
#   Pool proceeds minus the platform fee % (locked at creation time)
```

After creation, manage your pool:
```bash
# Add prizes to your pool
node scripts/interactions/LazyLotto/admin/addPrizePackage.js

# Check your pool's earnings
node scripts/interactions/LazyLotto/user/viewPoolInfo.js

# Withdraw your share of the proceeds
node scripts/interactions/LazyLotto/user/withdrawPoolProceeds.js

# Delegate prize management to a partner
node scripts/interactions/LazyLotto/user/setPoolPrizeManager.js
```

---

## 🔒 Security Features

### Access Control
- **Multi-admin system** for LazyLotto with last-admin protection
- **Owner-only functions** for LazyTradeLotto configuration
- **Role-based permissions** for all administrative operations

### Financial Security
- **ReentrancyGuard** on all state-changing functions
- **Pausable functionality** for emergency stops
- **Input validation** for all user-provided parameters
- **Balance tracking** for accurate prize accounting

### Cryptographic Security
- **Signature validation** for LazyTradeLotto parameters
- **Anti-replay protection** with transaction history
- **Secure random number generation** via Hedera PRNG
- **Trade fingerprinting** to prevent duplicate claims

## 🔐 Admin Powers & Governance

### Transparency First

LazyLotto v3 uses a **centralized admin model** for operational efficiency while maintaining strong **user protections**. We believe in transparency - here's exactly what admins can and cannot do.

### What Admins CAN Do

**System Operations:**
- ✅ Pause/unpause the system for emergency maintenance
- ✅ Create global (team) pools with no creation fees
- ✅ Set creation fees for community pools (HBAR + LAZY)
- ✅ Configure bonus systems (time windows, NFT holdings, LAZY balance)
- ✅ Add/remove global prize managers (for sponsored prizes)
- ✅ Close malicious or abandoned pools (only if no outstanding entries)

**Financial Operations:**
- ✅ Set platform fee percentage (capped at maximum 25%)
- ✅ Withdraw platform fees (5% default from pool proceeds)
- ✅ Withdraw surplus tokens (beyond prize obligations)
- ✅ Emergency actions via pause (user prizes remain safe)

### What Admins CANNOT Do

**User Protections Built Into Smart Contracts:**
- ❌ **Cannot steal prizes** - Prize accounting enforced by contract math
- ❌ **Cannot change fees retroactively** - Each pool locks its fee % at creation
- ❌ **Cannot withdraw prize-obligated tokens** - Safety checks prevent this
- ❌ **Cannot modify existing pools** - Fee structures are immutable per pool
- ❌ **Cannot access user's NFT tickets** - Users maintain full custody
- ❌ **Cannot prevent prize claims** - Claimable even when paused

### Security Guarantees

1. **Prize Obligations Protected**: Contract enforces `storageBalance - withdrawal >= prizesOwed`
2. **Fee Lock-In**: Platform fee frozen at pool creation (no bait-and-switch)
3. **Platform Fee Cap**: Maximum 25% (prevents confiscatory fees)
4. **Rounding Favors Users**: Pool owners get dust from integer division
5. **Multi-Admin Support**: Multiple admins reduce single point of failure
6. **Reentrancy Protection**: Double guards on LazyLotto + PoolManager

### Current Admin Configuration

**Testnet**: Multi-signature Gnosis Safe recommended  
**Mainnet**: Multi-signature wallet required (2-of-3 or 3-of-5)

### Potential Governance Roadmap

**Phase 1 (Current)**: Centralized admin for rapid iteration and support  
**Phase 2 (6-12 months)**: Community oversight via $LAZY as a governance token  
**Phase 3 (Future)**: Full DAO governance for major decisions

**Why Centralized Now?**
- Quick response to bugs or exploits
- Flexibility for feature additions
- Community support and moderation
- Platform sustainability (5% fee for development)

**Community Protection:**
- Transparent documentation (this section!)
- On-chain verification of all admin actions
- Regular security audits
- Open-source contracts for review

### Questions About Admin Powers?

See our comprehensive security analysis: [LazyLotto-SECURITY_ANALYSIS.md](./LazyLotto-SECURITY_ANALYSIS.md)

**TL;DR**: Admins have operational control but **cannot harm users financially**. Your prizes and pool terms are protected by immutable smart contract logic.

---

## 🛠️ Technical Implementation

### Smart Contract Details

#### Gas Optimization
- **Batch operations** for efficient NFT handling
- **Automatic refilling** via LazyGasStation integration
- **Optimized storage patterns** to minimize gas costs
- **Library separation** to manage contract size limits

#### Token Standards
- **HTS integration** for native Hedera token operations
- **ERC20/ERC721 compatibility** for standard interfaces
- **Custom NFT collections** for tickets and prizes
- **Royalty support** for NFT collections

#### Random Number Generation
- **Hedera PRNG integration** for verifiable randomness
- **Multiple random requests** for different game mechanics
- **Nonce-based randomization** for unique outcomes
- **Deterministic testing support** via mock contracts

### Development Stack
- **Solidity 0.8.12+** for smart contract development
- **Hardhat** for development, testing, and deployment
- **OpenZeppelin** for security patterns and standards
- **Hedera SDK** for Hedera-specific operations

## 📊 System Statistics & Monitoring

### LazyLotto Analytics
Available via query scripts in `scripts/interactions/LazyLotto/queries/`:

- **Master Info** (`masterInfo.js`): Global contract state, all pools summary, configuration
- **Pool Info** (`poolInfo.js`): Pool-specific statistics (total entries, prizes awarded, boost rates)
- **User State** (`userState.js`): User-specific data (entries, pending prizes, win history)
- Prize distribution tracking across all pools
- Boost system effectiveness metrics

### LazyTradeLotto Analytics
Available via query scripts in `scripts/interactions/LazyTradeLotto/queries/`:

- **Lottery Info** (`getLottoInfo.js`): Complete contract state, jackpot size, configuration, win statistics
- **User Burn Rate** (`getUserBurn.js`): Check burn percentage for specific users (LSH NFT holder benefits)
- **Trade History** (`checkTradeHistory.js`): Verify if trade already rolled (anti-replay protection)
- **Event Logs** (`getLottoLogs.js`): Query lottery events from Hedera mirror node
- Trade volume and lottery participation rates
- Regular win vs. jackpot win statistics
- Progressive jackpot growth patterns

**See**: [Interaction Scripts Guide](./scripts/interactions/README.md) for complete script reference

## 🚀 Getting Started

### Prerequisites
- **Node.js 16+** and npm/yarn
- **Hedera account** (testnet or mainnet)
- **Environment variables** configured (see `.env.example`)

### Quick Start

1. **Clone and Install**
   ```bash
   git clone https://github.com/Burstall/hedera-SC-lazy-lotto.git
   cd hedera-SC-lazy-lotto
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Hedera credentials:
   # - ACCOUNT_ID (your Hedera account ID)
   # - PRIVATE_KEY (your private key)
   # - ENVIRONMENT (testnet/mainnet)
   # - Contract addresses and token IDs
   ```

3. **Compile Contracts**
   ```bash
   npx hardhat compile
   ```

4. **Run Tests**
   ```bash
   npm test
   ```

5. **Deploy Contracts** (optional - contracts may already be deployed)
   ```bash
   npx hardhat run scripts/deployments/deployLazyLotto.js --network testnet
   ```

6. **Use Interaction Scripts**
   ```bash
   # Query contract information
   node scripts/interactions/LazyLotto/queries/masterInfo.js 0.0.YOUR_CONTRACT_ID
   
   # See scripts/interactions/README.md for complete guide
   ```

### Environment Variables

Required variables in `.env` file:

```env
# Network Configuration
ENVIRONMENT=testnet              # testnet, mainnet, preview, or local
ACCOUNT_ID=0.0.xxxxx            # Your Hedera account ID
PRIVATE_KEY=302e...             # Your ED25519 private key (hex format)

# Contract Addresses (after deployment)
LAZY_LOTTO_CONTRACT_ID=0.0.xxxxx
LAZY_TRADE_LOTTO_CONTRACT_ID=0.0.xxxxx
LAZY_DELEGATE_REGISTRY_ID=0.0.xxxxx
LAZY_GAS_STATION_ID=0.0.xxxxx

# Token Configuration
LAZY_TOKEN_ID=0.0.xxxxx         # $LAZY token ID
LAZY_DECIMALS=1                  # $LAZY token decimals

# Optional: For testing signature-gated functions
SYSTEM_WALLET_KEY=...            # TestNet only - systemWallet private key
```

See `.env.example` for complete list of configuration options.

### Testing
```bash
# Run all tests with coverage
npm test

# Run specific test suites (npm scripts available)
npm run test-lotto              # LazyLotto test suite only
npm run test-trade-lotto        # LazyTradeLotto test suite only
npm run test-delegate           # LazyDelegateRegistry test suite only
npm run test-lazy               # LAZYTokenCreator test suite only

# Or run directly with Hardhat
npx hardhat test test/LazyLotto.test.js
npx hardhat test test/LazyTradeLotto.test.js
npx hardhat test test/LazyDelegateRegistry.test.js

# Run tests with gas reporting
REPORT_GAS=true npx hardhat test

# Generate coverage report
npx hardhat coverage
```

### Deployment
```bash
# Deploy contracts to testnet
npx hardhat run scripts/deployments/deployLazyLotto.js --network testnet
npx hardhat run scripts/deployments/deployLazyTradeLotto.js --network testnet

# Deploy to mainnet (requires mainnet credentials in .env)
npx hardhat run scripts/deployments/deployLazyLotto.js --network mainnet
npx hardhat run scripts/deployments/deployLazyTradeLotto.js --network mainnet

# Extract ABIs after deployment
node scripts/deployments/extractABI.js
```

### Using Interaction Scripts
```bash
# Query contract information (no gas cost)
node scripts/interactions/LazyLotto/queries/masterInfo.js 0.0.123456
node scripts/interactions/LazyTradeLotto/queries/getLottoInfo.js 0.0.789012

# Admin operations (requires owner private key in .env)
node scripts/interactions/LazyLotto/admin/createPool.js 0.0.123456 <params>
node scripts/interactions/LazyTradeLotto/admin/boostJackpot.js 0.0.789012 1000

# User operations (requires private key in .env)
node scripts/interactions/LazyLotto/user/buyEntry.js 0.0.123456 1 10
node scripts/interactions/LazyLotto/user/rollTickets.js 0.0.123456 1 5

# See interaction scripts README for complete usage guide
```

## 📚 Documentation

### Business & Design Documentation
- **[LazyLotto Business Logic](./LazyLotto-BUSINESS_LOGIC.md)** - Comprehensive overview of LazyLotto functionality, use cases, and game mechanics
- **[LazyTradeLotto Business Logic](./LazyTradeLotto-BUSINESS_LOGIC.md)** - Detailed explanation of the trade-based reward system and signature-gated design
- **[LazyLotto UX Implementation Guide](./LazyLotto-UX_IMPLEMENTATION_GUIDE.md)** - Complete user experience flows, CLI script usage, and integration patterns
- **[LazyLotto Production Readiness Summary](./LazyLotto-PRODUCTION_READINESS_SUMMARY.md)** - Production deployment checklist and system validation

### Testing & Quality Assurance
- **[LazyLotto Testing Plan](./LazyLotto-TESTING_PLAN.md)** - Systematic testing strategy, test case descriptions, and coverage requirements
- **[LazyLotto Code Coverage Analysis](./LazyLotto-CODE_COVERAGE_ANALYSIS.md)** - Detailed line-by-line coverage analysis and testing gaps
- **Test Suites** (`test/` folder):
  - `LazyLotto.test.js` - Comprehensive test suite for multi-pool lottery system
  - `LazyLottoPoolManager.test.js` - Community pool creation, ownership, fees, proceeds
  - `LazyTradeLotto.test.js` - Test suite for trade-based rewards with signature validation
  - `LazyDelegateRegistry.test.js` - NFT delegation and registry testing
  - `LAZYTokenCreator.test.js` - Token creation and management tests

### Script Documentation
- **[Interaction Scripts Guide](./scripts/interactions/README.md)** - Complete guide to all 41 CLI scripts organized by contract
  - **[LazyLotto Scripts](./scripts/interactions/LazyLotto/README.md)** - 22 scripts (admin, queries, user actions)
  - **[LazyLotto Scripts Status](./scripts/interactions/LazyLotto/SCRIPTS_COMPLETE.md)** - Detailed script inventory and completion tracking
  - **[LazyTradeLotto Scripts](./scripts/interactions/LazyTradeLotto/README.md)** - 12 scripts (admin, queries, testing)
  - **[Migration Report](./scripts/interactions/MIGRATION_COMPLETE.md)** - Script reorganization completion summary
- **[Deployment Scripts Guide](./scripts/deployments/README.md)** - Contract deployment and upgrade procedures

### Contract API Documentation
- **Inline NatSpec comments** for all public/external functions
- **Event definitions** with parameter explanations in source files
- **Custom errors** with detailed descriptions
- **Interface documentation** in `contracts/interfaces/`
- **Generated docs** available in `docs/` folder (HTML documentation)

## 🔧 Configuration

### LazyLotto Configuration
Managed via admin scripts in `scripts/interactions/LazyLotto/admin/`:

- **Pool Creation** (`createPool.js`): Win rates, entry fees, prize types, boost multipliers
- **Prize Management** (`addPrizePackage.js`, `removePrizes.js`): Add/remove prize packages
- **Bonus System** (`setBonuses.js`): Time bonuses, NFT bonuses, balance bonuses
- **Pool Lifecycle** (`pausePool.js`, `unpausePool.js`, `closePool.js`): State management
- **Admin Management** (`manageRoles.js`): Multi-admin setup with OWNER, MANAGER, OPERATIONAL roles
- **Token Withdrawal** (`withdrawTokens.js`): Emergency token recovery

**See**: [LazyLotto Scripts README](./scripts/interactions/LazyLotto/README.md) for detailed usage

### LazyTradeLotto Configuration
Managed via admin scripts in `scripts/interactions/LazyTradeLotto/admin/`:

- **Jackpot Management** (`boostJackpot.js`): Add funds to jackpot pool
- **Jackpot Settings** (`updateLottoJackpotIncrement.js`, `updateMaxJackpotThreshold.js`): Growth configuration
- **Burn Configuration** (`updateLottoBurnPercentage.js`): Set burn rate for non-NFT holders
- **System Security** (`updateLottoSystemWallet.js`): Change signature validation address
- **Contract Control** (`pauseLottoContract.js`, `unpauseLottoContract.js`): Emergency pause
- **Emergency Withdrawal** (`transferHbarFromLotto.js`): HBAR recovery

**See**: [LazyTradeLotto Scripts README](./scripts/interactions/LazyTradeLotto/README.md) for signature-gated design details

## 🌐 Network Compatibility

### Hedera Network Support
- **Testnet**: Full functionality for development and testing
- **Mainnet**: Production deployment ready
- **Local Node**: Development environment support

### Token Standards
- **HTS Tokens**: Native Hedera token support
- **HBAR**: Native currency integration
- **NFT Collections**: Custom and existing collections

## 🤝 Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following project conventions
4. Write/update tests for any new functionality
5. Ensure all tests pass (`npm test`)
6. Update documentation as needed
7. Commit your changes (`git commit -m 'Add amazing feature'`)
8. Push to the branch (`git push origin feature/amazing-feature`)
9. Open a Pull Request

### Development Guidelines
- **Code Style**: Follow existing patterns, use ESLint/Prettier configurations
- **Testing**: Add comprehensive tests for new features (aim for >80% coverage)
- **Documentation**: Update relevant markdown files and NatSpec comments
- **Gas Optimization**: Profile gas usage for new contract functions
- **Security**: Follow security best practices, use OpenZeppelin patterns

### Project Structure Conventions
- **Contracts**: Place in `contracts/` with clear naming
- **Tests**: Mirror contract structure in `test/` folder
- **Scripts**: Organize by contract in `scripts/interactions/<ContractName>/`
- **Utilities**: Shared helpers go in `utils/` folder
- **Documentation**: Business logic docs at root, technical docs near code

### Running Quality Checks
```bash
# Lint Solidity contracts
npx solhint 'contracts/**/*.sol'

# Lint JavaScript files
npx eslint scripts/ test/ utils/

# Check test coverage
npx hardhat coverage

# Generate gas report
REPORT_GAS=true npx hardhat test
```

## 📖 Quick Reference

### Essential Documentation
| Document | Purpose | Audience |
|----------|---------|----------|
| [README.md](./README.md) | Project overview and getting started | Everyone |
| [LazyLotto Business Logic](./LazyLotto-BUSINESS_LOGIC.md) | Game mechanics and use cases | Product/Business |
| [LazyLotto UX Guide](./LazyLotto-UX_IMPLEMENTATION_GUIDE.md) | Complete user flows and scripts | Developers/Integrators |
| [LazyTradeLotto Business Logic](./LazyTradeLotto-BUSINESS_LOGIC.md) | Trade lottery system design | Product/Business |
| [Testing Plan](./LazyLotto-TESTING_PLAN.md) | Test strategy and requirements | QA/Developers |
| [Production Readiness](./LazyLotto-PRODUCTION_READINESS_SUMMARY.md) | Deployment checklist | DevOps/Admin |

### Script Quick Links
| Category | Scripts | Documentation |
|----------|---------|---------------|
| **LazyLotto** | 22 scripts (admin/queries/user) | [LazyLotto Scripts](./scripts/interactions/LazyLotto/README.md) |
| **LazyTradeLotto** | 12 scripts (admin/queries) | [LazyTradeLotto Scripts](./scripts/interactions/LazyTradeLotto/README.md) |
| **Other Contracts** | 7 scripts (SecureTrade, Delegate, Gas) | [All Scripts Guide](./scripts/interactions/README.md) |
| **Deployment** | Contract deployment tools | [Deployment Guide](./scripts/deployments/README.md) |

### Test Coverage
| Contract | Test File | Lines Covered |
|----------|-----------|---------------|
| LazyLotto | `test/LazyLotto.test.js` | High coverage |
| LazyLottoPoolManager | `test/LazyLottoPoolManager.test.js` | Comprehensive |
| LazyTradeLotto | `test/LazyTradeLotto.test.js` | Comprehensive |
| LazyDelegateRegistry | `test/LazyDelegateRegistry.test.js` | Complete |
| LAZYTokenCreator | `test/LAZYTokenCreator.test.js` | Full |

**See**: [Code Coverage Analysis](./LazyLotto-CODE_COVERAGE_ANALYSIS.md) for detailed coverage report

### Key Commands Cheat Sheet
```bash
# Development
npm install                    # Install dependencies
npx hardhat compile           # Compile contracts
npm test                      # Run all tests
npx hardhat coverage          # Generate coverage report

# Deployment
npx hardhat run scripts/deployments/deployLazyLotto.js --network testnet
node scripts/deployments/extractABI.js

# Queries (no gas)
node scripts/interactions/LazyLotto/queries/masterInfo.js 0.0.CONTRACT_ID
node scripts/interactions/LazyTradeLotto/queries/getLottoInfo.js 0.0.CONTRACT_ID

# Admin Operations (requires owner key)
node scripts/interactions/LazyLotto/admin/createPool.js 0.0.CONTRACT_ID <params>
node scripts/interactions/LazyTradeLotto/admin/boostJackpot.js 0.0.CONTRACT_ID <amount>

# User Operations (requires private key)
node scripts/interactions/LazyLotto/user/buyEntry.js 0.0.CONTRACT_ID <poolId> <count>
node scripts/interactions/LazyLotto/user/rollTickets.js 0.0.CONTRACT_ID <poolId> <count>
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Hedera Network** for providing robust infrastructure and tools
- **OpenZeppelin** for security patterns and implementations
- **Lazy Superheroes Community** for use case validation and feedback

## 📞 Support

For questions, issues, or contributions:
- Open an issue on GitHub
- Contact the development team
- Join the community discussions

---

**Built with ❤️ for the Hedera ecosystem**