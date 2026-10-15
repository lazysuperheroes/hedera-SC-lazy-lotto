# LazyTradeLotto - Business Logic & Use Cases Documentation

## Overview

LazyTradeLotto is a decentralized reward system built on the Hedera network that incentivizes users to participate in the Lazy Secure Trade platform. It provides lottery-style rewards for both buyers and sellers in NFT trades, featuring regular prizes and a progressive jackpot system with burn reduction benefits for LSH NFT holders.

## Core Concepts

### 1. Trade-Based Lottery System
LazyTradeLotto operates as a reward mechanism for NFT trading activity:
- **Trade-Triggered Rolls**: Each completed trade generates lottery opportunities
- **Dual Participation**: Both buyer and seller can roll the lottery for each trade
- **One-Time Rolls**: Each participant (buyer/seller) can only roll once per trade
- **Signature-Secured Parameters**: All lottery parameters are validated by system signatures

### 2. Reward Structure
The system offers two types of rewards:
- **Regular Wins**: Variable prize amounts between minimum and maximum thresholds
- **Jackpot Wins**: Full jackpot pool payout with separate win conditions
- **Progressive Jackpot**: Grows with each roll that doesn't win the jackpot

### 3. NFT Holder Benefits
LSH (Lazy Superheroes) NFT holders receive preferential treatment:
- **Zero Burn Rate**: No burn percentage applied to winnings
- **Delegation Support**: Delegated NFT access also qualifies for benefits
- **Multiple Collections**: Gen1, Gen2, and Gen1 Mutant collections all qualify
- **Bonus win rates**: Ownership of Lazy Superheroes Ecosystem NFTs improve your odds of winning both the regular roll and the jackpot as well as increasing the regular roll prize pool per roll.

### 4. Anti-Replay Security
Sophisticated security prevents abuse and replay attacks:
- **Trade Fingerprinting**: Unique hash per trade/participant combination
- **History Tracking**: Permanent record of completed rolls
- **Signature Validation**: System wallet must sign all roll parameters

## Primary Use Cases

### 1. NFT Trade Reward Claiming

**User Story**: "As an NFT trader, I want to claim lottery rewards after completing a trade"

**Flow**:
1. User completes an NFT trade on Lazy Secure Trade platform
2. Platform generates signed lottery parameters for the trade
3. User calls `rollLotto()` with trade details and signature
4. Contract validates signature and trade uniqueness
5. Contract generates random numbers for regular and jackpot rolls
6. If won, prizes are automatically paid out via LazyGasStation
7. Jackpot pool is incremented for future draws

**Parameters Required**:
- `token`: NFT contract address from the trade
- `serial`: NFT token ID/serial number
- `nonce`: Unique trade identifier
- `buyer`: Boolean indicating if caller is buyer (true) or seller (false)
- `winRateThreshold`: Regular win probability (0-100,000,000)
- `minWinAmt` / `maxWinAmt`: Prize range for regular wins
- `jackpotThreshold`: Jackpot win probability (0-100,000,000)
- `teamSignature`: Platform signature validating parameters

### 2. Jackpot Management & Growth

**User Story**: "As a platform operator, I want to manage the jackpot pool to maintain excitement"

**Administrative Functions**:
- `boostJackpot(amount)`: Add funds to jackpot pool
- `updateJackpotLossIncrement(increment)`: Adjust growth rate per losing roll
- `updateMaxJackpotPool(maxThreshold)`: Set maximum jackpot size

**Automatic Growth**:
- Jackpot increases by `lottoLossIncrement` after each roll
- Caps at `maxJackpotPool` to prevent excessive accumulation
- Resets to 0 when won, then immediately increments

### 3. Platform Configuration Management

**User Story**: "As a platform administrator, I want to configure lottery parameters"

**Configuration Options**:
- **Burn Percentage**: Adjust burn rate for non-NFT holders
- **System Wallet**: Update signature validation address
- **Contract Pause**: Emergency stop for maintenance or issues

**Security Features**:
- All configuration functions are owner-only
- Pause functionality stops all lottery activity
- Parameter validation prevents invalid configurations

### 4. LSH NFT Holder Benefits

**User Story**: "As an LSH NFT holder, I want to receive benefits when winning lottery prizes"

**Benefit Mechanism**:
1. Contract checks user's NFT holdings across three collections:
   - LSH Gen1 (direct ownership)
   - LSH Gen2 (direct ownership)  
   - LSH Gen1 Mutant (direct ownership)
2. Contract also checks for delegated NFT access via LazyDelegateRegistry
3. If any NFTs are held or delegated, burn percentage = 0%
4. Non-holders receive full burn percentage on winnings

**Supported NFT Access Types**:
- Direct ownership via `IERC721.balanceOf()`
- Delegated access via `LazyDelegateRegistry.getSerialsDelegatedTo()`

## Advanced Features

### 1. Cryptographic Security

