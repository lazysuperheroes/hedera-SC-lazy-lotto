# Two-Stage Draws: Design

**Status:** proposal, 2026-10-15. Not yet built or reviewed. Applies to every Lazy contract that draws randomness: LazyLotto (V3), LazyTradeLotto v2, the Mission template, ForeverMinter and MinterContract. Tracking: `LAZY_HARDENING_ROADMAP.md`. Background: `LAZY_REVIEW_2026-10-15.md`.

## The problem in one paragraph

Today each contract draws with Hedera's PRNG and settles the result in the same transaction as the player's action. Anything that can run code around that call can look at the result and revert a bad one, which re-rolls for free. We have been closing those routes one at a time: an EOA-only check (`tx.origin == msg.sender`), then a no-code check for HIP-1340 delegated accounts, then a network rule for atomic batches. More routes keep appearing as Hedera adds features that let code run around a call (account hooks, HIP-1195, are next), and some can make the caller look exactly like a plain wallet. Caller checks can't win that race.

## The fix in one paragraph

Split every draw in two. **Commit**: the player's transaction takes their stake (ticket, fee, signed trade ticket, mission slot) irrevocably and records a *target block*, the next block. Nothing random happens. **Settle**: any later transaction, from anyone, derives the outcome from that target block's hash and records the result. At commit time the outcome doesn't exist yet, so there is nothing to look at and nothing to revert to. After the target block closes, the outcome is fixed, and every reader computes the same value no matter who settles or when, so reverting a settle only delays it. This holds however code gets wrapped around our calls, today or after any future network change.

## Rules

Every contract that draws must follow all of these.

1. **Commit takes the stake and draws nothing.** It consumes the ticket or payment and writes the commitment: player, what was staked, snapshot of the odds and parameters, `targetBlock = block.number + 1`, plus `prevHash = blockhash(block.number - 1)` and `commitTime = block.timestamp` for the continuity checks in rule 8. It emits an event. Its success can't depend on anything random. Pending commitments are not transferable.
2. **Entropy is the target block's hash only.** `seed = keccak256(abi.encode(blockHash(targetBlock), address(this), commitId))`, with per-item values `keccak256(abi.encode(seed, i))`. Never the 0x169 PRNG (see "Why not the PRNG").
3. **Settle is deterministic and open to anyone.** No caller checks, no pause (a pause during settle would let the admin run commits to expiry), no use of `msg.sender` in the outcome.
4. **Settle never does a step the player can make fail.** It doesn't push tokens or NFTs to the player. It records winnings or prizes as claimable, and a separate claim delivers them. If a contract does try a delivery inside settle (for convenience), the failure path must record the reward as owed, never revert. A failed claim never changes an outcome.
5. **Expiry forfeits; it never redraws or refunds.** The EVM only serves the last 256 block hashes: about 9.3 minutes on mainnet today (2.18 s blocks), but it was about 3.5 minutes during 2025 and the block period can change again, so plan for 2 minutes. A commitment not anchored inside its window resolves as a loss. The target hash is public within seconds (nodes and mirror watchers see it before anyone settles), so a redraw or refund would be a free option for a player who already knows the hash means a loss. The anchor contract and the keeper (below) make expiry practically unreachable for honest players. The one exception is rule 8's *provable network renumbering*, which voids and refunds, because nobody chooses it.
6. **Settle in commit order.** Where settles share state (a prize list, a jackpot, a reward pool, a serial pool), settle strictly first-in first-out so nobody can pick an order that suits them. Anything per-player that can change between commit and settle (odds, boosts, fees, burn rate) is snapshotted at commit.
7. **Nothing else may touch the state a draw reads while commitments are pending.** Once the target block exists, its hash is public, so anyone who can change the pool before settle can steer the result. Example: the Mission's `addRewardSerials` is permissionless, so a player could add serials after seeing the hash to shift which serial their index lands on. Every function that changes draw state other than settle (adding or removing prizes, reward serials, mint stock or metadata; jackpot boosts and caps) must revert while the queue is non-empty (`if (nextToSettle != nextCommitId) revert SettlePending();`). With a keeper the queue drains within seconds, so admins just retry.
8. **Fail closed if the network changes. It already has.** Hedera's EVM `block.number` was redefined in production: from Dec 2024 to Apr 2026 it followed block-stream numbering (~0.8 s blocks), then **jumped back by ~7.45 million** at the v0.72 upgrade (28 Apr 2026). The block-stream cutover (testnet 25 Nov 2026, mainnet 9 Dec 2026, v0.80) switches the source again; code carries numbering and the last 256 hashes across, but that's unproven in production. So:
   - **At commit**, require `blockhash(N-1) != 0` with non-zero high bits (catches a constant or stub value) and `blockhash(N+1) == 0`, and store `prevHash = blockhash(N-1)`. Do **not** require `blockhash(N) == 0`: it's true on consensus nodes, but the mirror-node simulation that wallets and the relay use for gas estimation returns the current block's hash, so every commit would show "will fail".
   - **At anchor/settle**, read the hashes of `T-2`, `T-1` and `T` together while all are in the window. Require them non-zero and pairwise distinct, and require **`hash(T-2) == prevHash`** (with `T = N+1`, block `T-2` is block `N-1`). That proves the numbering and chain are the same as at commit.
   - **Provable renumbering voids and refunds.** That means `block.number < N` (a backwards jump), a continuity mismatch, or an unanchored target past its window when `block.timestamp - commitTime` is far too short for 256 blocks (a forward jump). The refund goes to the stake; it carries no option value because nobody can choose it.
   - Any other unavailable hash reverts and waits; it never forfeits.
   - **Operations:** pause *commits* (never settle) before each scheduled network upgrade, and run a canary commit + settle afterwards before reopening.
