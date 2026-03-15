# LazyTradeLotto - UX Implementation Guide for Frontend Developers

**Version:** 1.0
**Last Updated:** January 2026
**Contract:** LazyTradeLotto.sol
**Target Audience:** Frontend Developers, UX Designers, Integration Engineers

---

## Overview

LazyTradeLotto is a decentralized reward system that incentivizes NFT trading on the Lazy Secure Trade platform. Unlike LazyLotto (which is a traditional lottery), LazyTradeLotto is **trade-triggered** - users earn lottery rolls by completing NFT trades, with both buyers and sellers eligible for rewards.

### Key Differentiators from LazyLotto

| Aspect | LazyLotto | LazyTradeLotto |
|--------|-----------|----------------|
| **Trigger** | Buy tickets | Complete NFT trade |
| **Entry Cost** | HBAR/tokens | Free (trade required) |
| **Rolls Per User** | Unlimited (per pool) | Once per trade role |
| **Win Types** | Prize packages | Regular + Jackpot |
| **Payout** | Tokens/NFTs/HBAR | $LAZY tokens only |
| **Signature Required** | No | Yes (anti-gaming) |

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        LazySecureTrade Platform                          │
│                                                                          │
│  1. User completes NFT trade                                            │
│                    ↓                                                     │
│  2. Platform backend validates trade                                     │
│                    ↓                                                     │
│  3. Backend generates signed roll parameters                            │
│                    ↓                                                     │
│  4. Frontend calls rollLotto() with signature                           │
└─────────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                       LazyTradeLotto Contract                            │
│                                                                          │
│  1. Validates signature (systemWallet)                                   │
│  2. Checks replay protection (history mapping)                          │
│  3. Generates random numbers (PRNG)                                      │
│  4. Determines regular win + jackpot win                                │
│  5. Pays out via LazyGasStation                                         │
│  6. Updates statistics and jackpot pool                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         LazyGasStation                                   │
│                                                                          │
│  - Holds $LAZY token reserves                                           │
│  - Applies burn percentage (0% for NFT holders)                         │
│  - Transfers winnings to user                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### External Dependencies

