# LazyLotto MCP Integration Design

> **Status**: Draft v0.1 — Research & Design Phase
> **Date**: 2026-03-27
> **Scope**: Three-part design for enabling AI agents to discover, query, and play LazyLotto

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Part 1: Contract Integration for Agents](#3-part-1-contract-integration-for-agents)
4. [Part 2: dApp MCP Endpoint](#4-part-2-dapp-mcp-endpoint)
5. [Part 3: Autonomous Agent Project](#5-part-3-autonomous-agent-project)
6. [HOL Registry Integration](#6-hol-registry-integration)
7. [Security Model](#7-security-model)
8. [Implementation Roadmap](#8-implementation-roadmap)
9. [Open Questions](#9-open-questions)

---

## 1. Executive Summary

LazyLotto is a multi-pool lottery system deployed on Hedera. This document designs three complementary components that enable AI agents (Claude, custom agents, HOL-registered agents) to interact with the lottery:

| Component | Project | Purpose |
|-----------|---------|---------|
| **Part 1** | This repo (reference) | Contract integration guide — what an agent needs to know |
| **Part 2** | Main dApp (Next.js) | `/api/mcp` endpoint — agents query and play via MCP protocol |
| **Part 3** | New standalone project | Autonomous agent — runs with its own funded Hedera wallet |

**Key design decisions:**
- **MCP transport**: Streamable HTTP (spec 2025-03-26), not deprecated SSE — deployable on Vercel serverless
- **Read operations**: Fully available to any MCP client, no wallet required
- **Write operations**: Require a funded Hedera wallet — either the dApp user's wallet (Part 2) or the agent's own wallet (Part 3)
- **HOL registration**: LazyLotto registers as a discoverable service in the HOL Registry via HCS-11

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Clients                            │
│  Claude Desktop / Claude Code / Cursor / Custom Agents      │
└─────────────┬───────────────────────────┬───────────────────┘
              │ Streamable HTTP           │ Streamable HTTP
              │ (POST /api/mcp)           │ (POST /api/mcp)
              ▼                           ▼
┌─────────────────────┐    ┌──────────────────────────────────┐
│   Part 2: dApp      │    │   Part 3: Autonomous Agent       │
│   MCP Endpoint      │    │   (standalone project)           │
│                     │    │                                  │
│  Vercel serverless  │    │  - Own Hedera wallet             │
│  Next.js API route  │    │  - Funded by user                │
│                     │    │  - Signs transactions directly   │
│  Read: mirror node  │    │  - Plays lottery autonomously    │
│  Write: user wallet │    │  - HOL-registered agent          │
│    (WalletConnect   │    │                                  │
│     or session key) │    │  Can also BE an MCP client       │
└────────┬────────────┘    │  that calls Part 2's endpoint    │
         │                 └──────────┬───────────────────────┘
         │                            │
         ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Hedera Network                           │
│                                                             │
│  LazyLotto ──► LazyLottoStorage    Mirror Node (queries)    │
│  LazyLottoPoolManager              PRNG Precompile (0x169)  │
│  LazyGasStation                    HTS Precompile (0x167)   │
│  $LAZY Token                                                │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    HOL Registry                             │
│                                                             │
│  HCS-11 Agent Profile  ──  LazyLotto service registration   │
│  HCS-10 OpenConvAI     ──  Agent-to-agent communication     │
│  Registry Broker       ──  Discovery & search               │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Part 1: Contract Integration for Agents

> This section distills the existing UX Integration Guide into what an agent specifically needs. The full UX guide remains the canonical reference for frontend developers.

### 3.1 Contract Topology

An agent interacting with LazyLotto needs to know about **four contracts** and **two tokens**:

| Contract | Role | Agent Needs |
|----------|------|-------------|
| **LazyLotto** | Core game logic | Buy entries, roll, claim prizes, query pools |
| **LazyLottoStorage** | Token custody & HTS ops | Token/NFT approval target (NOT LazyLotto) |
| **LazyLottoPoolManager** | Pool metadata & bonuses | Query pool ownership, proceeds, boost calc |
| **LazyGasStation** | $LAZY burn handler | $LAZY approval target |
| **$LAZY Token** | Fungible token (1 decimal) | Entry fees for LAZY pools, bonus threshold |
| **Pool NFT Collections** | Per-pool ticket tokens | Redeemed entry tickets (tradeable) |

**Critical approval routing** (the #1 integration pitfall):
```
$LAZY approvals       → LazyGasStation address
All other FT/NFT      → LazyLottoStorage address
HBAR                  → No approval needed (sent as msg.value)
```

### 3.2 Read Operations (No Wallet Required)

These are the operations any MCP client can perform without a wallet. They map directly to MCP **tools** in Part 2.

#### Discovery & Pool Browsing

| Operation | Contract Call | Returns |
|-----------|-------------|---------|
| Count pools | `LazyLotto.totalPools()` | `uint256` |
| Pool details | `LazyLotto.getPoolBasicInfo(poolId)` | Tuple: CIDs, win rate, entry fee, prize count, outstanding entries, token ID, paused, closed, fee token |
| List global pools | `PoolManager.getGlobalPools(offset, limit)` | `uint256[]` pool IDs |
| List community pools | `PoolManager.getCommunityPools(offset, limit)` | `uint256[]` pool IDs |
| Pool owner | `PoolManager.getPoolOwner(poolId)` | `address` (0x0 = global) |
| Prize package | `LazyLotto.getPrizePackage(poolId, index)` | Token, amount, NFT addresses + serials |
| Platform fee | `PoolManager.getPoolPlatformFeePercentage(poolId)` | `uint256` (locked at creation) |

#### User State

| Operation | Contract Call | Returns |
|-----------|-------------|---------|
| Memory entries | `LazyLotto.getUsersEntries(poolId, user)` | `uint256` count |
| Entries across pools | `LazyLotto.getUserEntriesPage(user, startPool, count)` | `uint256[]` |
| Pending prizes count | `LazyLotto.getPendingPrizesCount(user)` | `uint256` |
| Pending prizes | `LazyLotto.getPendingPrizesPage(user, start, count)` | `PendingPrize[]` |
| Win rate boost | `PoolManager.calculateBoost(user)` | `uint32` basis points |

#### System Info

| Operation | Contract Call | Returns |
|-----------|-------------|---------|
| Storage address | `LazyLotto.storageContract()` | `address` — for approvals |
| Gas station | `LazyLotto.lazyGasStation()` | `address` — for $LAZY approvals |
| Pool manager | `LazyLotto.poolManager()` | `address` |
| LAZY token | `LazyLotto.lazyToken()` | `address` |
| Is admin | `LazyLotto.isAdmin(addr)` | `bool` |

#### Win Rate Formatting

All win rates are in **thousandths of basis points**:
```
100,000,000 = 100%
 10,000,000 = 10%
  1,000,000 = 1%
```
Formula: `winRate / 1,000,000 = percentage`

### 3.3 Write Operations (Wallet Required)

These require a funded Hedera account with proper token associations and approvals.

#### Prerequisites (one-time per user/agent)

1. **Token association**: Agent account must associate with:
   - $LAZY token (if playing LAZY pools)
   - Pool ticket NFT collections (for each pool they play)
   - Any prize tokens they might win

2. **Approvals**:
   - $LAZY → `LazyGasStation` address (for LAZY pool entries)
   - Other FTs → `LazyLottoStorage` address
   - NFTs → `LazyLottoStorage` via `setApprovalForAll`

3. **Funding**:
   - HBAR for gas fees (~0.05-0.5 HBAR per operation)
   - HBAR for entry fees (HBAR-denominated pools)
   - $LAZY for LAZY pool entries

#### Gameplay Operations

| Operation | Function | Payment | Gas Notes |
|-----------|----------|---------|-----------|
| Buy entries | `buyEntry(poolId, count)` | HBAR/token per entry | Standard gas |
| Buy + roll | `buyAndRollEntry(poolId, count)` | HBAR/token per entry | **1.5x gas multiplier** |
| Roll all | `rollAll(poolId)` | None (gas only) | **1.5x gas multiplier** |
| Roll batch | `rollBatch(poolId, count)` | None (gas only) | **1.5x gas multiplier** |
| Claim prize | `claimPrize(index)` | None (gas only) | Standard gas |
| Claim all | `claimAllPrizes()` | None (gas only) | Standard gas |
| Transfer prize | `transferPendingPrizes(recipient, index)` | None (gas only) | Standard gas |
| Transfer all prizes | `transferPendingPrizes(recipient, type(uint256).max)` | None (gas only) | Standard gas |
| Redeem to NFT | `buyAndRedeemEntry(poolId, count)` | HBAR/token per entry | Standard gas |
| Roll NFT tickets | `rollWithNFT(poolId, serials)` | None (gas only) | **1.5x gas multiplier** |

**Gas multiplier explanation**: Roll operations involve PRNG + potential prize selection. Base estimate assumes no wins; actual execution may trigger secondary PRNG + prize array operations. Always estimate gas then multiply by 1.5.

**Prize transfer**: `transferPendingPrizes` reassigns prizes in storage only — no token transfers occur, no token associations required. The recipient sees the prizes in their pending array and claims via the standard flow when ready. Pass `type(uint256).max` as the index to transfer all prizes at once, or a specific index for a single prize. This is the primary mechanism for agents to forward winnings to their owner's wallet.

#### Community Pool Operations

| Operation | Function | Payment |
|-----------|----------|---------|
| Create pool | `createPool(name, symbol, memo, royalties, ticketCID, winCID, winRate, entryFee, feeToken)` | HBAR creation fee + $LAZY fee |
| Pause pool | `pausePool(poolId)` | Gas only (owner/admin) |
| Close pool | `closePool(poolId)` | Gas only (requires 0 outstanding entries) |
| Withdraw proceeds | `withdrawPoolProceeds(poolId, token)` | Gas only (owner) |
| Add prizes | `addPrizePackage(poolId, token, amount, nftTokens, nftSerials)` | Prize value + gas |

### 3.4 Mirror Node Queries

For off-chain data not available via contract calls, agents can query the Hedera Mirror Node REST API:

```
Testnet:  https://testnet.mirrornode.hedera.com/api/v1/
Mainnet:  https://mainnet.mirrornode.hedera.com/api/v1/

Useful endpoints:
  /accounts/{accountId}/tokens         — Token balances and associations
  /accounts/{accountId}/nfts           — NFT holdings with serials
  /tokens/{tokenId}                    — Token metadata
  /tokens/{tokenId}/nfts/{serial}      — Specific NFT info
  /contracts/{contractId}              — Contract info
  /contracts/results/{transactionId}   — Contract call results + events
```

**Propagation delay**: Mirror node updates lag ~4 seconds behind consensus. After a write operation, wait before querying mirror node for confirmation.

### 3.5 Agent Decision Framework

An agent playing the lottery needs to make informed decisions. Here's what matters:

```
Pool Selection Criteria:
├── Win rate (higher = more frequent wins, but smaller prizes)
├── Entry fee (affordability relative to agent's balance)
├── Prize pool quality (inspect prize packages)
├── Outstanding entries (popularity indicator)
├── Fee token (HBAR vs $LAZY — different cost profiles)
└── Boost eligibility (does agent hold LSH NFTs or $LAZY?)

Optimal Play Strategy:
├── Check boost: calculateBoost(agentAddress)
├── Compare: effective win rate = base rate + boost
├── Calculate: expected value per entry
│   ├── Sum all prize values × (1 / prizeCount)
│   ├── Multiply by effective win rate
│   └── Subtract entry fee
├── If EV positive: play
├── If EV negative but entertainment value: play with budget cap
└── After rolling: transfer prizes to owner wallet (see below)

Prize Handling (agent):
├── transferPendingPrizes(ownerEOA, type(uint256).max) — forwards all wins
├── No token associations needed (transfer is in-memory only)
├── Owner claims from website at their convenience
└── Or agent claims directly if it has associations set up

Budget Management:
├── Set max spend per session
├── Track cumulative entries and wins
├── Stop when budget exhausted
└── Factor in gas costs (~0.05-0.5 HBAR per operation)
```

---

## 4. Part 2: dApp MCP Endpoint

> This section designs the `/api/mcp` route for the main LazyLotto Next.js dApp, deployed on Vercel.

### 4.1 Transport: Streamable HTTP

Using the **MCP protocol version 2025-03-26** Streamable HTTP transport — the latest spec, replacing deprecated SSE.

**Why Streamable HTTP:**
- Single `/api/mcp` endpoint handles all communication (POST + GET)
- Works natively with Vercel serverless functions
- Stateless mode = no session persistence needed between function invocations
- 290-300 req/s at high concurrency (vs 1.5s response time with old SSE)
- Backwards compatible with clients that expect SSE streams

**Vercel deployment stack:**
```
Framework:    Next.js (App Router)
Package:      mcp-handler (Vercel's official MCP adapter)
SDK:          @modelcontextprotocol/sdk >= 1.26.0
Validation:   zod (schema validation for tool inputs)
Transport:    Streamable HTTP (stateless mode)
Auth:         Bearer token (API key) for write operations
```

### 4.2 Endpoint Structure

```
/api/mcp                    — MCP endpoint (POST + GET + DELETE)
/.well-known/               — OAuth metadata (if needed later)
```

**Route file**: `app/api/mcp/route.ts`

```typescript
// Conceptual structure — not final implementation code
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

const handler = createMcpHandler(
  (server) => {
    // Register all tools (see 4.3)
    registerReadTools(server);
    registerWriteTools(server);
    registerResourceTools(server);
  },
  {
    name: 'lazylotto-mcp',
    version: '1.0.0',
  },
  { basePath: '/api' }
);

export { handler as GET, handler as POST, handler as DELETE };
```

### 4.3 MCP Tools Design

Tools are organized into three tiers based on authentication requirements:

#### Tier 1: Public Read Tools (No Auth)

These tools query on-chain state and mirror node data. Any MCP client can call them.

```yaml
lazylotto_list_pools:
  description: "List all available lottery pools with basic info"
  inputs:
    type: enum [all, global, community]  (default: all)
    offset: number  (default: 0)
    limit: number   (default: 20, max: 50)
  returns: Array of pool summaries (id, name, win rate %, entry fee,
           fee token symbol, prize count, outstanding entries, paused, closed)

lazylotto_get_pool:
  description: "Get detailed info about a specific lottery pool"
  inputs:
    poolId: number (required)
  returns: Full pool info including ticket CID, win CID, win rate,
           entry fee, fee token, prize count, platform fee %, owner,
           paused/closed status

lazylotto_get_prizes:
  description: "List prize packages available in a pool"
  inputs:
    poolId: number (required)
    offset: number (default: 0)
    limit: number  (default: 20, max: 50)
  returns: Array of prize packages (HBAR amounts, token amounts
           with symbols, NFT collections with serial counts)

lazylotto_get_user_state:
  description: "Get a user's lottery state — entries, pending prizes, boost"
  inputs:
    address: string (required, Hedera account ID or EVM address)
  returns: Per-pool entry counts, pending prize count and details,
           current win rate boost (basis points), boost breakdown

lazylotto_calculate_ev:
  description: "Calculate expected value for playing a pool"
  inputs:
    poolId: number (required)
    address: string (optional — includes boost in calculation)
  returns: Entry cost, effective win rate, average prize value,
           expected value per entry, recommendation

lazylotto_get_system_info:
  description: "Get LazyLotto system configuration and contract addresses"
  inputs: none
  returns: Contract addresses (LazyLotto, Storage, PoolManager,
           GasStation), LAZY token address, network, total pools
```

#### Tier 2: Authenticated Read Tools (API Key)

These tools access user-specific data that should be gated.

```yaml
lazylotto_get_my_entries:
  description: "Get the authenticated user's entries across all pools"
  auth: Bearer token (API key tied to Hedera account)
  inputs:
    startPool: number (default: 0)
    count: number (default: 50)
  returns: Array of (poolId, memoryEntries, nftTicketSerials)

lazylotto_get_my_prizes:
  description: "Get the authenticated user's pending prizes"
  auth: Bearer token
  inputs:
    offset: number (default: 0)
    limit: number (default: 20)
  returns: Array of pending prizes with full package details
```

#### Tier 3: Write Tools (Wallet Signing Required)

These tools execute on-chain transactions. They require the dApp to have access to a signing mechanism.

**Design challenge**: MCP runs server-side on Vercel. The user's wallet is client-side (WalletConnect, HashPack, etc.). We need a bridge.

**Proposed approach — Transaction Intent Pattern:**

Rather than the MCP server signing transactions directly, it **constructs transaction intents** that the client-side wallet can sign:

```yaml
lazylotto_buy_entries:
  description: "Buy lottery entries for a pool"
  auth: Bearer token + wallet session
  inputs:
    poolId: number (required)
    count: number (required, 1-100)
    action: enum [buy, buy_and_roll, buy_and_redeem] (default: buy)
  returns:
    IF autonomous agent (has signing key):
      Execute transaction, return receipt (txId, won/lost counts)
    IF dApp user (no server-side key):
      Return transaction intent:
        - contractId, functionName, params, gas, payableAmount
        - Encoded transaction bytes for WalletConnect signing
        - Human-readable summary for approval UI

lazylotto_roll:
  description: "Roll entries in a pool"
  auth: Bearer token + wallet session
  inputs:
    poolId: number (required)
    count: number (optional — omit for rollAll)
  returns: Transaction intent OR executed receipt

lazylotto_claim_prizes:
  description: "Claim pending prizes"
  auth: Bearer token + wallet session
  inputs:
    indices: number[] (optional — omit for claimAll)
  returns: Transaction intent OR executed receipt

lazylotto_transfer_prizes:
  description: "Transfer pending prizes to another wallet (in-memory, no token movement)"
  auth: Bearer token + wallet session
  inputs:
    recipient: string (required — Hedera account ID or EVM address)
    index: number (optional — omit to transfer all)
  returns: Transaction intent
  notes: >
    Uses transferPendingPrizes(recipient, index). Pass type(uint256).max
    for index to transfer all. No token associations needed on either side.
    Primary use case: agent forwarding winnings to owner EOA. Also useful
    for gifting prizes between users.
```

**Transaction Intent format** (returned when server can't sign):
```json
{
  "type": "transaction_intent",
  "chain": "hedera:testnet",
  "intent": {
    "contractId": "0.0.XXXXXX",
    "function": "buyEntry(uint256,uint256)",
    "params": { "poolId": 0, "count": 5 },
    "gas": 300000,
    "payableAmount": "50000000000",
    "payableToken": "HBAR"
  },
  "encoded": "0x...",
  "humanReadable": "Buy 5 entries in Lucky Dip pool for 50 HBAR total",
  "prerequisites": [
    {
      "type": "token_association",
      "token": "0.0.XXXXXX",
      "symbol": "LAZY-LOTTO-0",
      "reason": "Pool ticket NFT collection"
    }
  ],
  "warnings": []
}
```

This pattern works for both:
- **dApp frontend**: Receives intent, presents to user, signs via WalletConnect/HashPack
- **Autonomous agent**: Receives intent, signs directly with its private key, submits

### 4.4 MCP Resources

MCP Resources expose read-only data that clients can subscribe to or browse:

```yaml
resources:
  lazylotto://pools:
    description: "List of all lottery pools"
    mimeType: application/json

  lazylotto://pools/{poolId}:
    description: "Detailed pool information"
    mimeType: application/json

  lazylotto://pools/{poolId}/prizes:
    description: "Prize packages for a pool"
    mimeType: application/json

  lazylotto://system:
    description: "System configuration and addresses"
    mimeType: application/json

  lazylotto://user/{address}/state:
    description: "User's lottery state"
    mimeType: application/json
```

### 4.5 MCP Prompts

Pre-built prompt templates for common agent workflows:

```yaml
prompts:
  explore_pools:
    description: "Guide the user through discovering and evaluating pools"
    arguments:
      budget:
        description: "Max amount to spend (e.g., '100 HBAR' or '500 LAZY')"
        required: false

  play_pool:
    description: "Walk through buying entries and rolling in a specific pool"
    arguments:
      poolId:
        description: "Pool to play"
        required: true
      strategy:
        description: "Play style: conservative, balanced, aggressive"
        required: false

  claim_prizes:
    description: "Check and claim all pending prizes"
    arguments: none

  analyze_pools:
    description: "Analyze all pools and recommend the best one to play"
    arguments:
      risk_tolerance:
        description: "low (frequent small wins), medium, high (rare big wins)"
        required: false
```

### 4.6 Server-Side Implementation Notes

**Data source for reads**: Use Hedera Mirror Node REST API (not JSON-RPC contract calls) for most read operations. Mirror node is:
- Free (no gas costs)
- Fast (REST API, no consensus needed)
- Cacheable (Vercel edge caching)

For contract state that mirror node doesn't index (e.g., `calculateBoost()`), fall back to JSON-RPC calls via a Hedera JSON-RPC relay.

**Caching strategy**:
```
Pool list:           Cache 60s (pools rarely created)
Pool basic info:     Cache 30s (entries change frequently)
Prize packages:      Cache 60s (prizes change on admin action)
System info:         Cache 300s (contract addresses don't change)
User state:          No cache (must be real-time)
Boost calculation:   Cache 10s (depends on NFT holdings)
```

**Environment variables** (Vercel):
```env
HEDERA_NETWORK=testnet                     # or mainnet
HEDERA_MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com
HEDERA_JSON_RPC_URL=https://testnet.hashio.io/api
LAZYLOTTO_CONTRACT_ID=0.0.XXXXXX
LAZYLOTTO_STORAGE_ID=0.0.XXXXXX
LAZYLOTTO_POOL_MANAGER_ID=0.0.XXXXXX
LAZY_GAS_STATION_ID=0.0.XXXXXX
LAZY_TOKEN_ID=0.0.XXXXXX
MCP_API_KEY_SALT=...                       # For API key hashing
```

### 4.7 Client Configuration

**Claude Desktop / Claude Code / Cursor**:
```json
{
  "mcpServers": {
    "lazylotto": {
      "url": "https://lazylotto.app/api/mcp"
    }
  }
}
```

**With authentication** (for write operations):
```json
{
  "mcpServers": {
    "lazylotto": {
      "url": "https://lazylotto.app/api/mcp",
      "headers": {
        "Authorization": "Bearer ll_api_key_xxxxx"
      }
    }
  }
}
```

---

## 5. Part 3: Autonomous Agent Project

> A standalone project that runs an AI agent with its own Hedera wallet, capable of playing LazyLotto autonomously.

### 5.1 Concept

The user:
1. Creates a Hedera account for the agent (or the agent creates one)
2. Funds it with HBAR and/or $LAZY
3. Configures play strategy (which pools, budget, frequency)
4. Agent plays autonomously, claiming prizes and reporting results

### 5.2 Project Structure

```
lazylotto-agent/
├── package.json
├── .env.example
├── src/
│   ├── index.ts                 # Entry point
│   ├── agent/
│   │   ├── LottoAgent.ts        # Core agent logic
│   │   ├── StrategyEngine.ts    # Pool evaluation and play decisions
│   │   ├── BudgetManager.ts     # Spend tracking and limits
│   │   └── ReportGenerator.ts   # Session summaries
│   ├── hedera/
│   │   ├── wallet.ts            # Hedera SDK client + signing
│   │   ├── contracts.ts         # Contract interaction wrappers
│   │   ├── mirror.ts            # Mirror node queries
│   │   └── tokens.ts            # Association + approval helpers
│   ├── mcp/
│   │   ├── client.ts            # MCP client (connects to Part 2)
│   │   └── server.ts            # MCP server (exposes agent as service)
│   └── config/
│       ├── strategy.ts          # Strategy configuration types
│       └── defaults.ts          # Default play parameters
├── strategies/
│   ├── conservative.json        # Low risk, frequent plays
│   ├── balanced.json            # Medium risk
│   └── aggressive.json          # High risk, big prizes
└── tests/
    ├── strategy.test.ts
    ├── budget.test.ts
    └── integration.test.ts
```

### 5.3 Agent Modes

#### Mode A: Direct Contract Interaction

Agent holds a private key and interacts with Hedera contracts directly via the Hedera SDK.

```
User funds agent wallet → Agent associates tokens → Agent plays
```

**Pros**: No dependency on dApp, lowest latency, full autonomy
**Cons**: Requires private key management, agent must handle all Hedera specifics

#### Mode B: MCP Client to dApp

Agent connects to the Part 2 MCP endpoint as a client, using the transaction intent pattern.

```
Agent calls MCP tools → Receives transaction intents → Signs locally → Submits
```

**Pros**: Simpler agent code, benefits from dApp's caching/formatting
**Cons**: Depends on dApp availability, additional network hop

#### Mode C: Hybrid (Recommended)

- **Reads**: Via MCP client to dApp endpoint (benefits from caching, formatting)
- **Writes**: Direct contract interaction via Hedera SDK (no dependency for transactions)

```typescript
// Pseudocode for hybrid agent
class LottoAgent {
  private mcpClient: McpClient;     // For reads via dApp
  private hederaClient: HederaClient; // For writes directly

  async evaluateAndPlay() {
    // Read via MCP (cached, formatted)
    const pools = await this.mcpClient.callTool('lazylotto_list_pools', {
      type: 'all'
    });

    // Evaluate pools using strategy engine
    const bestPool = this.strategy.selectPool(pools, this.budget);

    if (!bestPool) {
      this.report('No pool meets criteria. Skipping.');
      return;
    }

    // Write directly via Hedera SDK (no dApp dependency)
    const receipt = await this.contracts.buyAndRoll(
      bestPool.id,
      this.strategy.entryCount(bestPool, this.budget)
    );

    // Transfer any winnings to owner wallet (in-memory, no token transfers)
    const pendingPrizes = await this.mcpClient.callTool(
      'lazylotto_get_user_state',
      { address: this.accountId }
    );

    if (pendingPrizes.pendingCount > 0) {
      // Reassign all prizes to owner — they claim from the website
      await this.contracts.transferPendingPrizes(
        this.ownerEOA,
        ethers.MaxUint256  // type(uint256).max = transfer all
      );
    }

    this.budget.recordSpend(receipt);
    this.report(receipt);
  }
}
```

### 5.4 Wallet Setup Flow

```
1. Agent startup
   ├── Load .env (HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY, OWNER_EOA)
   ├── Initialize Hedera SDK client
   └── Verify account exists and has balance

2. First-run setup
   ├── Check token associations (agent wallet)
   │   ├── $LAZY token (for LAZY pool entries + balance bonus)
   │   └── Pool ticket NFTs (for target pools)
   │   NOTE: Agent does NOT need prize token associations —
   │         prizes are transferred in-memory to owner EOA
   ├── Auto-associate missing tokens
   ├── Set approvals
   │   ├── $LAZY → LazyGasStation
   │   └── (Other FTs → LazyLottoStorage if needed)
   ├── Owner delegates NFTs to agent (for win rate bonuses)
   │   └── Owner calls: delegateNFT(agentWallet, lshToken, serials)
   └── Save setup state to local config

3. Per-session
   ├── Check HBAR balance ≥ minimum (configurable)
   ├── Check $LAZY balance if playing LAZY pools
   ├── Run strategy evaluation
   ├── Execute plays within budget
   └── Transfer all winnings to owner EOA via transferPendingPrizes
```

### 5.4.1 Agent Wallet Fund Management

The agent wallet holds HBAR and potentially $LAZY. The owner needs mechanisms to:
- **Fund the agent**: Standard HBAR/LAZY transfer to the agent account
- **Recover funds**: Withdraw HBAR/$LAZY from the agent back to the owner
- **Recover prizes**: Not needed — prizes are transferred in-memory before claiming

**Funding the agent:**
```
Owner sends HBAR/LAZY to agent account via standard Hedera transfer.
The agent project provides a CLI command: npm run fund -- --amount 100 --token HBAR
```

**Recovering funds from the agent:**
```
The agent project provides a CLI command: npm run withdraw -- --amount 50 --token HBAR --to 0.0.OWNER
This uses the agent's private key to sign a standard TransferTransaction.
```

**Why prize recovery isn't needed:**
The agent calls `transferPendingPrizes(ownerEOA, type(uint256).max)` after each session.
This moves prizes in the contract's storage from `pending[agent]` to `pending[owner]`.
No tokens move on-chain — the owner claims via the normal website flow when ready.
The owner never needs to interact with the agent wallet to get prizes.

**Bonus delegation (owner → agent):**
The owner's LSH NFTs can boost the agent's win rate via the existing delegate registry.
The owner calls `delegateNFT(agentWallet, lshToken, serials)` once — the agent's
`calculateBoost()` automatically picks up the delegated NFTs. The owner retains
custody of the NFTs; only the bonus authority is delegated.

The $LAZY balance bonus requires the agent to hold $LAZY directly (fungible balances
can't be delegated). Fund the agent with enough $LAZY to meet the threshold, and it
will earn both the LAZY balance bonus and any NFT delegation bonuses.

### 5.4.2 Prize Transfer — General User Feature

While designed for the agent use case, `transferPendingPrizes` is a general-purpose
function available to any user. Use cases beyond agents:

- **Gift prizes**: Transfer a winning prize to a friend's wallet
- **Multi-wallet consolidation**: Collect prizes from alt wallets to a main account
- **Guild/team play**: A team lead distributes prizes to members
- **Marketplace preparation**: Transfer prizes to a selling wallet

The function is deliberately simple — it reassigns ownership in the contract's
pending prizes array. No tokens move, no associations required, minimal gas cost.
The recipient claims through the standard website flow whenever they choose.

This could be surfaced in the dApp as a "Send Prize" button alongside "Claim" and
"Redeem to NFT" in the pending prizes UI. Not required for launch but a natural
extension once agents drive adoption of the feature.

### 5.5 Strategy Configuration

```json
{
  "name": "balanced",
  "description": "Medium risk, plays multiple pools",
  "budget": {
    "maxPerSession": "50 HBAR",
    "maxPerPool": "20 HBAR",
    "reserveBalance": "10 HBAR",
    "maxLazyPerSession": "300 LAZY"
  },
  "poolSelection": {
    "minWinRate": 0.05,
    "maxEntryFee": "20 HBAR",
    "preferredFeeTokens": ["HBAR", "LAZY"],
    "excludePools": [],
    "preferGlobalPools": true
  },
  "playStyle": {
    "entriesPerPool": 5,
    "rollImmediately": true,
    "transferPrizesToOwner": true,
    "redeemToNFT": false
  },
  "schedule": {
    "frequency": "daily",
    "maxPlaysPerDay": 3,
    "timeWindow": { "after": "09:00", "before": "21:00" }
  },
  "reporting": {
    "summaryAfterEachPlay": true,
    "dailySummary": true,
    "notifyOnWin": true,
    "notifyOnBudgetExhausted": true
  }
}
```

### 5.6 Agent as MCP Server

The autonomous agent can also expose itself as an MCP server, allowing Claude or other AI to control it:

```yaml
# Tools the agent exposes as an MCP server
lazylotto_agent_play:
  description: "Tell the agent to evaluate pools and play"
  inputs:
    budget: string (optional override)
    poolId: number (optional — specific pool)

lazylotto_agent_status:
  description: "Get agent's current status, balance, and session history"

lazylotto_agent_claim:
  description: "Tell agent to claim all pending prizes"

lazylotto_agent_set_strategy:
  description: "Update the agent's play strategy"
  inputs:
    strategy: string (conservative, balanced, aggressive, or JSON)

lazylotto_agent_stop:
  description: "Stop the agent's current session"
```

### 5.7 Technology Stack

```
Runtime:          Node.js 20+ (TypeScript)
Hedera SDK:       @hashgraph/sdk
MCP Client:       @modelcontextprotocol/sdk (connecting to Part 2)
MCP Server:       @modelcontextprotocol/sdk + mcp-handler (exposing agent)
Contract ABI:     @lazysuperheroes/lazy-lotto (NPM package)
HOL Integration:  @hashgraphonline/standards-sdk
Scheduling:       node-cron (for periodic play)
Config:           dotenv + JSON strategy files
```

---

## 6. HOL Registry Integration

### 6.1 Why Register with HOL

HOL (Hedera Open Ledger) is a decentralized registry for AI agents on Hedera. Registering LazyLotto:
- Makes it **discoverable** by any HOL-connected agent
- Enables **agent-to-agent communication** via HCS-10
- Provides **standardized authentication** via ledger challenge-response
- Positions LazyLotto in the Hedera AI ecosystem

### 6.2 HCS-11 Agent Profile

LazyLotto registers as a **service agent** in HOL:

```json
{
  "type": "agent",
  "name": "LazyLotto",
  "alias": "lazylotto",
  "bio": "Multi-pool lottery on Hedera. Buy entries, roll for prizes including HBAR, tokens, and NFTs.",
  "capabilities": [
    "lottery",
    "gaming",
    "nft",
    "hbar",
    "prizes",
    "mcp-server"
  ],
  "endpoints": [
    {
      "type": "mcp",
      "url": "https://lazylotto.app/api/mcp",
      "transport": "streamable-http"
    }
  ],
  "networks": ["hedera:mainnet", "hedera:testnet"],
  "model": null,
  "agentType": "autonomous",
  "standards": ["HCS-10", "HCS-11", "MCP-2025-03-26"]
}
```

### 6.3 Registration Workflow

```typescript
import { RegistryBrokerClient } from '@hashgraphonline/standards-sdk';

const client = new RegistryBrokerClient({
  apiKey: process.env.REGISTRY_BROKER_API_KEY,
});

// 1. Get registration quote
const quote = await client.tools.getRegistrationQuote({
  name: 'LazyLotto',
  capabilities: ['lottery', 'gaming', 'mcp-server'],
});

// 2. Register
const registration = await client.tools.registerAgent({
  name: 'LazyLotto',
  description: 'Multi-pool lottery on Hedera',
  capabilities: ['lottery', 'gaming', 'nft', 'hbar', 'mcp-server'],
  endpoints: ['https://lazylotto.app/api/mcp'],
});

// 3. Wait for confirmation
await client.tools.waitForRegistrationCompletion({
  registrationId: registration.id,
});
```

### 6.4 Discovery by Other Agents

Once registered, other agents find LazyLotto via:

```typescript
// Another agent searching for lottery services
const results = await hol.search({
  query: 'lottery hedera prizes',
  capabilities: ['lottery', 'mcp-server'],
  limit: 5,
});

// Or semantic search
const similar = await hol.vectorSearch({
  query: 'play a game and win HBAR prizes',
  limit: 5,
});
```

### 6.5 Agent-to-Agent Communication (HCS-10)

For agents that want to interact via HCS messaging rather than MCP:

```
Inbound Topic:   Agent sends play commands to LazyLotto's inbound topic
Outbound Topic:  LazyLotto publishes results to its outbound topic
Connection:      Private channel between two agents for a session
```

This is a future extension — MCP is the primary integration path.

---

## 7. Security Model

### 7.1 Read Operations

- **No authentication required** for public pool data
- Rate limiting via Vercel's built-in DDoS protection
- Mirror node queries are free and public
- Cache prevents excessive JSON-RPC relay usage

### 7.2 Write Operations — dApp (Part 2)

**Transaction Intent pattern** means the MCP server never holds private keys:

```
Agent requests action → Server builds intent → Agent signs locally → Agent submits
```

The server only needs to know the user's public address to build the intent. No private key exposure.

**API key authentication** gates who can request transaction intents:
- Keys tied to Hedera account IDs
- Rate limited per key
- Scoped permissions (read-only vs read-write)

### 7.3 Write Operations — Autonomous Agent (Part 3)

**Private key management**:
- Agent holds its own key in `.env` (not shared with any server)
- Key never leaves the agent's process
- Agent signs transactions locally via Hedera SDK
- **Recommendation**: Use a dedicated agent account with limited funding
- **Never** use the main project treasury account as the agent wallet

**Budget enforcement**:
- Strategy config sets hard spend limits
- Agent tracks cumulative spend locally
- Reserve balance prevents draining account completely
- Daily/session caps prevent runaway spending

### 7.4 HOL Authentication

For agents discovering LazyLotto via HOL:
- Ledger challenge-response verifies agent owns its claimed Hedera account
- Challenge includes timestamp (prevents replay)
- Signed with agent's private key
- LazyLotto can verify before allowing write operations

### 7.5 Attack Vectors & Mitigations

| Vector | Risk | Mitigation |
|--------|------|------------|
| MCP tool abuse (spam reads) | Low | Vercel rate limiting, cache |
| Fake transaction intents | Low | Intent is unsigned — client verifies before signing |
| Agent wallet drain | Medium | Budget limits, reserve balance, limited funding |
| API key compromise | Medium | Key rotation, per-key rate limits, scoped permissions |
| DNS rebinding | Low | Origin header validation (MCP spec requirement) |
| Replay attacks | Low | Hedera transaction IDs include timestamp + nonce |

---

## 8. Implementation Roadmap

### Phase 0: Contract Update (This Repo)

**Effort**: Complete
**Status**: `transferPendingPrizes` added to LazyLotto.sol

Deliverables:
- [x] `transferPendingPrizes(address, uint256)` function
- [x] `PrizeTransferred` event
- [x] Compiles at 23.987 KB (optimizer runs lowered 200→75)
- [ ] Test coverage for prize transfer
- [ ] Redeploy to testnet with updated contract

**Note**: Optimizer runs changed from 200 to 75 to accommodate the new function. This trades marginally higher runtime gas for smaller deployment size. The difference is negligible for Hedera's gas model.

### Phase 1: Read-Only MCP Endpoint (Part 2, Minimal)

**Effort**: ~2-3 days in dApp project
**Dependencies**: Phase 0 (redeployed contract for transfer tool, but reads work on current deployment)

Deliverables:
- [ ] `/api/mcp/route.ts` with Streamable HTTP transport
- [ ] Tier 1 read tools (list_pools, get_pool, get_prizes, get_user_state, get_system_info)
- [ ] Mirror node query layer with caching
- [ ] MCP Resources for pool data
- [ ] Client configuration docs

**Why start here**: Immediately useful for any Claude/Cursor user. Zero wallet complexity. Proves the MCP integration pattern.

### Phase 2: Transaction Intents (Part 2, Full)

**Effort**: ~3-5 days in dApp project
**Dependencies**: Phase 1

Deliverables:
- [ ] API key authentication (`withMcpAuth`)
- [ ] Tier 3 write tools with transaction intent pattern (buy, roll, claim, transfer)
- [ ] Prerequisite checker (associations, approvals, balances)
- [ ] MCP Prompts for guided workflows
- [ ] `calculate_ev` tool for informed decisions

### Phase 3: HOL Registration

**Effort**: ~1-2 days
**Dependencies**: Phase 1 (endpoint must be live)

Deliverables:
- [ ] HCS-11 agent profile for LazyLotto
- [ ] Registration script using Standards SDK
- [ ] Verification setup (DNS or signature method)
- [ ] Test discovery from another HOL agent

### Phase 4: Autonomous Agent (Part 3)

**Effort**: ~5-8 days (new project)
**Dependencies**: Phase 1 (for reads), deployed contracts (for writes)

Deliverables:
- [ ] New `lazylotto-agent` project repository
- [ ] Wallet setup and token association automation
- [ ] NFT delegation setup (owner delegates LSH NFTs to agent for bonuses)
- [ ] Strategy engine with configurable play styles
- [ ] Budget manager with spend tracking
- [ ] Prize transfer to owner EOA via `transferPendingPrizes`
- [ ] Fund recovery CLI (`npm run withdraw` — returns HBAR/LAZY to owner)
- [ ] Direct contract interaction for writes
- [ ] MCP client for reads (connecting to Phase 1 endpoint)
- [ ] MCP server exposing agent control tools
- [ ] Strategy JSON templates (conservative, balanced, aggressive)
- [ ] HOL registration for the agent itself

### Phase 5: Agent-as-MCP-Server

**Effort**: ~2-3 days (within Part 3 project)
**Dependencies**: Phase 4

Deliverables:
- [ ] Agent exposes its own MCP tools
- [ ] Claude/Cursor can control the agent
- [ ] Status reporting and session history
- [ ] Live strategy adjustment via MCP

---

## 9. Open Questions

### Architecture

1. **Session keys vs WalletConnect for dApp writes**: Should the dApp support session keys (user delegates limited signing authority to server) or strictly use transaction intents that the client signs? Session keys would enable true server-side execution but introduce key custody.

2. **Vercel function timeout**: Hedera transactions typically confirm in 3-5 seconds. Vercel functions have a 300-second timeout. Is this sufficient for all operations including gas estimation + submission + confirmation?

3. **Multi-network**: Should the MCP endpoint serve both testnet and mainnet simultaneously (query param?) or separate deployments?

### Product

4. **Agent incentives**: Should there be special pools or bonuses for agents? E.g., "Agent Pool" with API-only access and tailored prize structures.

5. **Agent identification**: Should we track which entries came from agents vs human users? Could affect pool fairness perception.

6. **Community agent pools**: Could agents create and manage their own community pools programmatically?

### HOL

7. **HCS-10 messaging**: Is HCS-10 agent-to-agent messaging worth implementing alongside MCP, or is MCP sufficient as the primary protocol?

8. **Credit system**: Should the autonomous agent (Part 3) use HOL credits for anything, or only interact directly with Hedera?

### Security

9. **Rate limiting per tool**: Should expensive read operations (e.g., `get_prizes` with many packages) have stricter rate limits than simple queries?

10. **Agent wallet recovery**: If an agent wallet is compromised, what's the recovery path? Should there be a "panic button" that withdraws everything to a pre-configured recovery address?

---

## Appendix A: Implementation Prompts for dApp Project (Part 2)

> Copy these to the dApp project. They give Claude/agents full context to build the MCP endpoint.

### A.1 CLAUDE.md Snippet for dApp Project

Add this to the dApp's `CLAUDE.md` to give Claude context when working on the MCP endpoint:

```markdown
## MCP Endpoint (/api/mcp)

This project exposes a Model Context Protocol (MCP) endpoint that allows AI agents
(Claude, Cursor, custom agents) to query and interact with LazyLotto contracts.

### Transport
- **Streamable HTTP** (MCP spec 2025-03-26) — NOT the deprecated SSE transport
- Single endpoint: `/api/mcp` handling POST + GET + DELETE
- Stateless mode (no session persistence needed on Vercel serverless)
- Package: `mcp-handler` (Vercel's adapter) + `@modelcontextprotocol/sdk` >= 1.26.0

### Architecture
- Reads: Query Hedera Mirror Node REST API (free, cacheable)
- Fallback reads: JSON-RPC relay for contract state not indexed by mirror node
- Writes: Return **transaction intents** — the MCP server never holds private keys
- Auth: Bearer token (API key) for write operations; reads are public

### Contract Addresses (from environment)
- LAZYLOTTO_CONTRACT_ID: Core game logic
- LAZYLOTTO_STORAGE_ID: Token custody — approval target for FTs and NFTs
- LAZYLOTTO_POOL_MANAGER_ID: Pool metadata, bonuses, proceeds
- LAZY_GAS_STATION_ID: $LAZY approval target
- LAZY_TOKEN_ID: $LAZY fungible token (1 decimal place)

### Key Integration Rules
1. Token approvals go to Storage (NOT LazyLotto), except $LAZY which goes to GasStation
2. Win rates are in thousandths of basis points: divide by 1,000,000 to get percentage
3. Roll operations need 1.5x gas multiplier on estimates
4. Mirror node has ~4 second propagation delay after writes
5. $LAZY uses 1 decimal place (10 base units = 1 LAZY)

### ABI Source
Import from `@lazysuperheroes/lazy-lotto` NPM package:
- LazyLotto ABI, LazyLottoPoolManager ABI, LazyLottoStorage ABI

### MCP Tools Reference
See docs/MCP_INTEGRATION_DESIGN.md sections 4.3-4.5 for full tool definitions.
```

### A.2 Prompt: Build the MCP Endpoint from Scratch

Use this prompt to instruct Claude to build the endpoint in the dApp project:

```
Build an MCP server endpoint at /api/mcp using the Streamable HTTP transport
(MCP spec 2025-03-26).

Stack:
- Next.js App Router (app/api/mcp/route.ts)
- mcp-handler package (Vercel's adapter)
- @modelcontextprotocol/sdk >= 1.26.0
- zod for input validation
- ethers.js v6 for ABI encoding (already in project)

The endpoint needs these tools:

READ TOOLS (no auth):

1. lazylotto_list_pools
   - Inputs: type (all|global|community), offset (default 0), limit (default 20, max 50)
   - Query mirror node for pool list, then batch-query getPoolBasicInfo for each
   - Format win rates as percentages, entry fees in human-readable units
   - Include: id, win rate %, entry fee + symbol, prize count, outstanding entries, status

2. lazylotto_get_pool
   - Input: poolId (required)
   - Return full pool info: basic info + owner + platform fee % + prize count
   - Include all fields from getPoolBasicInfo plus PoolManager queries

3. lazylotto_get_prizes
   - Inputs: poolId (required), offset (default 0), limit (default 20, max 50)
   - Return prize packages with token symbols resolved via mirror node
   - Format: HBAR amounts in HBAR (not tinybar), token amounts with decimals

4. lazylotto_get_user_state
   - Input: address (required, accepts 0.0.X or 0x format)
   - Return: per-pool entry counts, pending prize count + details, boost calculation
   - Use getUserEntriesPage + getPendingPrizesPage + calculateBoost

5. lazylotto_calculate_ev
   - Inputs: poolId (required), address (optional for boost)
   - Calculate: average prize value, effective win rate, expected value per entry
   - Return recommendation: positive EV, neutral, or negative EV

6. lazylotto_get_system_info
   - No inputs
   - Return: contract addresses, LAZY token, network, total pools
   - Cache aggressively (300s)

Contract ABIs: import from @lazysuperheroes/lazy-lotto
Mirror node: HEDERA_MIRROR_NODE_URL env var
JSON-RPC relay: HEDERA_JSON_RPC_URL env var (for calculateBoost and other view calls)

Caching strategy:
- Pool list: 60s
- Pool basic info: 30s
- Prize packages: 60s
- System info: 300s
- User state: no cache

Export handler as GET, POST, DELETE from route.ts.
Use basePath: '/api' in createMcpHandler options.
```

### A.3 Prompt: Add Write Tools (Phase 2)

```
Add authenticated write tools to the existing /api/mcp endpoint.

Auth: Use withMcpAuth from mcp-handler with Bearer token verification.
API keys follow format: ll_<accountId_hash>_<random>
Store key hashes in a Vercel KV store or environment variable for MVP.

Write tools use the TRANSACTION INTENT pattern — the server NEVER holds private keys.
Instead, return a structured intent object that the client signs locally.

Transaction Intent format:
{
  type: "transaction_intent",
  chain: "hedera:testnet" | "hedera:mainnet",
  intent: {
    contractId: string,
    function: string (e.g., "buyEntry(uint256,uint256)"),
    params: Record<string, any>,
    gas: number,
    payableAmount: string (tinybar/base units),
    payableToken: "HBAR" | token address
  },
  encoded: string (ABI-encoded function call),
  humanReadable: string (plain English summary),
  prerequisites: Array<{
    type: "token_association" | "approval" | "balance_check",
    token: string,
    symbol: string,
    target?: string (approval target address),
    amount?: string,
    reason: string
  }>,
  warnings: string[]
}

Write tools to implement:

1. lazylotto_buy_entries
   - Inputs: poolId, count (1-100), action (buy|buy_and_roll|buy_and_redeem)
   - Check prerequisites: association with pool ticket token, sufficient balance
   - Gas: standard for buy/redeem, 1.5x multiplier for buy_and_roll
   - Return transaction intent with all prerequisites listed

2. lazylotto_roll
   - Inputs: poolId, count (optional — omit for rollAll)
   - Gas: always 1.5x multiplier
   - Return transaction intent

3. lazylotto_claim_prizes
   - Inputs: indices (optional — omit for claimAll)
   - Return transaction intent

4. lazylotto_check_prerequisites
   - Input: address, poolId
   - Check: token association, approvals (Storage + GasStation), balances
   - Return: list of missing prerequisites with fix instructions

For each write tool, first call lazylotto_check_prerequisites internally
and include any issues in the prerequisites array of the intent.
```

### A.4 Prompt: Add MCP Prompts and Resources (Phase 2)

```
Add MCP Prompts and Resources to the /api/mcp endpoint.

PROMPTS (registered via server.prompt()):

1. explore_pools
   - Arguments: budget (optional, e.g., "100 HBAR")
   - Template: "You are helping a user explore LazyLotto pools. Call
     lazylotto_list_pools to see available pools, then for each interesting
     pool call lazylotto_get_prizes to inspect the prize packages. If the
     user provided a budget of {budget}, filter to pools where entry fee
     fits within that budget. Calculate expected value for promising pools
     using lazylotto_calculate_ev. Present a summary table comparing pools
     by: win rate, entry fee, best prizes, expected value. Recommend the
     best pool based on the user's risk tolerance."

2. play_pool
   - Arguments: poolId (required), strategy (optional: conservative|balanced|aggressive)
   - Template: "You are helping a user play LazyLotto pool {poolId}. First,
     call lazylotto_get_pool to verify the pool exists and is not paused/closed.
     Then call lazylotto_get_prizes to show what they could win. Call
     lazylotto_calculate_ev to show the math. If strategy is conservative,
     recommend 1-2 entries. If balanced, 3-5. If aggressive, 5-10. Then call
     lazylotto_buy_entries with action buy_and_roll. Report the results —
     how many wins and losses. If they won, call lazylotto_claim_prizes.
     Show a session summary: spent, won, net result."

3. claim_prizes
   - No arguments
   - Template: "Check the user's pending prizes by calling lazylotto_get_user_state.
     If they have pending prizes, describe each one (HBAR value, tokens, NFTs).
     Then call lazylotto_claim_prizes to claim them all. Confirm the claim
     transaction completed successfully."

4. analyze_pools
   - Arguments: risk_tolerance (optional: low|medium|high)
   - Template: "Perform a comprehensive analysis of all LazyLotto pools.
     Call lazylotto_list_pools, then for each active pool call
     lazylotto_calculate_ev. Rank pools by expected value. If risk_tolerance
     is low, emphasize pools with high win rates (frequent small wins). If
     high, emphasize pools with valuable prize packages (rare big wins).
     Present findings as a ranked table with your recommendation."

RESOURCES (registered via server.resource()):

Register these as URI-based resources:
- lazylotto://pools — JSON list of all pools (refreshed on read)
- lazylotto://pools/{poolId} — Single pool detail
- lazylotto://pools/{poolId}/prizes — Prize packages for pool
- lazylotto://system — Contract addresses and configuration
- lazylotto://user/{address}/state — User's lottery state
```

---

## Appendix B: Implementation Prompts for Agent Project (Part 3)

> Use these prompts to bootstrap the `lazylotto-agent` project.

### B.1 CLAUDE.md for Agent Project

Place this as `CLAUDE.md` in the `lazylotto-agent` project root:

```markdown
# CLAUDE.md — LazyLotto Autonomous Agent

## Project Overview

Autonomous AI agent that plays the LazyLotto lottery on Hedera with its own funded wallet.
The agent evaluates pools, buys entries, rolls for prizes, claims winnings, and manages
its budget — all without human intervention.

## Architecture

- **Reads**: Via MCP client connected to the LazyLotto dApp endpoint (https://lazylotto.app/api/mcp)
- **Writes**: Direct Hedera SDK contract calls (no dependency on dApp for transactions)
- **Wallet**: Agent holds its own Hedera account with private key in .env
- **Strategy**: Configurable JSON files define play behavior, budget, and risk tolerance

## Tech Stack

- Runtime: Node.js 20+ (TypeScript, ESM)
- Hedera SDK: @hashgraph/sdk (for wallet, signing, contract calls)
- MCP Client: @modelcontextprotocol/sdk (for querying LazyLotto dApp)
- Contract ABIs: @lazysuperheroes/lazy-lotto (NPM package)
- HOL: @hashgraphonline/standards-sdk (for registry and discovery)
- Scheduler: node-cron (for periodic play sessions)
- Config: dotenv + JSON strategy files

## Key Directories

- src/agent/       — Core agent logic (LottoAgent, StrategyEngine, BudgetManager)
- src/hedera/      — Hedera SDK wrappers (wallet, contracts, mirror node, tokens)
- src/mcp/         — MCP client (reads) and MCP server (agent control)
- src/config/      — Strategy types and defaults
- strategies/      — JSON strategy files (conservative, balanced, aggressive)

## Hedera-Specific Rules

1. $LAZY token uses 1 decimal place (10 base units = 1 LAZY)
2. Token approvals: $LAZY → LazyGasStation, all others → LazyLottoStorage
3. Roll operations need 1.5x gas multiplier
4. Mirror node has ~4s propagation delay after transactions
5. Always associate tokens before receiving them
6. Agent wallet should be a dedicated account with limited funding — NEVER the treasury

## Commands

npm run start            — Run agent (single session)
npm run start:scheduled  — Run agent on cron schedule
npm run setup            — First-time wallet setup (associations, approvals)
npm run status           — Check agent wallet balance and state
npm test                 — Run test suite
```

### B.2 Prompt: Bootstrap the Agent Project

```
Create a new TypeScript project called lazylotto-agent for an autonomous AI agent
that plays the LazyLotto lottery on Hedera.

Initialize:
- package.json with type: "module", scripts (start, start:scheduled, setup, status, test)
- tsconfig.json targeting ES2022, Node16 module resolution
- .env.example with all required variables
- .gitignore

Dependencies:
- @hashgraph/sdk (Hedera SDK for wallet and contract calls)
- @modelcontextprotocol/sdk (MCP client to query LazyLotto)
- @lazysuperheroes/lazy-lotto (contract ABIs)
- @hashgraphonline/standards-sdk (HOL registry)
- zod (config validation)
- node-cron (scheduling)
- dotenv

Project structure:
src/
├── index.ts                    — Entry: parse args, load config, run agent
├── agent/
│   ├── LottoAgent.ts           — Orchestrator: setup → evaluate → play → claim → report
│   ├── StrategyEngine.ts       — Pool scoring: win rate × avg prize - entry fee = EV
│   ├── BudgetManager.ts        — Track spend, enforce limits, reserve balance
│   └── ReportGenerator.ts      — Session summaries (wins, losses, net, prizes claimed)
├── hedera/
│   ├── wallet.ts               — Initialize Client from .env, verify balance, sign txs
│   ├── contracts.ts            — Typed wrappers: buyEntry, rollAll, claimAllPrizes, etc.
│   ├── mirror.ts               — Mirror node REST queries: balances, tokens, NFTs
│   └── tokens.ts               — Associate tokens, set approvals (Storage + GasStation)
├── mcp/
│   ├── client.ts               — Connect to LazyLotto MCP endpoint, call tools
│   └── server.ts               — Expose agent as MCP server (for Claude to control it)
└── config/
    ├── strategy.ts             — Zod schema for strategy config
    └── defaults.ts             — Default values

strategies/
├── conservative.json           — High win rate pools, small entries, low budget
├── balanced.json               — Mixed pools, moderate entries
└── aggressive.json             — High-value pools, more entries, bigger budget

.env.example:
HEDERA_NETWORK=testnet
HEDERA_ACCOUNT_ID=0.0.XXXXXX
HEDERA_PRIVATE_KEY=302e...
LAZYLOTTO_MCP_URL=https://lazylotto.app/api/mcp
LAZYLOTTO_MCP_API_KEY=ll_xxxxx
LAZYLOTTO_CONTRACT_ID=0.0.XXXXXX
LAZYLOTTO_STORAGE_ID=0.0.XXXXXX
LAZY_GAS_STATION_ID=0.0.XXXXXX
LAZY_TOKEN_ID=0.0.XXXXXX
STRATEGY=balanced
HOL_API_KEY=
```

### B.3 Prompt: Implement the Core Agent Loop

```
Implement LottoAgent.ts — the main agent orchestrator.

The agent runs this loop per session:

1. PREFLIGHT
   - Verify wallet balance (HBAR + LAZY if needed)
   - Check if budget allows more play
   - If balance < reserveBalance from strategy, stop with warning

2. DISCOVER
   - Call MCP tool lazylotto_list_pools to get active pools
   - Filter by strategy criteria (fee token, max entry fee, min win rate)
   - For each candidate pool, call lazylotto_get_pool for details

3. EVALUATE
   - Use StrategyEngine to score pools:
     Score = (effectiveWinRate × avgPrizeValue) - entryFee
   - effectiveWinRate = baseWinRate + boost (call lazylotto_calculate_ev)
   - Rank pools by score
   - Select top pool(s) within budget

4. PLAY
   - For each selected pool:
     a. Check prerequisites (associations, approvals) via tokens.ts
     b. Auto-fix missing prerequisites (associate, approve)
     c. Calculate entry count from strategy (entriesPerPool, remaining budget)
     d. Execute buyAndRollEntry via contracts.ts (1.5x gas multiplier)
     e. Record result (wins, losses, gas spent)

5. TRANSFER PRIZES
   - Check pending prizes via MCP lazylotto_get_user_state
   - If prizes pending, call transferPendingPrizes(ownerEOA, type(uint256).max)
     via contracts.ts — this reassigns prizes in-memory, no token transfers
   - The owner sees prizes in their pending array and claims from the website
   - Record transferred prizes for reporting (HBAR value, tokens, NFTs)
   - NOTE: Do NOT call claimAllPrizes — the agent likely lacks token
     associations for prize tokens. Transfer is the correct path.

6. REPORT
   - Generate session summary via ReportGenerator
   - Log: pools played, entries bought, wins/losses, prizes transferred, net P&L
   - Update BudgetManager cumulative tracking

The agent should be resilient:
- Catch and log transaction failures without crashing
- Skip pools that fail prerequisite checks
- Continue to next pool if one fails
- Always attempt prize transfer even if play operations failed
- Report partial results on any error

Use the Hedera SDK for all write operations (wallet.ts + contracts.ts).
Use the MCP client for all read operations (mcp/client.ts).

Key contract call for prize transfer:
  const iface = new ethers.Interface(LazyLottoABI);
  const encoded = iface.encodeFunctionData('transferPendingPrizes', [
    ownerEOA,           // recipient address
    ethers.MaxUint256   // type(uint256).max = transfer ALL prizes
  ]);
  // Execute via ContractExecuteTransaction with standard gas
```

### B.4 Prompt: Implement the MCP Server (Agent Control)

```
Implement src/mcp/server.ts — expose the agent as an MCP server so Claude or
other AI can control it.

Use @modelcontextprotocol/sdk with stdio transport (agent runs locally).

Register these tools:

1. agent_play
   - Inputs: budget (optional override), poolId (optional specific pool)
   - Calls LottoAgent.runSession() with overrides
   - Returns: session summary (pools played, results, net P&L)

2. agent_status
   - No inputs
   - Returns: wallet balance (HBAR + LAZY), pending prizes, session history,
     current strategy name, cumulative stats (total played, won, net)

3. agent_transfer_prizes
   - No inputs (uses configured OWNER_EOA from .env)
   - Calls transferPendingPrizes(ownerEOA, type(uint256).max)
   - Returns: count of prizes transferred, summary of what was transferred

4. agent_set_strategy
   - Input: strategy (name or JSON object)
   - Validates with Zod schema
   - Updates agent's active strategy
   - Returns: confirmation with new strategy summary

5. agent_wallet_info
   - No inputs
   - Returns: account ID, HBAR balance, LAZY balance, token associations,
     active approvals, owner EOA, delegated NFTs (bonuses)

6. agent_withdraw
   - Inputs: amount (required), token (HBAR or LAZY), to (optional, defaults to OWNER_EOA)
   - Transfers HBAR or LAZY from agent wallet to specified address
   - Returns: transaction receipt, remaining balance
   - Use case: owner recovering funds from agent wallet

7. agent_stop
   - No inputs
   - Transfers any pending prizes to owner, then stops current session
   - Returns: partial session summary + transfer receipt

Client configuration for Claude Desktop:
{
  "mcpServers": {
    "lazylotto-agent": {
      "command": "node",
      "args": ["dist/mcp/server.js"]
    }
  }
}

The MCP server runs alongside the agent — import the same LottoAgent instance
and expose control over it via MCP tools.
```

### B.5 Prompt: HOL Registration for the Agent

```
Implement HOL registry integration for the lazylotto-agent.

When the agent starts for the first time, register it in the HOL registry
using @hashgraphonline/standards-sdk.

HCS-11 Profile:
{
  "type": "agent",
  "name": "LazyLotto Player Agent",
  "alias": "lazylotto-player",
  "bio": "Autonomous agent that plays LazyLotto on Hedera. Evaluates pools,
          buys entries, rolls for prizes, and claims winnings.",
  "capabilities": ["lottery-player", "hedera", "autonomous"],
  "agentType": "autonomous",
  "networks": ["hedera:testnet"]
}

Registration flow:
1. Check if already registered (store registration ID in local .agent-config.json)
2. If not registered:
   a. Get registration quote
   b. Register agent
   c. Wait for confirmation
   d. Save registration ID and UAID to .agent-config.json
3. If registered, optionally update profile if config changed

Add to .gitignore: .agent-config.json

This enables other HOL-connected agents to discover this player agent
and potentially coordinate (e.g., a portfolio agent that manages multiple
game-playing agents).
```

---

## Appendix C: Quick-Start Examples

### C.1 Agent User Quick Start

For an end user who wants to run the agent:

```bash
# 1. Clone and install
git clone https://github.com/example/lazylotto-agent
cd lazylotto-agent
npm install

# 2. Create a Hedera testnet account
#    Visit: https://portal.hedera.com
#    Save your Account ID and Private Key

# 3. Configure
cp .env.example .env
# Edit .env:
#   HEDERA_ACCOUNT_ID=0.0.AGENT    — agent's account
#   HEDERA_PRIVATE_KEY=302e...      — agent's key
#   OWNER_EOA=0.0.YOUR_MAIN        — your main wallet (prizes go here)

# 4. First-time setup (associates tokens, sets approvals)
npm run setup
# Also: from your main wallet, delegate your LSH NFTs to the agent
#   for win rate bonuses (uses LazyDelegateRegistry)

# 5. Check your wallet
npm run status

# 6. Play a single session (prizes auto-transfer to your main wallet)
npm run start

# 7. Or run on a schedule (plays 3x daily)
npm run start:scheduled

# 8. Recover funds from agent when done
npm run withdraw -- --amount 50 --token HBAR

# 8. Or control via Claude
#    Add to Claude Desktop config:
#    {
#      "mcpServers": {
#        "lazylotto-agent": {
#          "command": "node",
#          "args": ["/path/to/lazylotto-agent/dist/mcp/server.js"]
#        }
#      }
#    }
#    Then ask Claude: "Play the lottery for me with a 50 HBAR budget"
```

### C.2 MCP Client Quick Start

For a developer who wants to query LazyLotto from their own agent:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Connect to LazyLotto MCP endpoint
const transport = new StreamableHTTPClientTransport(
  new URL('https://lazylotto.app/api/mcp')
);
const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(transport);

// Discover pools
const pools = await client.callTool('lazylotto_list_pools', {
  type: 'all',
  limit: 10,
});
console.log('Available pools:', pools.content[0].text);

// Check a specific pool
const pool = await client.callTool('lazylotto_get_pool', {
  poolId: 0,
});
console.log('Pool details:', pool.content[0].text);

// Calculate expected value
const ev = await client.callTool('lazylotto_calculate_ev', {
  poolId: 0,
  address: '0.0.12345',  // Optional: includes boost in calculation
});
console.log('Expected value:', ev.content[0].text);

// Get transaction intent for buying entries
const intent = await client.callTool('lazylotto_buy_entries', {
  poolId: 0,
  count: 5,
  action: 'buy_and_roll',
});
// intent.content contains the transaction intent JSON
// Sign with your wallet and submit to Hedera
```

### C.3 Claude Desktop Usage

Once the MCP server is configured, users can have conversations like:

```
User: "What lottery pools are available on LazyLotto?"

Claude: [calls lazylotto_list_pools]
"There are 3 active pools:
 1. Lucky Dip — 10 HBAR entry, 20% win rate, 47 prizes remaining
 2. High Roller — 50 HBAR entry, 6% win rate, 25 prizes remaining
 3. LAZY Lounge — 150 LAZY entry, 15% win rate, 89 prizes remaining"

User: "Which one gives the best expected value?"

Claude: [calls lazylotto_calculate_ev for each pool]
"Lucky Dip has the best EV at +2.3 HBAR per entry. The High Roller has
negative EV (-8 HBAR) but offers a chance at the NFT jackpot worth ~1000 HBAR.
LAZY Lounge burns $LAZY on entry so EV depends on your LAZY valuation."

User: "Buy me 5 entries in Lucky Dip and roll them"

Claude: [calls lazylotto_buy_entries with poolId=0, count=5, action=buy_and_roll]
"Here's the transaction to sign:
 - Buy 5 entries in Lucky Dip for 50 HBAR total
 - Estimated gas: 450,000 (~0.04 HBAR)
 [Transaction intent ready for your wallet to sign]"
```

---

*Document version: 0.3 — Added prize transfer contract change, agent wallet fund recovery, delegation bonus patterns*
*Next step: Verify tests pass, redeploy contract, resolve open questions, begin Phase 1 implementation*