9. **Caller checks are no longer load-bearing.** `tx.origin` and `code.length` checks can be dropped, which also lets smart wallets, contracts and HIP-1340 delegated accounts play.

## Why not the PRNG

- **PRNG at commit, kept private:** Hedera's PRNG returns one seed per transaction (the record running hash three transactions back), identical for every nested call, child dispatch and batch inner transaction. So any contract in the same transaction can ask 0x169 for the same seed and compute our outcome itself before deciding whether to revert. On mainnet the seed sometimes simply *equals* the previous block's hash. Storage privacy doesn't help.
- **PRNG at settle:** each settle transaction gets a different seed, so whoever settles can wrap the call, check the result and revert until it's good.
- **A future block's hash** is unknown when the player commits and identical for every transaction that reads it afterwards, so neither trick works.

## New shared contract: `LazyDrawBeacon`

A small, immutable, ownerless contract that every game uses. It answers "is the network serving sane block hashes right now", and **anchors** a target block's hash, together with the two before it, into storage while the EVM still serves them. A draw can then be settled long after the 256-block window, and the continuity check of rule 8 still works.

```solidity
// Sketch, not reviewed code.
contract LazyDrawBeacon {
    struct Anchor { bytes32 hashTm2; bytes32 hashTm1; bytes32 hashT; }  // blocks T-2, T-1, T
    mapping(uint256 => Anchor) private anchors;
    event Anchored(uint256 indexed target, bytes32 hashT);
    error EntropyUnavailable();

    /// Commit-time check; returns blockhash(N-1) for the consumer to store as prevHash.
    function commitCheck() external view returns (bytes32 prev) {
        prev = blockhash(block.number - 1);
        if (prev == 0 || uint256(prev) >> 128 == 0 || blockhash(block.number + 1) != 0)
            revert EntropyUnavailable();
        // deliberately no blockhash(block.number) == 0 check: breaks mirror/relay gas estimation
    }

    /// Anchors T-2, T-1, T while all three are served (T < block.number <= T + 254).
    /// Returns an empty Anchor if it's too early or too late and T was never anchored.
    function anchor(uint256 t) public returns (Anchor memory a) {
        a = anchors[t];
        if (a.hashT != 0 || t >= block.number || block.number > t + 254) return a;
        a = Anchor(blockhash(t - 2), blockhash(t - 1), blockhash(t));
        if (a.hashTm2 == 0 || a.hashTm1 == 0 || a.hashT == 0 ||
            a.hashTm2 == a.hashTm1 || a.hashTm1 == a.hashT || a.hashTm2 == a.hashT ||
            uint256(a.hashT) >> 128 == 0) revert EntropyUnavailable();   // degenerate values: fail closed
        anchors[t] = a;
        emit Anchored(t, a.hashT);
    }

    function anchorMany(uint256[] calldata targets) external {
        for (uint256 i; i < targets.length; ++i) anchor(targets[i]);
    }
}
```