| Contract | Purpose | Required For |
|----------|---------|--------------|
| LazySecureTrade | NFT trading platform | Trade execution |
| LazyGasStation | $LAZY payouts | Prize distribution |
| LazyDelegateRegistry | NFT delegation | Burn rate calculation |
| PrngSystemContract | Random numbers | Win determination |
| LSH NFT Collections | Holder benefits | 0% burn qualification |

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [User Flows](#user-flows)
3. [Data Fetching Patterns](#data-fetching-patterns)
4. [Display Components](#display-components)
5. [Transaction Workflows](#transaction-workflows)
6. [Error Handling](#error-handling)
7. [Real-Time Updates](#real-time-updates)
8. [LSH NFT Holder Benefits](#lsh-nft-holder-benefits)
9. [Admin Operations](#admin-operations)
10. [Multi-Signature Support](#multi-signature-support)
11. [Best Practices](#best-practices)

---

## Core Concepts

### Signature-Gated Security

**Why signatures are required:**

LazyTradeLotto uses a signature-based security model to prevent gaming. The platform's `systemWallet` must sign all roll parameters before execution:

```javascript
// Parameters included in signature
const messageHash = keccak256(abi.encodePacked(
    msg.sender,          // User address (prevents signature stealing)
    token,               // NFT contract address
    serial,              // NFT serial number
    nonce,               // Unique trade identifier
    buyer,               // true = buyer, false = seller
    winRateThreshold,    // Win probability (0-100,000,000)
    minWinAmt,           // Minimum prize
    maxWinAmt,           // Maximum prize
    jackpotThreshold     // Jackpot probability (0-100,000,000)
));
```

**This prevents:**
- Users generating their own favorable odds
- Replay attacks (same trade rolled multiple times)
- Parameter manipulation
- Rolls without legitimate trades

**Frontend implications:**
- You cannot call `rollLotto()` directly without platform backend
- Backend provides signature after trade validation
- Frontend receives pre-signed parameters to submit

### Dual Win System

Each roll has two independent chances to win:

1. **Regular Win** (variable odds)
   - Platform sets `winRateThreshold` per trade
   - Prize amount randomized between `minWinAmt` and `maxWinAmt`
   - Higher-value trades may get better odds

2. **Jackpot Win** (rare)
   - Separate `jackpotThreshold` check
   - Wins entire `jackpotPool`
   - Jackpot resets to 0, then increments

```javascript
// Win determination logic
const regularWin = (randomRoll <= winRateThreshold);
const jackpotWin = (jackpotRoll <= jackpotThreshold);

// Can win both, either, or neither
if (regularWin) payout += randomPrize(minWinAmt, maxWinAmt);
if (jackpotWin) payout += jackpotPool;
```

### Progressive Jackpot

The jackpot pool grows automatically:

```javascript
// After EVERY roll (win or lose)
jackpotPool += lottoLossIncrement;

// Capped at maximum
if (jackpotPool > maxJackpotPool) {
    jackpotPool = maxJackpotPool;
}
```

This creates:
- Constant growth (every roll increases it)
- Excitement as jackpot climbs
- Immediate refresh after wins (never truly 0)

### Burn Mechanism

Non-NFT holders have a percentage of winnings burned:

```
Gross Winnings: 1,000 $LAZY
Burn Rate: 10% (non-NFT holder)
Net Payout: 900 $LAZY

vs.

Gross Winnings: 1,000 $LAZY
Burn Rate: 0% (LSH NFT holder)
Net Payout: 1,000 $LAZY
```

---

## User Flows

### Flow 1: Complete Trade → Roll Lottery

```
┌──────────────────────────────────────────────────────────────────────┐
│ Step 1: User completes NFT trade on LazySecureTrade                  │
├──────────────────────────────────────────────────────────────────────┤
│ • Buyer: Purchases NFT with $LAZY/HBAR                               │
│ • Seller: Receives payment                                           │
│ • Platform: Records trade details (token, serial, nonce)             │
└──────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────┐
│ Step 2: Platform generates roll parameters                          │
├──────────────────────────────────────────────────────────────────────┤
│ • Calculate win rates based on trade value                           │
│ • Generate unique nonce                                              │
│ • Sign parameters with systemWallet                                  │
│ • Return signed package to frontend                                  │
└──────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────┐
│ Step 3: Frontend displays "Roll the Lotto" prompt                    │
├──────────────────────────────────────────────────────────────────────┤
│ • Show current jackpot amount                                        │
│ • Display user's potential win range                                 │
│ • Show NFT holder status (burn rate)                                 │
│ • "Roll Now" button                                                  │
└──────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────┐
│ Step 4: User clicks "Roll Now"                                       │
├──────────────────────────────────────────────────────────────────────┤
│ • Call rollLotto() with signed parameters                            │
│ • Show loading animation                                             │
│ • Wait for transaction confirmation                                  │
└──────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────┐
│ Step 5: Display results                                              │
├──────────────────────────────────────────────────────────────────────┤
│ • Parse LottoRoll event for win details                              │
│ • If JackpotWin event: Celebration animation!                        │
│ • Show net payout (after burn if applicable)                         │
│ • Update jackpot display                                             │
└──────────────────────────────────────────────────────────────────────┘
```

### Flow 2: Check Roll Eligibility

Before showing the roll option, verify the trade hasn't been rolled:

```javascript
async function canUserRoll(contractId, token, serial, nonce, isBuyer) {
    const hash = ethers.utils.keccak256(
        ethers.utils.solidityPack(
            ['address', 'uint256', 'uint256', 'bool'],
            [token, serial, nonce, isBuyer]
        )
    );

    const alreadyRolled = await contract.history(hash);
    return !alreadyRolled;
}

// Usage
const buyerCanRoll = await canUserRoll(contractId, token, serial, nonce, true);
const sellerCanRoll = await canUserRoll(contractId, token, serial, nonce, false);
```

### Flow 3: View Lottery Statistics

```javascript
async function displayLottoStats(contractId) {
    const stats = await contract.getLottoStats();

    return {
        jackpot: {
            current: formatLazy(stats._jackpotPool),
            maximum: formatLazy(stats._maxJackpotPool),
            percentFull: (stats._jackpotPool * 100n) / stats._maxJackpotPool
        },
        history: {
            totalRolls: stats._totalRolls.toString(),
            totalWins: stats._totalWins.toString(),
            winRate: calculateWinRate(stats._totalWins, stats._totalRolls),
            totalPaid: formatLazy(stats._totalPaid),
            jackpotsWon: stats._jackpotsWon.toString(),
            jackpotPaid: formatLazy(stats._jackpotPaid)
        },
        config: {
            incrementPerRoll: formatLazy(stats._lottoLossIncrement)
        }
    };
}
```

---

## Data Fetching Patterns

### Essential Contract Methods

**Read-Only (View) Methods:**

```solidity
// Statistics (single call for all stats)
getLottoStats() → (
    uint256 _jackpotPool,
    uint256 _jackpotsWon,
    uint256 _jackpotPaid,
    uint256 _totalRolls,
    uint256 _totalWins,
    uint256 _totalPaid,
    uint256 _lottoLossIncrement,
    uint256 _maxJackpotPool
)

// User-specific
getBurnForUser(address) → uint256  // 0 = NFT holder, else burn %

// Roll history (replay protection)
history(bytes32 hash) → bool  // true = already rolled

// Contract state
isPaused() → bool
systemWallet() → address
burnPercentage() → uint256

// Individual state variables
jackpotPool() → uint256
maxJackpotPool() → uint256
lottoLossIncrement() → uint256
totalRolls() → uint256
totalWins() → uint256
totalPaid() → uint256
jackpotsWon() → uint256
jackpotPaid() → uint256

// Constants
MAX_WIN_RATE_THRESHOLD() → uint256  // 100,000,000 (100%)
LSH_GEN1() → address
LSH_GEN2() → address
LSH_GEN1_MUTANT() → address
```

**State-Changing Methods:**

```solidity
// User function (requires signature)
rollLotto(
    address token,
    uint256 serial,
    uint256 nonce,
    bool buyer,
    uint256 winRateThreshold,
    uint256 minWinAmt,
    uint256 maxWinAmt,
    uint256 jackpotThreshold,
    bytes memory teamSignature
)

// Admin functions (owner only)
boostJackpot(uint256 amount)
updateJackpotLossIncrement(uint256 increment)
updateMaxJackpotPool(uint256 maxThreshold)
updateBurnPercentage(uint256 percentage)
updateSystemWallet(address newWallet)
pause()
unpause()
transferHbar(address payable receiverAddress, uint256 amount)
```

### Fetching Jackpot Information

```javascript
const { ethers } = require('ethers');

async function getJackpotDisplay(contract) {
    const stats = await contract.getLottoStats();

    const jackpotPool = stats._jackpotPool;
    const maxJackpotPool = stats._maxJackpotPool;
    const increment = stats._lottoLossIncrement;

    return {
        // Current jackpot in $LAZY (assuming 8 decimals)
        currentFormatted: formatLazyToken(jackpotPool),
        currentRaw: jackpotPool,

        // Maximum cap
        maxFormatted: formatLazyToken(maxJackpotPool),

        // Progress bar percentage
        percentFull: Number((jackpotPool * 10000n) / maxJackpotPool) / 100,

        // Growth rate
        incrementPerRoll: formatLazyToken(increment),

        // Is at cap?
        atMaximum: jackpotPool >= maxJackpotPool
    };
}

function formatLazyToken(amount, decimals = 1) {
    return ethers.utils.formatUnits(amount, decimals);
}
```

### Checking User's NFT Holder Status

```javascript
async function getUserBurnInfo(contract, userAddress) {
    const burnRate = await contract.getBurnForUser(userAddress);

    return {
        burnPercentage: Number(burnRate),
        isNftHolder: burnRate === 0n,
        netMultiplier: (100 - Number(burnRate)) / 100,

        // For display
        statusText: burnRate === 0n
            ? "LSH NFT Holder - 0% Burn"
            : `${burnRate}% of winnings burned`,
        statusColor: burnRate === 0n ? 'green' : 'orange'
    };
}

// Calculate net payout
function calculateNetPayout(grossAmount, burnPercentage) {
    const burnAmount = (grossAmount * BigInt(burnPercentage)) / 100n;
    return grossAmount - burnAmount;
}
```

### Verifying Roll Eligibility

```javascript
async function checkRollEligibility(contract, tradeDetails) {
    const { token, serial, nonce, userAddress, isBuyer } = tradeDetails;

    // Generate the hash that the contract uses
    const hash = ethers.utils.keccak256(
        ethers.utils.solidityPack(
            ['address', 'uint256', 'uint256', 'bool'],
            [token, serial, nonce, isBuyer]
        )
    );

    // Check history
    const alreadyRolled = await contract.history(hash);

    // Check contract status
    const isPaused = await contract.isPaused();

    return {
        canRoll: !alreadyRolled && !isPaused,
        alreadyRolled,
        contractPaused: isPaused,
        hash: hash,

        // User-friendly message
        message: alreadyRolled
            ? `You've already rolled for this trade as ${isBuyer ? 'buyer' : 'seller'}`
            : isPaused
                ? 'Lottery is currently paused'
                : 'Ready to roll!'
    };
}
```

---

## Display Components

### Jackpot Ticker Component

```jsx
function JackpotTicker({ contractAddress }) {
    const [jackpotData, setJackpotData] = useState(null);
    const [isAnimating, setIsAnimating] = useState(false);

    useEffect(() => {
        const fetchJackpot = async () => {
            const contract = getContract(contractAddress);
            const stats = await contract.getLottoStats();

            const newJackpot = {
                amount: formatLazy(stats._jackpotPool),
                rawAmount: stats._jackpotPool,
                percentFull: calculatePercent(stats._jackpotPool, stats._maxJackpotPool)
            };

            // Animate if jackpot increased
            if (jackpotData && newJackpot.rawAmount > jackpotData.rawAmount) {
                setIsAnimating(true);
                setTimeout(() => setIsAnimating(false), 1000);
            }

            setJackpotData(newJackpot);
        };

        fetchJackpot();
        const interval = setInterval(fetchJackpot, 10000); // Poll every 10s

        return () => clearInterval(interval);
    }, [contractAddress]);

    if (!jackpotData) return <LoadingSpinner />;

    return (
        <div className={`jackpot-ticker ${isAnimating ? 'pulse' : ''}`}>
            <div className="jackpot-label">Current Jackpot</div>
            <div className="jackpot-amount">
                <LazyIcon />
                <AnimatedNumber value={jackpotData.amount} />
            </div>
            <ProgressBar
                percent={jackpotData.percentFull}
                label={`${jackpotData.percentFull.toFixed(1)}% to max`}
            />
        </div>
    );
}
```

### Roll Button Component

```jsx
function RollButton({ tradeDetails, signedParams, onRollComplete }) {
    const [status, setStatus] = useState('idle'); // idle, checking, rolling, success, error
    const [result, setResult] = useState(null);

    const handleRoll = async () => {
        setStatus('rolling');

        try {
            const contract = getContract(signedParams.contractAddress);

            const tx = await contract.rollLotto(
                signedParams.token,
                signedParams.serial,
                signedParams.nonce,
                signedParams.buyer,
                signedParams.winRateThreshold,
                signedParams.minWinAmt,
                signedParams.maxWinAmt,
                signedParams.jackpotThreshold,
                signedParams.teamSignature,
                { gasLimit: 1_500_000 } // PRNG operations need buffer
            );

            const receipt = await tx.wait();

            // Parse events from receipt
            const rollResult = parseRollEvents(receipt, contract);

            setResult(rollResult);
            setStatus('success');
            onRollComplete(rollResult);

        } catch (error) {
            console.error('Roll failed:', error);
            setStatus('error');
            setResult({ error: parseError(error) });
        }
    };

    return (
        <div className="roll-container">
            {status === 'idle' && (
                <button
                    className="roll-button"
                    onClick={handleRoll}
                >
                    Roll the Lotto!
                </button>
            )}

            {status === 'rolling' && (
                <RollAnimation />
            )}

            {status === 'success' && result && (
                <RollResult result={result} />
            )}

            {status === 'error' && (
                <ErrorDisplay error={result.error} onRetry={() => setStatus('idle')} />
            )}
        </div>
    );
}
```

### Roll Result Component

```jsx
function RollResult({ result }) {
    const { regularWin, jackpotWin, netPayout, burnApplied } = result;

    // Determine result type
    const isJackpotWin = jackpotWin && jackpotWin.amount > 0;
    const isRegularWin = regularWin && regularWin.amount > 0;
    const isLoss = !isJackpotWin && !isRegularWin;

    return (
        <div className={`roll-result ${isJackpotWin ? 'jackpot' : isRegularWin ? 'winner' : 'loss'}`}>
            {isJackpotWin && (
                <div className="jackpot-celebration">
                    <Confetti />
                    <h1>JACKPOT!</h1>
                    <div className="jackpot-amount">
                        <LazyIcon /> {formatLazy(jackpotWin.amount)}
                    </div>
                </div>
            )}

            {isRegularWin && !isJackpotWin && (
                <div className="regular-win">
                    <h2>You Won!</h2>
                    <div className="win-amount">
                        <LazyIcon /> {formatLazy(regularWin.amount)}
                    </div>
                </div>
            )}

            {isLoss && (
                <div className="loss-result">
                    <h2>Better luck next trade!</h2>
                    <p>The jackpot just grew - try again!</p>
                </div>
            )}

            {burnApplied > 0 && (
                <div className="burn-notice">
                    <InfoIcon />
                    <span>{burnApplied}% burn applied ({formatLazy(result.burnAmount)} $LAZY)</span>
                    <Link to="/lsh-nfts">Get 0% burn with LSH NFTs</Link>
                </div>
            )}

            {(isRegularWin || isJackpotWin) && (
                <div className="net-payout">
                    <strong>Net Payout:</strong> {formatLazy(netPayout)} $LAZY
                </div>
            )}
        </div>
    );
}
```

### Statistics Dashboard

```jsx
function TradeLottoStats({ contractAddress }) {
    const [stats, setStats] = useState(null);

    useEffect(() => {
        async function fetchStats() {
            const contract = getContract(contractAddress);
            const lottoStats = await contract.getLottoStats();

            setStats({
                jackpot: {
                    current: formatLazy(lottoStats._jackpotPool),
                    max: formatLazy(lottoStats._maxJackpotPool),
                    percent: calculatePercent(lottoStats._jackpotPool, lottoStats._maxJackpotPool)
                },
                activity: {
                    totalRolls: lottoStats._totalRolls.toString(),
                    totalWins: lottoStats._totalWins.toString(),
                    winRate: calculateWinRate(lottoStats._totalWins, lottoStats._totalRolls),
                    totalPaid: formatLazy(lottoStats._totalPaid)
                },
                jackpotHistory: {
                    totalWon: lottoStats._jackpotsWon.toString(),
                    totalPaid: formatLazy(lottoStats._jackpotPaid),
                    averageJackpot: lottoStats._jackpotsWon > 0
                        ? formatLazy(lottoStats._jackpotPaid / lottoStats._jackpotsWon)
                        : '0'
                },
                config: {
                    growthPerRoll: formatLazy(lottoStats._lottoLossIncrement)
                }
            });
        }

        fetchStats();
    }, [contractAddress]);

    if (!stats) return <LoadingSpinner />;

    return (
        <div className="trade-lotto-stats">
            <StatsCard title="Current Jackpot">
                <JackpotDisplay
                    amount={stats.jackpot.current}
                    percent={stats.jackpot.percent}
                />
            </StatsCard>

            <StatsCard title="All-Time Activity">
                <StatRow label="Total Rolls" value={stats.activity.totalRolls} />
                <StatRow label="Total Wins" value={stats.activity.totalWins} />
                <StatRow label="Win Rate" value={`${stats.activity.winRate}%`} />
                <StatRow label="Total Paid" value={`${stats.activity.totalPaid} $LAZY`} />
            </StatsCard>

            <StatsCard title="Jackpot History">
                <StatRow label="Jackpots Won" value={stats.jackpotHistory.totalWon} />
                <StatRow label="Total Jackpot Paid" value={`${stats.jackpotHistory.totalPaid} $LAZY`} />
                <StatRow label="Average Jackpot" value={`${stats.jackpotHistory.averageJackpot} $LAZY`} />
            </StatsCard>

            <StatsCard title="Growth">
                <StatRow label="Per Roll Increment" value={`+${stats.config.growthPerRoll} $LAZY`} />
            </StatsCard>
        </div>
    );
}
```

---

## Transaction Workflows

### Backend Signature Generation

The platform backend must sign roll parameters. Here's the pattern:

```javascript
// BACKEND CODE - Platform server (NOT frontend)
const { ethers } = require('ethers');

async function generateRollSignature(tradeDetails, systemWalletPrivateKey) {
    const {
        userAddress,      // Who will call rollLotto
        token,           // NFT contract address
        serial,          // NFT serial number
        nonce,           // Unique trade ID
        isBuyer,         // true/false
        winRateThreshold,
        minWinAmt,
        maxWinAmt,
        jackpotThreshold
    } = tradeDetails;

    // Create message hash
    const messageHash = ethers.utils.solidityKeccak256(
        ['address', 'address', 'uint256', 'uint256', 'bool',
         'uint256', 'uint256', 'uint256', 'uint256'],
        [userAddress, token, serial, nonce, isBuyer,
         winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold]
    );

    // Sign with system wallet
    const wallet = new ethers.Wallet(systemWalletPrivateKey);
    const signature = await wallet.signMessage(ethers.utils.arrayify(messageHash));

    return {
        token,
        serial,
        nonce,
        buyer: isBuyer,
        winRateThreshold,
        minWinAmt,
        maxWinAmt,
        jackpotThreshold,
        teamSignature: signature
    };
}
```

### Frontend Roll Execution

```javascript
// FRONTEND CODE
async function executeRoll(signedParams, userSigner) {
    const contract = new ethers.Contract(
        TRADE_LOTTO_ADDRESS,
        TRADE_LOTTO_ABI,
        userSigner
    );

    // Gas estimation with buffer for PRNG
    const gasEstimate = await contract.estimateGas.rollLotto(
        signedParams.token,
        signedParams.serial,
        signedParams.nonce,
        signedParams.buyer,
        signedParams.winRateThreshold,
        signedParams.minWinAmt,
        signedParams.maxWinAmt,
        signedParams.jackpotThreshold,
        signedParams.teamSignature
    );

    // Execute with 1.5x gas buffer (PRNG uncertainty)
    const tx = await contract.rollLotto(
        signedParams.token,
        signedParams.serial,
        signedParams.nonce,
        signedParams.buyer,
        signedParams.winRateThreshold,
        signedParams.minWinAmt,
        signedParams.maxWinAmt,
        signedParams.jackpotThreshold,
        signedParams.teamSignature,
        { gasLimit: Math.ceil(Number(gasEstimate) * 1.5) }
    );

    const receipt = await tx.wait();
    return parseRollResult(receipt, contract);
}
```

### Parsing Roll Results

```javascript
function parseRollResult(receipt, contract) {
    const result = {
        transactionId: receipt.transactionHash,
        regularWin: null,
        jackpotWin: null,
        netPayout: 0n,
        burnApplied: 0,
        burnAmount: 0n
    };

    // Parse LottoRoll event
    for (const log of receipt.logs) {
        try {
            const parsed = contract.interface.parseLog(log);

            if (parsed.name === 'LottoRoll') {
                const {
                    _user, _token, _serial, _nonce, _buyer,
                    _winRateThreshold, _winRoll,
                    _minWinAmt, _maxWinAmt, _winAmount,
                    _jackpotThreshold, _jackpotRoll
                } = parsed.args;

                result.regularWin = {
                    won: _winAmount > 0,
                    amount: _winAmount,
                    roll: _winRoll,
                    threshold: _winRateThreshold,
                    wasWinningRoll: _winRoll <= _winRateThreshold
                };
            }

            if (parsed.name === 'JackpotWin') {
                const { _user, _jackpotThreshold, _jackpotRoll, _jackpotAmt } = parsed.args;

                result.jackpotWin = {
                    amount: _jackpotAmt,
                    roll: _jackpotRoll,
                    threshold: _jackpotThreshold
                };
            }
        } catch (e) {
            // Not a matching event, skip
        }
    }

    // Calculate net payout (need to fetch burn from LazyGasStation events if needed)
    const grossPayout = (result.regularWin?.amount || 0n) + (result.jackpotWin?.amount || 0n);
    result.netPayout = grossPayout; // LazyGasStation handles burn internally

    return result;
}
```

---

## Error Handling

### Contract Error Types

```javascript
const ERROR_HANDLERS = {
    'AlreadyRolled': {
        userMessage: 'You have already rolled for this trade.',
        action: 'Check your roll history',
        recoverable: false
    },
    'InvalidTeamSignature': {
        userMessage: 'Invalid signature. Please try again.',
        action: 'Contact support if this persists',
        recoverable: false
    },
    'BadArguments': {
        userMessage: (reason) => `Invalid parameters: ${reason}`,
        action: 'Check trade details',
        recoverable: false
    },
    'Pausable: paused': {
        userMessage: 'The lottery is currently paused for maintenance.',
        action: 'Try again later',
        recoverable: true
    },
    'INSUFFICIENT_GAS': {
        userMessage: 'Transaction ran out of gas.',
        action: 'Retry with higher gas limit',
        recoverable: true
    }
};

function parseContractError(error) {
    const errorString = error.message || error.toString();

    // Check for revert reasons
    for (const [errorName, handler] of Object.entries(ERROR_HANDLERS)) {
        if (errorString.includes(errorName)) {
            // Extract reason for BadArguments
            if (errorName === 'BadArguments') {
                const reasonMatch = errorString.match(/BadArguments\("([^"]+)"\)/);
                const reason = reasonMatch ? reasonMatch[1] : 'Unknown';
                return {
                    type: errorName,
                    message: handler.userMessage(reason),
                    action: handler.action,
                    recoverable: handler.recoverable
                };
            }

            return {
                type: errorName,
                message: handler.userMessage,
                action: handler.action,
                recoverable: handler.recoverable
            };
        }
    }

    // Unknown error
    return {
        type: 'UNKNOWN',
        message: 'An unexpected error occurred.',
        action: 'Please try again or contact support',
        recoverable: true,
        details: errorString
    };
}
```

### Error Display Component

```jsx
function ErrorDisplay({ error, onRetry, onDismiss }) {
    const parsedError = parseContractError(error);

    return (
        <div className={`error-display ${parsedError.recoverable ? 'warning' : 'error'}`}>
            <div className="error-icon">
                {parsedError.recoverable ? <WarningIcon /> : <ErrorIcon />}
            </div>

            <div className="error-content">
                <h3>{parsedError.type}</h3>
                <p>{parsedError.message}</p>
                <small>{parsedError.action}</small>
            </div>

            <div className="error-actions">
                {parsedError.recoverable && onRetry && (
                    <button onClick={onRetry}>Try Again</button>
                )}
                <button onClick={onDismiss}>Dismiss</button>
            </div>
        </div>
    );
}
```

### Complete Error Reference

All custom Solidity errors across the LazyLotto ecosystem with user-friendly messages:

#### LazyTradeLotto Errors

| Error | Parameters | User Message | Suggested Action |
|-------|------------|--------------|------------------|
| `AlreadyRolled` | none | "You've already rolled for this trade" | Show roll history |
| `InvalidTeamSignature` | none | "Invalid signature - please retry" | Refresh and retry; contact support if persists |
| `InvalidUserSignature` | none | "Invalid user signature" | Re-authenticate wallet |
| `BadArguments` | `message: string` | "Invalid parameters: {message}" | Check trade details |

#### LazyLotto Errors (for integrated dApps)

| Error | Parameters | User Message | Suggested Action |
|-------|------------|--------------|------------------|
| `LottoPoolNotFound` | `poolId` | "Pool #{poolId} does not exist" | Verify pool ID |
| `BalanceError` | `tokenAddress, balance, requestedAmount` | "Insufficient balance" | Show required vs available |
| `BadParameters` | none | "Invalid parameters provided" | Validate form inputs |
| `NotAdmin` | none | "Admin access required" | Show permission error |
| `NotAuthorized` | none | "You don't have permission" | Show permission error |
| `PoolManagerAlreadySet` | none | "Pool manager already configured" | Internal error - contact support |
| `FungibleTokenTransferFailed` | none | "Token transfer failed" | Check token association |
| `LastAdminError` | none | "Cannot remove last admin" | Add another admin first |
| `PoolIsClosed` | none | "This pool is closed" | Browse other pools |
| `PoolNotClosed` | none | "Pool must be closed first" | Close pool before this action |
| `NotEnoughHbar` | `needed, presented` | "Insufficient HBAR: need {needed}, have {presented}" | Show HBAR requirement |
| `NotEnoughFungible` | `needed, presented` | "Insufficient tokens: need {needed}, have {presented}" | Show token requirement |
| `NotEnoughTickets` | `poolId, requested, available` | "Not enough tickets: requested {requested}, available {available}" | Adjust ticket count |
| `NoTickets` | `poolId, user` | "You have no tickets in this pool" | Buy tickets first |
| `NoPendingPrizes` | none | "No prizes to claim" | Show empty state |
| `FailedNFTCreate` | none | "Failed to create NFT ticket" | Retry transaction |
| `FailedNFTMintAndSend` | none | "Failed to mint NFT ticket" | Retry transaction |
| `FailedNFTWipe` | none | "Failed to process NFT ticket" | Contact support |
| `PoolOnPause` | none | "This pool is paused" | Try again later |
| `EntriesOutstanding` | `outstanding, tokensOutstanding` | "Cannot close: {outstanding} entries still outstanding" | Wait for entries to be processed |
| `NoPrizesAvailable` | none | "No prizes available in this pool" | Browse other pools |
| `AlreadyWinningTicket` | none | "This ticket has already won" | Check prize claims |
| `FailedToInitialize` | none | "Contract initialization failed" | Internal error - contact support |

#### LazyLottoPoolManager Errors

| Error | Parameters | User Message | Suggested Action |
|-------|------------|--------------|------------------|
| `NotLazyLotto` | none | "Internal authorization error" | Contact support |
| `NotAuthorized` | none | "You don't have permission for this pool" | Check pool ownership |
| `BadParameters` | none | "Invalid parameters" | Check form inputs |
| `InvalidAddress` | none | "Invalid address provided" | Verify address format |
| `InsufficientHbarFee` | `required, provided` | "Pool creation fee: {required} HBAR required, {provided} provided" | Add more HBAR |
| `NothingToWithdraw` | none | "No funds available to withdraw" | Check pool balance |
| `CannotTransferGlobalPools` | none | "Global pools cannot be transferred" | Only community pools can be transferred |
| `CannotSetManagerForGlobalPools` | none | "Cannot set manager for global pools" | Only community pools support this |
| `CannotWithdrawFromGlobalPools` | none | "Global pool withdrawals not allowed" | Platform manages global pools |
| `LazyLottoAlreadySet` | none | "LazyLotto already configured" | Internal error - contact support |
| `TooManyTimeBonuses` | none | "Maximum time bonuses reached" | Remove existing bonuses first |
| `TooManyNFTBonuses` | none | "Maximum NFT bonuses reached" | Remove existing bonuses first |

#### Error Handling Best Practices

```javascript
// Comprehensive error handler with user-friendly messages
const ERROR_MESSAGES = {
    // LazyTradeLotto
    'AlreadyRolled': { message: "You've already rolled for this trade", recoverable: false },
    'InvalidTeamSignature': { message: 'Invalid signature - please retry', recoverable: true },
    'BadArguments': { message: 'Invalid parameters', recoverable: false },

    // LazyLotto
    'LottoPoolNotFound': { message: 'Pool not found', recoverable: false },
    'NotEnoughHbar': { message: 'Insufficient HBAR balance', recoverable: true },
    'NotEnoughFungible': { message: 'Insufficient token balance', recoverable: true },
    'PoolIsClosed': { message: 'This pool is closed', recoverable: false },
    'PoolOnPause': { message: 'Pool is temporarily paused', recoverable: true },
    'NoTickets': { message: 'You have no tickets in this pool', recoverable: false },
    'NoPendingPrizes': { message: 'No prizes available to claim', recoverable: false },

    // LazyLottoPoolManager
    'InsufficientHbarFee': { message: 'Insufficient pool creation fee', recoverable: true },
    'NotAuthorized': { message: 'Permission denied', recoverable: false },
};

function getErrorMessage(error) {
    const errorString = error.message || error.toString();

    for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
        if (errorString.includes(key)) {
            return value;
        }
    }

    return { message: 'An unexpected error occurred', recoverable: true };
}
```

---

## Real-Time Updates

### Event Listeners

```javascript
function setupEventListeners(contract, callbacks) {
    // Jackpot updates (after every roll)
    contract.on('JackpotUpdate', (amount) => {
        callbacks.onJackpotUpdate({
            newAmount: amount,
            formatted: formatLazy(amount)
        });
    });

    // Lottery rolls (all activity)
    contract.on('LottoRoll', (
        user, token, serial, nonce, buyer,
        winRateThreshold, winRoll,
        minWinAmt, maxWinAmt, winAmount,
        jackpotThreshold, jackpotRoll
    ) => {
        callbacks.onRoll({
            user,
            token,
            serial,
            nonce,
            isBuyer: buyer,
            regularWin: winAmount > 0n,
            winAmount: formatLazy(winAmount),
            winRoll: winRoll.toString(),
            threshold: winRateThreshold.toString()
        });
    });

    // Jackpot wins (major events!)
    contract.on('JackpotWin', (user, threshold, roll, amount) => {
        callbacks.onJackpotWin({
            winner: user,
            amount: formatLazy(amount),
            rawAmount: amount
        });
    });

    // Contract state changes
    contract.on('ContractUpdate', (functionName, sender, amount, message) => {
        callbacks.onContractUpdate({
            function: functionName,
            sender,
            amount,
            message
        });
    });

    // Return cleanup function
    return () => {
        contract.removeAllListeners();
    };
}

// Usage
useEffect(() => {
    const cleanup = setupEventListeners(contract, {
        onJackpotUpdate: (data) => setJackpot(data.newAmount),
        onRoll: (data) => addToActivityFeed(data),
        onJackpotWin: (data) => showJackpotCelebration(data),
        onContractUpdate: (data) => handleContractChange(data)
    });

    return cleanup;
}, [contract]);
```

### Activity Feed Component

```jsx
function ActivityFeed({ contractAddress, maxItems = 10 }) {
    const [activities, setActivities] = useState([]);

    useEffect(() => {
        const contract = getContract(contractAddress);

        const cleanup = setupEventListeners(contract, {
            onRoll: (data) => {
                setActivities(prev => [
                    {
                        id: `${data.nonce}-${data.isBuyer}`,
                        type: data.regularWin ? 'win' : 'roll',
                        user: shortenAddress(data.user),
                        amount: data.winAmount,
                        timestamp: Date.now()
                    },
                    ...prev.slice(0, maxItems - 1)
                ]);
            },
            onJackpotWin: (data) => {
                setActivities(prev => [
                    {
                        id: `jackpot-${Date.now()}`,
                        type: 'jackpot',
                        user: shortenAddress(data.winner),
                        amount: data.amount,
                        timestamp: Date.now()
                    },
                    ...prev.slice(0, maxItems - 1)
                ]);
            },
            onJackpotUpdate: () => {},
            onContractUpdate: () => {}
        });

        return cleanup;
    }, [contractAddress, maxItems]);

    return (
        <div className="activity-feed">
            <h3>Recent Activity</h3>
            {activities.map(activity => (
                <ActivityItem key={activity.id} {...activity} />
            ))}
        </div>
    );
}

function ActivityItem({ type, user, amount, timestamp }) {
    const icons = {
        roll: '🎲',
        win: '🎉',
        jackpot: '🏆'
    };

    const messages = {
        roll: `${user} rolled`,
        win: `${user} won ${amount} $LAZY`,
        jackpot: `${user} hit the JACKPOT! ${amount} $LAZY`
    };

    return (
        <div className={`activity-item ${type}`}>
            <span className="activity-icon">{icons[type]}</span>
            <span className="activity-message">{messages[type]}</span>
            <span className="activity-time">{formatTimeAgo(timestamp)}</span>
        </div>
    );
}
```

---

## LSH NFT Holder Benefits

### Benefit Overview

LSH (Lazy Superheroes) NFT holders receive preferential treatment:

| Benefit | Non-Holder | LSH Holder |
|---------|------------|------------|
| Burn Rate | Variable (e.g., 10%) | 0% |
| Net Payout | Reduced | Full amount |
| Delegation | N/A | Supported |

### Qualifying NFT Collections

```javascript
const LSH_COLLECTIONS = {
    GEN1: {
        name: 'Lazy Superheroes Gen1',
        contract: 'LSH_GEN1', // Address from contract
        delegatable: true
    },
    GEN2: {
        name: 'Lazy Superheroes Gen2',
        contract: 'LSH_GEN2',
        delegatable: true
    },
    GEN1_MUTANT: {
        name: 'Lazy Superheroes Gen1 Mutant',
        contract: 'LSH_GEN1_MUTANT',
        delegatable: true
    }
};
```

### Checking NFT Status

```javascript
async function checkNftHolderStatus(tradeLottoContract, userAddress) {
    // Get burn rate (0 = NFT holder)
    const burnRate = await tradeLottoContract.getBurnForUser(userAddress);

    if (burnRate === 0n) {
        return {
            isHolder: true,
            burnRate: 0,
            message: 'You have 0% burn as an LSH NFT holder!',
            holdings: await getHoldingDetails(tradeLottoContract, userAddress)
        };
    }

    return {
        isHolder: false,
        burnRate: Number(burnRate),
        message: `${burnRate}% of your winnings will be burned`,
        upgradePrompt: 'Get an LSH NFT to eliminate the burn!'
    };
}

async function getHoldingDetails(contract, userAddress) {
    const holdings = [];

    // Get collection addresses from contract
    const gen1Address = await contract.LSH_GEN1();
    const gen2Address = await contract.LSH_GEN2();
    const mutantAddress = await contract.LSH_GEN1_MUTANT();

    // Check each collection (direct ownership)
    const ierc721Abi = ['function balanceOf(address) view returns (uint256)'];

    for (const [name, address] of [
        ['Gen1', gen1Address],
        ['Gen2', gen2Address],
        ['Gen1 Mutant', mutantAddress]
    ]) {
        const nftContract = new ethers.Contract(address, ierc721Abi, provider);
        const balance = await nftContract.balanceOf(userAddress);
        if (balance > 0) {
            holdings.push({ collection: name, count: Number(balance), type: 'owned' });
        }
    }

    // Check delegations via LazyDelegateRegistry
    const delegateRegistry = await getDelegateRegistry(contract);
    for (const [name, address] of [
        ['Gen1', gen1Address],
        ['Gen2', gen2Address],
        ['Gen1 Mutant', mutantAddress]
    ]) {
        const delegated = await delegateRegistry.getSerialsDelegatedTo(userAddress, address);
        if (delegated.length > 0) {
            holdings.push({ collection: name, count: delegated.length, type: 'delegated' });
        }
    }

    return holdings;
}
```

### NFT Status Display Component

```jsx
function NftHolderBadge({ userAddress, contractAddress }) {
    const [status, setStatus] = useState(null);

    useEffect(() => {
        async function check() {
            const contract = getContract(contractAddress);
            const result = await checkNftHolderStatus(contract, userAddress);
            setStatus(result);
        }
        check();
    }, [userAddress, contractAddress]);

    if (!status) return <LoadingSkeleton />;

    if (status.isHolder) {
        return (
            <div className="nft-badge holder">
                <CheckCircle className="icon" />
                <div className="badge-content">
                    <strong>0% Burn Rate</strong>
                    <span>LSH NFT Holder</span>
                </div>
                {status.holdings && (
                    <div className="holdings-summary">
                        {status.holdings.map(h => (
                            <span key={h.collection}>
                                {h.count}x {h.collection} ({h.type})
                            </span>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="nft-badge non-holder">
            <AlertCircle className="icon" />
            <div className="badge-content">
                <strong>{status.burnRate}% Burn Rate</strong>
                <span>{status.message}</span>
            </div>
            <a href="/lsh-nfts" className="upgrade-link">
                Get LSH NFTs
            </a>
        </div>
    );
}
```

---

## Admin Operations

### Overview

LazyTradeLotto has a simpler admin model than LazyLotto:

| Role | Permissions |
|------|-------------|
| **Owner** | Full contract control |

There is no multi-admin or prize manager role - just a single owner.

### Admin Functions Reference

```javascript
// All admin functions - owner only
const ADMIN_FUNCTIONS = {
    // Jackpot Management
    boostJackpot: {
        signature: 'boostJackpot(uint256)',
        description: 'Add funds to jackpot pool',
        gasEstimate: 100_000
    },
    updateJackpotLossIncrement: {
        signature: 'updateJackpotLossIncrement(uint256)',
        description: 'Set per-roll jackpot increment',
        gasEstimate: 100_000
    },
    updateMaxJackpotPool: {
        signature: 'updateMaxJackpotPool(uint256)',
        description: 'Set maximum jackpot cap',
        gasEstimate: 100_000
    },

    // Configuration
    updateBurnPercentage: {
        signature: 'updateBurnPercentage(uint256)',
        description: 'Set burn rate for non-NFT holders (0-100)',
        gasEstimate: 100_000
    },
    updateSystemWallet: {
        signature: 'updateSystemWallet(address)',
        description: 'Change signature validation address',
        gasEstimate: 100_000
    },

    // Emergency Controls
    pause: {
        signature: 'pause()',
        description: 'Stop all lottery activity',
        gasEstimate: 100_000
    },
    unpause: {
        signature: 'unpause()',
        description: 'Resume lottery activity',
        gasEstimate: 100_000
    },

    // Fund Management
    transferHbar: {
        signature: 'transferHbar(address,uint256)',
        description: 'Withdraw HBAR from contract',
        gasEstimate: 150_000
    }
};
```

### Admin Dashboard Component

```jsx
function TradeLottoAdminDashboard({ contractAddress }) {
    const [config, setConfig] = useState(null);
    const [isOwner, setIsOwner] = useState(false);

    useEffect(() => {
        async function fetchConfig() {
            const contract = getContract(contractAddress);

            // Check ownership
            const owner = await contract.owner();
            setIsOwner(owner.toLowerCase() === userAddress.toLowerCase());

            // Fetch current config
            const stats = await contract.getLottoStats();
            const burnPct = await contract.burnPercentage();
            const systemWallet = await contract.systemWallet();
            const paused = await contract.isPaused();

            setConfig({
                jackpot: {
                    current: stats._jackpotPool,
                    max: stats._maxJackpotPool,
                    increment: stats._lottoLossIncrement
                },
                burnPercentage: burnPct,
                systemWallet: systemWallet,
                paused: paused,
                stats: {
                    totalRolls: stats._totalRolls,
                    totalWins: stats._totalWins,
                    totalPaid: stats._totalPaid,
                    jackpotsWon: stats._jackpotsWon,
                    jackpotPaid: stats._jackpotPaid
                }
            });
        }

        fetchConfig();
    }, [contractAddress]);

    if (!isOwner) {
        return <AccessDenied message="Only the contract owner can access this dashboard" />;
    }

    if (!config) return <LoadingSpinner />;

    return (
        <div className="admin-dashboard">
            <h1>LazyTradeLotto Admin</h1>

            {/* Contract Status */}
            <section className="status-section">
                <h2>Contract Status</h2>
                <StatusIndicator paused={config.paused} />
                <div className="action-buttons">
                    {config.paused ? (
                        <UnpauseButton contractAddress={contractAddress} />
                    ) : (
                        <PauseButton contractAddress={contractAddress} />
                    )}
                </div>
            </section>

            {/* Jackpot Management */}
            <section className="jackpot-section">
                <h2>Jackpot Management</h2>
                <div className="jackpot-stats">
                    <StatCard label="Current Jackpot" value={formatLazy(config.jackpot.current)} />
                    <StatCard label="Maximum Cap" value={formatLazy(config.jackpot.max)} />
                    <StatCard label="Per-Roll Increment" value={formatLazy(config.jackpot.increment)} />
                </div>
                <div className="jackpot-actions">
                    <BoostJackpotForm contractAddress={contractAddress} />
                    <UpdateIncrementForm
                        contractAddress={contractAddress}
                        currentValue={config.jackpot.increment}
                    />
                    <UpdateMaxPoolForm
                        contractAddress={contractAddress}
                        currentValue={config.jackpot.max}
                    />
                </div>
            </section>

            {/* Configuration */}
            <section className="config-section">
                <h2>Configuration</h2>
                <ConfigRow
                    label="Burn Percentage"
                    value={`${config.burnPercentage}%`}
                    action={<UpdateBurnForm contractAddress={contractAddress} current={config.burnPercentage} />}
                />
                <ConfigRow
                    label="System Wallet"
                    value={shortenAddress(config.systemWallet)}
                    action={<UpdateSystemWalletForm contractAddress={contractAddress} />}
                />
            </section>

            {/* Statistics */}
            <section className="stats-section">
                <h2>All-Time Statistics</h2>
                <div className="stats-grid">
                    <StatCard label="Total Rolls" value={config.stats.totalRolls.toString()} />
                    <StatCard label="Total Wins" value={config.stats.totalWins.toString()} />
                    <StatCard label="Total Paid" value={formatLazy(config.stats.totalPaid)} />
                    <StatCard label="Jackpots Won" value={config.stats.jackpotsWon.toString()} />
                    <StatCard label="Jackpot Paid" value={formatLazy(config.stats.jackpotPaid)} />
                </div>
            </section>

            {/* Fund Management */}
            <section className="funds-section">
                <h2>Fund Management</h2>
                <WithdrawHbarForm contractAddress={contractAddress} />
            </section>
        </div>
    );
}
```

### Admin Action Components

```jsx
function BoostJackpotForm({ contractAddress }) {
    const [amount, setAmount] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const contract = getContract(contractAddress, signer);
            const amountInUnits = parseUnits(amount, 8); // $LAZY decimals

            const tx = await contract.boostJackpot(amountInUnits);
            await tx.wait();

            toast.success(`Jackpot boosted by ${amount} $LAZY`);
            setAmount('');
        } catch (error) {
            toast.error(parseContractError(error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="admin-form">
            <h3>Boost Jackpot</h3>
            <div className="form-group">
                <label>Amount ($LAZY)</label>
                <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="1000"
                    min="0"
                />
            </div>
            <button type="submit" disabled={isSubmitting || !amount}>
                {isSubmitting ? 'Boosting...' : 'Boost Jackpot'}
            </button>
        </form>
    );
}

function PauseButton({ contractAddress }) {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handlePause = async () => {
        if (!confirm('Are you sure you want to pause the lottery?')) return;

        setIsSubmitting(true);
        try {
            const contract = getContract(contractAddress, signer);
            const tx = await contract.pause();
            await tx.wait();
            toast.success('Lottery paused');
            window.location.reload();
        } catch (error) {
            toast.error(parseContractError(error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <button
            onClick={handlePause}
            disabled={isSubmitting}
            className="pause-button danger"
        >
            {isSubmitting ? 'Pausing...' : 'Pause Lottery'}
        </button>
    );
}
```

---

## Multi-Signature Support

All admin scripts in `scripts/interactions/LazyTradeLotto/admin/` support multi-signature transactions.

### Quick Start

```bash
# Single-signature (default)
node admin/boostJackpot.js 0.0.123456 1000

# Multi-signature (2-of-3 threshold)
node admin/boostJackpot.js 0.0.123456 1000 --multisig --threshold=2

# View multi-sig help
node admin/boostJackpot.js --multisig-help
```

### Recommended Configurations

| Operation | Risk Level | Recommended Setup |
|-----------|-----------|-------------------|
| `transferHbar` | Critical | 2-of-3 offline |
| `updateSystemWallet` | Critical | 2-of-3 offline |
| `pause` / `unpause` | High | 2-of-2 interactive |
| `boostJackpot` | Medium | 2-of-3 interactive |
| `updateMaxJackpotPool` | Medium | 2-of-3 interactive |
| `updateBurnPercentage` | Medium | 2-of-3 interactive |

### Offline Workflow

For high-security operations:

```bash
# Phase 1: Freeze and export transaction
node admin/updateSystemWallet.js 0.0.123456 0.0.789012 --multisig --export-only

# Phase 2: Each signer signs offline
node lib/multiSig/cli/sign.js multisig-transactions/tx-file.tx

# Phase 3: Execute with collected signatures
node admin/updateSystemWallet.js 0.0.123456 0.0.789012 \
  --multisig --offline --signatures=sig1.json,sig2.json
```

### Documentation

For complete multi-sig documentation, see:
- `docs/MULTISIG_USER_GUIDE.md` - End-user workflows
- `docs/MULTISIG_DEVELOPER_GUIDE.md` - Architecture and integration
- `docs/MULTISIG_SECURITY.md` - Security model and best practices

---

## Best Practices

### Gas Estimation

```javascript
// Roll operations need buffer for PRNG
const ROLL_GAS_MULTIPLIER = 1.5;

async function estimateRollGas(contract, params) {
    const baseEstimate = await contract.estimateGas.rollLotto(
        params.token,
        params.serial,
        params.nonce,
        params.buyer,
        params.winRateThreshold,
        params.minWinAmt,
        params.maxWinAmt,
        params.jackpotThreshold,
        params.teamSignature
    );

    return Math.ceil(Number(baseEstimate) * ROLL_GAS_MULTIPLIER);
}
```

### Mirror Node Delay

```javascript
// Mirror nodes have ~4 second propagation delay
async function waitForMirrorUpdate() {
    await new Promise(resolve => setTimeout(resolve, 5000));
}

// Example: After roll, wait before querying updated jackpot
const tx = await contract.rollLotto(...params);
await tx.wait();
await waitForMirrorUpdate();
const newStats = await contract.getLottoStats();
```

### Error Recovery

```javascript
async function rollWithRetry(params, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await executeRoll(params);
        } catch (error) {
            const parsed = parseContractError(error);

            // Non-recoverable errors - don't retry
            if (!parsed.recoverable) {
                throw error;
            }

            // Last attempt
            if (attempt === maxRetries) {
                throw error;
            }

            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}
```

### Polling vs. Events

For real-time updates, prefer events when possible:

```javascript
// Event-based (preferred for real-time)
contract.on('JackpotUpdate', handleJackpotUpdate);

// Polling fallback (for initial load or when events unavailable)
const poll = async () => {
    const stats = await contract.getLottoStats();
    setJackpot(stats._jackpotPool);
};
setInterval(poll, 30000); // Every 30 seconds
```

### Security Considerations

1. **Never expose systemWallet key** - Backend only
2. **Validate signatures server-side** before providing to users
3. **Use HTTPS** for all API calls
4. **Implement rate limiting** on signature generation
5. **Log all admin operations** for audit trail

---

## CLI Scripts Reference

### Query Scripts

```bash
# Get complete lottery status
node scripts/interactions/LazyTradeLotto/queries/getLottoInfo.js 0.0.CONTRACT_ID

# Check user's burn rate
node scripts/interactions/LazyTradeLotto/queries/getUserBurn.js 0.0.CONTRACT_ID 0xUSER_ADDRESS

# Check if trade already rolled
node scripts/interactions/LazyTradeLotto/queries/checkTradeHistory.js 0.0.CONTRACT_ID 0xTOKEN SERIAL NONCE true|false

# Get lottery event logs
node scripts/interactions/LazyTradeLotto/queries/getLottoLogs.js 0.0.CONTRACT_ID
```

### Admin Scripts

```bash
# Jackpot management
node scripts/interactions/LazyTradeLotto/admin/boostJackpot.js 0.0.CONTRACT_ID AMOUNT
node scripts/interactions/LazyTradeLotto/admin/updateLottoJackpotIncrement.js 0.0.CONTRACT_ID INCREMENT
node scripts/interactions/LazyTradeLotto/admin/updateMaxJackpotThreshold.js 0.0.CONTRACT_ID MAX_AMOUNT

# Configuration
node scripts/interactions/LazyTradeLotto/admin/updateLottoBurnPercentage.js 0.0.CONTRACT_ID PERCENTAGE
node scripts/interactions/LazyTradeLotto/admin/updateLottoSystemWallet.js 0.0.CONTRACT_ID 0xNEW_WALLET

# Emergency controls
node scripts/interactions/LazyTradeLotto/admin/pauseLottoContract.js 0.0.CONTRACT_ID
node scripts/interactions/LazyTradeLotto/admin/unpauseLottoContract.js 0.0.CONTRACT_ID

# Fund management
node scripts/interactions/LazyTradeLotto/admin/transferHbarFromLotto.js 0.0.CONTRACT_ID 0xRECEIVER AMOUNT
```

---

## Related Documentation

- **Business Logic**: `LazyTradeLotto-BUSINESS_LOGIC.md`
- **Contract Source**: `contracts/LazyTradeLotto.sol`
- **Scripts Documentation**: `scripts/interactions/LazyTradeLotto/README.md`
- **Multi-Sig System**: `docs/MULTISIG_USER_GUIDE.md`
- **LazyLotto UX Guide**: `LazyLotto-UX_IMPLEMENTATION_GUIDE.md`

---

*This guide is designed for frontend developers building applications that integrate with the LazyTradeLotto smart contract.*

*Last updated: January 2026*