**Signature Validation Process**:
```solidity
// Message format for signature validation
bytes32 messageHash = keccak256(abi.encodePacked(
    address(this),   // v2: this contract
    block.chainid,   // v2: network
    msg.sender,      // Caller address
    token,           // NFT contract
    serial,          // NFT serial
    nonce,           // Trade nonce
    buyer,           // Buyer/seller flag
    winRateThreshold,// Regular win rate
    minWinAmt,       // Min prize
    maxWinAmt,       // Max prize (must be <= maxWinAmtCap)
    jackpotThreshold,// Jackpot win rate
    burnExempt,      // v2: 0% burn (LSH holder / valid delegate, resolved off-chain)
    deadline         // v2: signature expiry (unix seconds)
));
```

The system wallet must sign these parameters to prevent parameter manipulation and ensure only legitimate trades can trigger lottery rolls. In v2 the signature is bound to one contract on one network and expires at `deadline`; `getRollMessageHash(...)` returns this digest so the signer can verify its encoding. See [LazyTradeLotto-V2_SIGNER_GUIDE.md](./LazyTradeLotto-V2_SIGNER_GUIDE.md).

### 2. Random Number Generation

**Dual Randomness System**:
- **Regular Win Check**: Uses random number vs. `winRateThreshold`
- **Prize Amount**: Additional random number for prize value within range
- **Jackpot Check**: Separate random number vs. `jackpotThreshold`

**PRNG Integration**:
- Uses Hedera's PRNG system contract for verifiable randomness
- Requests array of random numbers for efficiency
- Includes nonce in random generation for uniqueness

### 3. Financial Management

**Prize Distribution**:
- Regular wins: Variable amount between min/max bounds
- Jackpot wins: Entire jackpot pool
- Burn application: Based on NFT holding status
- Automatic payout via LazyGasStation integration

**Jackpot Economics**:
- Grows consistently with each roll
- Maximum cap prevents excessive accumulation
- Immediate increment after win maintains excitement
- Owner can manually boost for promotions

### 4. Event Tracking & Analytics

**Comprehensive Event System**:
```solidity
event LottoRoll(
    address indexed _user,        // Winner address
    address indexed _token,       // NFT contract
    uint256 _serial,             // NFT serial
    uint256 _nonce,              // Trade nonce
    bool _buyer,                 // Buyer/seller flag
    uint256 _winRateThreshold,   // Win probability
    uint256 _winRoll,            // Actual roll result
    uint256 _minWinAmt,          // Min possible prize
    uint256 _maxWinAmt,          // Max possible prize
    uint256 _winAmount,          // Actual prize won
    uint256 _jackpotThreshold,   // Jackpot probability
    uint256 _jackpotRoll         // Jackpot roll result
);
```

**Statistics Tracking**:
- Total rolls, wins, and payouts
- Jackpot-specific statistics
- Real-time jackpot pool updates

## Integration Points

### 1. External Dependencies

**LazyGasStation**: Handles all $LAZY token payouts with burn application
**LazyDelegateRegistry**: Provides NFT delegation status for burn calculations
**PrngSystemContract**: Supplies verifiable random numbers for fair gameplay
**LSH NFT Contracts**: Three collections checked for holder benefits

### 2. Platform Integration

**Lazy Secure Trade Platform**:
- Generates trade nonces and parameters
- Signs lottery parameters with system wallet
- Provides UI for lottery roll claiming
- Tracks and displays lottery statistics

### 3. Security Integration

**Multi-Layer Security**:
- ReentrancyGuard prevents reentrancy attacks
- Pausable functionality for emergency stops
- Ownable pattern for administrative functions
- Signature validation prevents parameter manipulation

## Economic Model

### 1. Reward Distribution
- Regular prizes funded by platform operations
- Jackpot pool grows automatically with each roll
- NFT holders receive full winnings (0% burn)
- Non-holders support ecosystem through burn mechanism

### 2. Incentive Alignment
- Both buyers and sellers can benefit from trades
- Progressive jackpot creates excitement and anticipation
- NFT holding provides tangible ongoing benefits
- Trade volume drives lottery participation

### 3. Platform Sustainability
- Burn mechanism for non-NFT holders
- Configurable parameters allow economic tuning
- Owner controls for jackpot management
- Emergency pause for risk management

## User Interaction Patterns

### 1. Active Trader
- Completes multiple trades daily
- Claims lottery rewards regularly
- Benefits from cumulative jackpot growth
- May acquire LSH NFTs for burn reduction

### 2. LSH NFT Holder
- Enjoys 0% burn on all winnings
- May delegate NFTs to other users
- Receives full value from lottery wins
- Incentivized to maintain NFT holdings

### 3. Casual User
- Occasional trade participation
- Subject to burn percentage on wins
- Contributes to jackpot growth
- Potential to win large jackpots

### 4. Platform Operator
- Manages lottery parameters
- Monitors jackpot growth and wins
- Adjusts economic parameters as needed
- Ensures fair and secure operation

This trade-based lottery system creates a sustainable incentive mechanism that rewards trading activity while providing special benefits to NFT holders and maintaining platform sustainability through the burn mechanism.