Why a separate contract:
- **Shared liveness.** One anchor call secures the entropy for every pending draw targeting that block, across all games. Settling, which may be expensive, can then happen whenever. Hedera has no EIP-2935-style long hash history (HIP-1341 explicitly doesn't adopt it), so this is the only way past 256 blocks.
- **Smaller games.** LazyLotto and the Mission template are near the 24 KB limit, and the beacon keeps the shared logic out of them.
- **One audited primitive.** It's immutable with no admin key, so nobody, including us, can swap the randomness source under existing commits. If Hedera breaks block hashes, it fails closed (rule 8), and we'd deploy new versions without losing anyone's stake.

## Consumer pattern

```solidity
// Sketch. One FIFO queue per contract (per Mission clone, per minter, one for LazyLotto).
struct Commitment {
    address player; uint64 commitBlock; uint64 commitTime; bytes32 prevHash; /* + snapshot fields */
}
mapping(uint256 => Commitment) private commitments;
uint256 public nextToSettle;   // queue head
uint256 public nextCommitId;   // queue tail

function commit(/* game args */) external nonReentrant whenNotPaused {  // commits are pausable
    bytes32 prev = beacon.commitCheck();
    // ... take the stake, snapshot odds ...
    commitments[nextCommitId] = Commitment(msg.sender, uint64(block.number), uint64(block.timestamp), prev /* , ... */);
    emit Committed(nextCommitId++, msg.sender /* , ... */);
}

/// Anyone, any time, NOT pausable. Settles up to maxCount commitments in order.
function settle(uint256 maxCount) external nonReentrant {
    uint256 id = nextToSettle;
    for (uint256 n; n < maxCount && id < nextCommitId; ++n) {
        Commitment storage c = commitments[id];
        uint256 t = c.commitBlock + 1;
        if (block.number < c.commitBlock) { _void(id); ++id; continue; }   // provable backwards renumbering
        if (block.number <= t) break;                    // head not ready, so nothing behind it is
        LazyDrawBeacon.Anchor memory a = beacon.anchor(t);
        if (a.hashT == 0) {                              // too late and never anchored
            if (block.timestamp - c.commitTime < MIN_PLAUSIBLE_WINDOW) _void(id);  // forward jump
            else _forfeit(id);                           // genuine expiry (rule 5)
        } else if (a.hashTm2 != c.prevHash) {
            _void(id);                                   // numbering/chain changed since commit
        } else {
            _resolve(id, uint256(keccak256(abi.encode(a.hashT, address(this), id))));  // records results only
        }
        ++id;
    }
    nextToSettle = id;
}
```

- **Gas bounds.** Cap the work per commitment (for example, entries per LazyLotto roll and rewards per Mission claim), so one commitment can never make `settle` run out of gas and stall the queue.
- **No fallible external calls.** `_resolve` makes none. TradeLotto's LazyGasStation payout goes through a claim, or through `try/catch` that falls back to "owed". `_void` refunds the stake by recording it as claimable, never by pushing it.
- **Early settle is harmless.** On an idle network the keeper's settle can itself open block `T`, in which case it simply makes no progress; the keeper retries a block later.
- **Optional extra margin.** Target `N+2` instead of `N+1`, then continuity compares `hash(N-1)` at `T-3`. That guards against a hypothetical one-block lag in `NUMBER` that no on-chain check can see. It costs about 2 more seconds of latency.

## Player experience

- **One signature.** The player commits. A keeper (a small team bot) watches `Committed` events and calls `settle` a block or two later. The UI shows "Drawing…" and then the result from the `Settled` event, roughly **4–6 seconds** after the commit on ~2-second Hedera blocks. A **"Reveal now"** button lets the player settle themselves if the keeper is slow.
- **Claims work as today.** LazyLotto already uses pending prizes plus a claim. The Mission and minters reuse the owed-rewards pattern already built for the Mission, so a reward the player can't receive yet is held for them.
- **Smart wallets work.** With caller checks gone, HIP-1340 accounts and contract wallets can play.
- **Keeper cost** is a few cents per settle at Hedera gas prices. The keeper also calls `beacon.anchorMany` for pending target blocks within seconds and at the latest well under 2 minutes, which is the conservative window floor from rule 5. Once a target is anchored, anyone can settle it at any later time.
- **Network upgrades:** the dApp shows "draws paused for network upgrade" while commits are paused around scheduled Hedera upgrades (rule 8). Settles and claims keep working.

## Attack checklist

| Attempt | Why it fails |
|---|---|
| Wrap the commit (contract, batch, hook, HIP-1340 delegation, or any future feature) and revert on a bad outcome | There is no outcome during the commit transaction; the target block hasn't happened |
| Wrap the settle and revert on a bad outcome | The outcome is already fixed; a revert only delays, and the keeper or anyone settles anyway |
| Don't settle a losing draw | It's a loss either way |
| Let a losing draw expire hoping for a redraw or refund | Expiry forfeits (rule 5) |
| Influence or predict the target block's hash | It depends on the whole consensus-ordered record of that block. Submitting more transactions changes it unpredictably, and the result can't be seen before committing |
| Settle others' commitments in a convenient order | First-in first-out only (rule 6) |
| Admin changes odds or prizes between commit and settle | Odds and fees are snapshotted at commit (rule 6); pool, jackpot and stock changes revert while commitments are pending (rule 7) |
| Player adds reward serials or mint stock after seeing the hash, to steer their index | Draw-state changes revert while commitments are pending (rule 7) |
| Admin pauses to force expiry | Settle and anchor are not pausable (rule 3) |
| Stall the queue with a commitment that can't be settled | Settle makes no fallible external calls and per-commitment work is capped |
| Hedera changes block or hash semantics | Commit-time checks stop new stakes; anchor rejects degenerate hashes; continuity (`hash(T-2) == prevHash`) detects renumbering, which voids and refunds instead of resolving against a different block (rule 8); commits are paused around scheduled upgrades |
| Learn the target hash before settle (nodes and mirror watchers see it within seconds) and act on it | No action is left to take: no cancel, no refund on expiry, no transfer of pending commitments, and the settle order is fixed (rules 1, 5, 6) |

## Open decisions (owner)

1. **Keeper**: run a settle/anchor bot (recommended; it could live with lazy-dapp-v3's backend or as a small worker), or have the player sign a second transaction.
2. **Expiry**: forfeit (recommended; with the keeper and anchoring it should never happen to an honest player) versus anything softer. Anything softer has to be argued against rule 5.
3. **Drop the caller checks** in the new contracts (recommended) or keep them as policy.
4. **TradeLotto alternative**: instead of a block hash, the signer could draw the outcome and sign it, so the contract only verifies and pays. That's simpler on-chain, but players then trust the team for randomness, as they already do for odds. Default proposal: use the beacon like everything else.

## Per-contract plan

Facts below are from the 2026-10-15 draw-site map (file:line references are to that date). Nothing here is upgradeable: Missions are EIP-1167 clones and the rest are plain deployments, so every change is a new deployment.

### Design principle for every new contract: an exit ramp

The v2 migration problem (below) and the staking contract's stuck NFTs come from the same gap: once users have stakes in a contract, there is no clean way to retire it. Every contract in this round gets a **sunset path** that can't be used to take anything from players: for example, after a long, on-chain-announced grace period, the admin can void outstanding entries and refund their purchase price from the recorded proceeds, return staked NFTs to their owners, and close pools. It's designed and reviewed together with the draw.

### LazyTradeLotto v2 (not deployed; branch `feat/lazytradelotto-v2`; 16,970 bytes free)

- **Commit:** `rollLotto(...)` keeps its signed arguments: verify signature and deadline, set `history`, store the commitment (roller, signed odds and amounts, `burnExempt` snapshot of the burn rate). No PRNG.
- **Settle:** derive the regular-win roll, the amount and the jackpot roll from the seed. Update `jackpotPool` in queue order. Pay through `try lazyGasStation.payoutLazy(...)`; if it fails (LGS short, payout window full, roller not associated) record the amount as owed, payable later by `claimWinnings()`.
- **Draw state** (rule 7): `boostJackpot`, `updateMaxJackpotPool`, `updateJackpotLossIncrement`, `updateBurnPercentage` and the cap setters revert while commitments are pending.
- **Open detail:** how owed winnings interact with the 24h payout cap after a leaked-signer incident (claims honoured at the cap rate, or an owner switch to freeze claims while the key is rotated).
- Keep everything from the October review fixes (caps, deadline bound, no fallback, signed `burnExempt`). The `tx.origin` check can go.

### Mission template (not live: 0 clones on mainnet; Farms branch `fix/mission-eoa-code-delegation`; **131 bytes free**)

- **Commit:** `claimRewards()` checks the mission has ended, **returns the staked NFTs first** (the `leaveMission` body), frees the slot, reserves `nbOfRewards` from the pool count, and queues the claim. This order also closes the review's allowance and auto-association re-roll, which works today because the reverting return happens after the draw.
- **Settle:** draw the serials from the seed (one index per reward from `keccak256(seed, i)`, which fixes the "same seed every iteration" bug), and record them as owed. `collectOwedRewards` delivers them; make it bounded and skip-on-failure (per the review) so one frozen collection can't block the rest.
- **Draw state:** `addRewardSerials` is permissionless and callable mid-mission. It must revert while claims are pending (rule 7).
- **Fairness choice:** today's draw picks a collection uniformly, then a serial, which is not uniform over serials. Decide whether to keep that.
- **Size:** 131 bytes free is not enough. Candidates: drop the nine inherited permissionless HTS wrappers (a lite HTS base), the public `batch*Associate` helpers, and non-essential views. Keep the views MissionFactory and BoostManager use. Possibly move owed-reward storage and collect into a small companion contract.
- `enterMission` is unchanged. The entry fee is taken at entry and is not refundable, as today.

### ForeverMinter (not live; 4,068 bytes free)

- **Commit:** `mintNFT` keeps cost calculation, whitelist and discount use, payment (HBAR, LAZY via LGS) and sacrifice staking, refunds excess HBAR, and reserves `n` serials from `availableSerials`. It no longer draws. Today the draw happens before payment, and the excess-HBAR send after the draw (:777) is itself a re-roll point.
- **Settle:** pick serials from the seed (swap-and-pop), deliver with an owed fallback. The refund window starts at delivery.
- **Draw state:** `registerNFTs`, `addNFTsToPool` (both permissionless) and `emergencyWithdrawNFTs` revert while mints are pending.
- **Also from the map:** the refund feature is a paid re-roll by design (refund within 1h at 60%, the serial returns to the pool). Keep it or drop it deliberately. There is no way to withdraw LAZY sent to the contract.

### MinterContract (not live; 4,138 bytes free)

- **Commit:** take LAZY and HBAR, use the whitelist, refund excess, and reserve `n` metadata slots.
- **Settle:** pick metadata from the seed, mint in batches, and deliver with an owed fallback (hold the minted NFT if the player can't receive it).
- **Draw state:** `updateMetadataArray`, `addMetadata`, `resetContract`, `updateCID` revert while mints are pending; `updatePrng` disappears (no PRNG). Note that the owner can rewrite unminted metadata at any time today, which is a trust issue in itself.

### LazyLotto V3 (v2 live: `0.0.10628505`; 145 bytes free in v2)

- **Commit:** `rollBatch` / `rollAll` / `buyAndRollEntry` / `rollWithNFT` consume entries (or wipe tickets) exactly as today, snapshot the boost (`calculateBoost` is read at commit, as now), and queue `(player, pool, count, winRate+boost)`. Cap entries per commitment.
- **Settle:** per entry, `won = roll < winRate`, and on a win select a prize by index from the pool and push it to `pending[player]`. The pending-prize and claim machinery is unchanged. When a pool runs out of prizes mid-queue, later wins in that pool are void, as today. Decide whether to refund or record that instead.
- **Draw state:** `addPrizePackage` and `addMultipleFungiblePrizes` revert while that pool has pending commitments. A per-pool counter is enough, since prize lists are per pool.
- **Size:** v2 has 145 bytes free and V3 adds a queue and settle. Measured savings available: NFT-ticket mode (4,228 bytes, could move to a companion contract), pool and prize creation (3,195), treasury and proceeds (2,201), views (2,141). The beacon keeps the hash logic out.
- **V3 needs new LazyLottoStorage and LazyLottoPoolManager.** Both bind to one LazyLotto, one time only, and v2's pool tokens can only be minted or wiped by v2's Storage.
- **Small fix while there:** v2's `pause()` doesn't block `createPool`, so community pools can still be created while paused.

### Migrating off LazyLotto v2 (the hard part)

The admin **cannot** refund or cancel entries, wipe tickets, roll for users, or reclaim pending prizes. `closePool` needs zero outstanding entries **and** zero pool-token supply, and prizes leave an open pool only through wins. State on 2026-10-15:

| Pool | Prizes | Unrolled entries | Pool-token NFTs |
|---|---|---|---|
| 0 (20%, 10 HBAR) | 51 | 6 | 0 |
| 1 (6%, 50 HBAR) | 38 | 0 | 0 |
| 2 (15%, 150 LAZY) | 335 | 6 | 37 |
| 3 (7.5%, 25,000 LAZY) | 46 | 2 | 6 |
| 4 (15%, 10 HBAR) | 175 | 13 | 2 |

About 4,500 HBAR of prize inventory sits in v2 Storage. **Only pool 1 can be closed today.** Pool 2 is chained:
- its unrolled entries and the one user-held ticket have to be rolled;
- 20 prize NFTs (held by one account) have to be claimed;
- 16 pool-2 tickets held in Storage as prizes of pools 0 and 1 must be won and claimed, then wiped through `rollWithNFT`.

Practical path:

1. **Stop new sales:** pool-level pause on each pool. This blocks buying but not rolling.
2. **Keep the contract unpaused,** so existing holders can still roll their entries and tickets and claim.
3. **Ask the 11 accounts** holding unrolled entries and the ticket holders to roll, perhaps with a V3 bonus as an incentive.
4. **Close pools as they empty,** then `removePrizes` to recover inventory for V3.
5. **Accept that any prize inventory behind a holder who never acts stays locked,** unless pools sell out through wins.

**This is why V3's sunset path matters.**

### Out of scope, noted by the map

- **EditionWithPrize.selectWinner** (hedera-SC-minter, ships in npm `@lazysuperheroes/hedera-minter-contracts@1.0.2`): permissionless, no guard, seeds from `blockhash(n-1)` + PRNG; grindable for free through a reverting contract. No Lazy deployment found. Fix in the package or document it before anyone uses it.
- **SoulboundMinter:** metadata draw with no guard; low value (frozen on mint), no deployment found.
- **Legacy LazyLotto v1** `0.0.10584509`: dormant (all pools paused or closed, 0 prizes, not an LGS user). It only becomes a draw site again if someone adds prizes.
- **BoostManager, LazySecureTrade, staking:** no draws.

## Validation plan

- **Local (Hardhat):**
  - commit/settle unit tests;
  - adversarial tests: a wrapper contract that commits then tries to compute or observe the outcome (it can't), and one that settles then reverts (outcome unchanged);
  - expiry with `hardhat_mine(300)`; FIFO under interleaved commits; the draw-state lock; the gas bound per commitment;
  - the renumbering voids, simulated with a mock beacon.
- **Testnet, required before mainnet.** A probe contract transaction that logs `NUMBER`, `BLOCKHASH` at N, N+1, N-1, N-256 and N-257, `TIMESTAMP`, PREVRANDAO and 0x169 called twice. Expected values:
  - 0 for N and N+1;
  - N-1 equal to the mirror's `hash[0:32]`;
  - **N-256 non-zero on consensus nodes** (the mirror simulation returns 0 there);
  - N-257 = 0.

  Then:
  - the probe inside an atomic batch and other child transactions (same `NUMBER` and seed?);
  - settle boundaries at exactly T, T+1 and T+254 to T+257;
  - relay `eth_estimateGas` for commit and settle;
  - an end-to-end commit → keeper anchor → settle round trip.
- **Re-run the probe right after the testnet block-stream cutover (25 Nov 2026)**, before mainnet's (9 Dec 2026). Check:
  - no `NUMBER` jump;
  - pre-cutover hashes unchanged;
  - post-cutover hash equal to the mirror's block hash;
  - digest still SHA-384 (an open PR would allow switching to SHA-256).
- **Review:** an adversarial multi-agent pass over the beacon and each consumer before any deploy.
