# LazyTradeLotto v2 — Ship Checklist

Everything needed to take LazyTradeLotto v2 from branch `feat/lazytradelotto-v2` to live on mainnet, across the three repos.

> **Blocked on the two-stage redesign (2026-10-15).** The multi-agent review concluded that caller checks can't keep up with new network features that let code run around a same-transaction draw. The decision is to move every Lazy draw to commit → settle before shipping, so v2's `rollLotto` will change shape. The items below that concern signing, units, caps, the resolver and lazy-trade's ticket handling all still apply; the client flow and error mapping will be revised with the redesign. Signer/client details are in [LazyTradeLotto-V2_SIGNER_GUIDE.md](./LazyTradeLotto-V2_SIGNER_GUIDE.md). For how this fits the wider hardening work (Mission template, minters, LazyLotto V3), see `LAZY_HARDENING_ROADMAP.md` (branch `chore/abi-refresh-and-hardening-roadmap` until merged).

## Done

- [x] v1 `0.0.9109659` removed from LazyGasStation `0.0.7221483` contract users (2026-10-14, tx `0.0.6284762@1792011961.147310417`). It stays paused and never rolled.
- [x] v2 contract: deadline, contract + chain binding, `maxWinAmtCap`, 24h `payoutWindowCap`, signed `burnExempt` (no on-chain LSH / delegate-registry reads), `tx.origin` guard + owner switch `setRequireCodelessCaller` for HIP-1340, `boostJackpot` clamp, `getRollMessageHash`, `getPayoutWindow`. Validated on a local EVM (13 checks, including a simulated EIP-7702 delegated EOA).
- [x] Reference burn-exemption resolver `queries/getUserBurn.js`, checked against mainnet accounts (holder, non-holder, staker with a valid delegation).
- [x] Signer/frontend migration guide and test vector.
- [x] Review fixes (2026-10-15): `payoutWindowCap ≥ maxJackpotPool + maxWinAmtCap` enforced in the constructor and all three setters; `updateMaxJackpotPool` and the constructor clamp the pool; `burnPercentage ≤ 100`; `deadline ≤ now + 1h`; non-zero `systemWallet`; no `fallback()`; `getPayoutWindow` returns start 0 once a window has ended. Local EVM check: 20 passing. Resolver now fails closed, chunks validity checks, skips burned serials and resolves ECDSA aliases; the test scripts sign for the alias; deploy/admin scripts pre-check the cap rule; `lazyLottoDeployAll` refuses to reuse a pre-v2 contract.

## 1. hedera-SC-lazy-lotto

- [ ] Run the suite on testnet: `ENVIRONMENT=test npm run test-trade-lotto`.
- [ ] Commit / PR `feat/lazytradelotto-v2`.
- [ ] Choose `LOTTO_MAX_WIN_CAP` (whole $LAZY): at least the largest **reachable sum** of `maxWin` across the bonus flags a single ticket can have true (a ticket's `maxWinAmount` is that sum), not the largest single row. Guide §1.
- [ ] Choose `LOTTO_PAYOUT_WINDOW_CAP` (whole $LAZY per 24h): well above normal daily payouts, and at least `maxJackpotPool` (50,000 by default) + `LOTTO_MAX_WIN_CAP`; the contract enforces it. It is the circuit breaker for a leaked signer key. To keep a tighter daily cap, lower `maxJackpotPool` first (`admin/updateMaxJackpotThreshold.js`).
- [ ] PRNG: `PRNG_CONTRACT_ID` must be the inclusive wrapper `0.0.10583667` (used by LazyLotto v2 and Farms). The older `0.0.8257116` never returns its upper bound, so `maxWinAmt` would never be paid. (Moot if the two-stage redesign drops the PRNG.)
- [ ] If deploying with `lazyLottoDeployAll.js --include-trade-lotto`, clear `LAZY_TRADE_LOTTO_CONTRACT_ID` first (it now refuses to reuse a pre-v2 contract).
- [ ] Generate a **new mainnet signing key**, not shared with testnet (audit TL-02). Its address becomes `systemWallet`.
- [ ] Testnet: deploy v2 → `LazyGasStation/addContractUser.js` → `testing/rollLottoTest.js` and `testing/simulateTrade.js` end to end (`--burnExempt true|false`).
- [ ] Mainnet: deploy v2 (starts paused; the deploy script adds it to LGS `0.0.7221483`, run `addContractUser.js 0.0.<v2>` only if that step failed) → `deployments/verifySigningKey.js` → `queries/getLottoInfo.js` (caps, payout window, jackpot, connections).
- [ ] Unpause only after lazy-trade (section 2) is live.
- [x] Stale `LazyLotto` / `LazyLottoPoolManager` ABIs regenerated and `checkBatchRerolls.js` committed, on branch `chore/abi-refresh-and-hardening-roadmap` (merge it to `main`).

## 2. lazy-trade

- [ ] **Fix the ticket `contractId` mismatch (likely why v1 never rolled).** The scanner writes tickets with `contractId = LAZY_TRADE_SC` (`0.0.8051302`, `utils/secureTradeLottoScanner.ts:18`, `:257`, `:281`), but `getLottoTickets` / `getLottoTicket` only read rows with `contractId = LAZY_TRADE_LOTTO` (`services/lazyTradeLotto.ts:88`, `:128`). Check the Directus `TradeLottoFaucet` rows, then make reader and writer agree. Keying tickets by the trade source (`LAZY_TRADE_SC`) means a future lotto redeploy won't strand unrolled tickets: the on-chain `history` is per lotto contract, so a ticket never rolled on v1 can be rolled on v2.
- [ ] **Before re-keying, make completion authoritative (double-payout risk).** Today the contractId filter accidentally keeps tickets per contract; the only "done" mark is the client's best-effort `lotto.complete`. Once tickets survive a redeploy, any ticket rolled on an older contract but left `complete = false` (skipped, or the complete call failed) becomes signable and payable again on the new one. Before signing, read `history(keccak256(abi.encodePacked(token, serial, nonce, buyer)))` on the current lotto **and every previous lotto contract ID** kept in config; if any is `true`, mark the ticket complete server-side and refuse to sign. Also give the complete auth token a longer life than the roll deadline (Guide §3).
- [ ] **Odds table:** `getWinRates` filters `LazyLottoOdds` by the lotto `contractId` (`services/lazyTradeLotto.ts:493`). Publish odds rows for the v2 contract ID (or re-key them like tickets).
- [ ] **Units:** sign odds and amounts in contract units (rates out of 1e8, amounts in base units), never the display-scaled values `getWinRates` produces today; assert integers and caps before signing; the client passes the signed values verbatim. Guide §1 "Units".
- [ ] **Burn-exemption resolver:** port `resolveBurnExempt` (direct LSH holdings + valid delegations via `getSerialsDelegatedTo` / `checkNFTDelegationIsValidBatch`, alias and long-zero addresses), including chunks of ≤ 40, skipping burned serials, no `getSerialsDelegatedToRange` paging, and failing closed on mirror errors. Guide §2.
- [ ] **Roller address:** `services/resolveEVMAddress.ts` must not cache its long-zero fallback after a mirror error; retry, then refuse to sign. Guide §2.
- [ ] **`verifyRollTxOnChain`:** confirm the roll via `history(...)` (or a `LottoRoll` log for the ticket), not just a successful call to the contract. Guide §4.
- [ ] Signer: new message format with `burnExempt` and `deadline` in `services/lottoSigning.ts` `generateSignedTicketHash`; roll mutation returns both (`server/api/routers/lotto.ts`). Guide §1, §3.
- [ ] Client: `rollLotto` passes `burnExempt`, `deadline` before the signature (`services/lazyTradeLotto.ts`). Guide §4.
- [ ] Replace `lib/abi/LazyTradeLotto.json` with this repo's `abi/LazyTradeLotto.json`.
- [ ] Self-checks: digest parity via `getRollMessageHash`, refuse tickets above `maxWinAmtCap`, refuse rollers with a real code delegation (`delegation_address` a non-zero 20-byte address; absent / `null` / `0x` mean none). Guide §5–6.
- [ ] Monitoring: alert when `getPayoutWindow()` remaining runs low. Guide §5.
- [ ] Map the new reverts in the UI (`SignatureExpired`, `PayoutCapReached`, `OnlyEOA`, `BadArguments("Win Cap")`, `BadArguments("Deadline")`, OpenZeppelin `Error("ECDSA: invalid signature…")`). Guide §4.
- [ ] Tests: add the guide's test vector to `services/__tests__/lottoSigning.test.ts`; update `server/api/routers/__tests__/lotto.test.ts`.
- [ ] Set `PRIVATE_LAZY_LOTTO_SIGNING_KEY` to the new mainnet key.
- [ ] `config/addresses.ts`: mainnet default `LAZY_TRADE_LOTTO` `0.0.9109659` → v2 (line 60); testnet default `0.0.9339847` → testnet v2 (line 407); set `NEXT_PUBLIC_LAZY_TRADE_LOTTO_CONTRACT_ID` in each deployed environment.

## 3. lazy-dapp-v3

- [ ] `src/config/addresses.ts:59`: mainnet default `LAZY_TRADE_LOTTO` `0.0.9109659` → v2 (and the env var).
- [ ] No event-parser change needed: `LottoRoll` / `JackpotWin` / `JackpotUpdate` signatures are unchanged, and `checkLazyEvents.ts` already shows `JackpotUpdate` as the pool total, which v2's `boostJackpot` now matches.
- [ ] `docs/plans/MAINNET_LAUNCH_PLAN.md`: update the Trade Lotto ID (line 50) and the LGS contract-user list (line 88). v1 was removed 2026-10-14.

## 4. After HIP-1340 reaches testnet

- [ ] On a testnet v2, confirm a delegated account reports code (EXTCODESIZE 23) and is rejected with `setRequireCodelessCaller` on, while plain accounts still roll.
- [ ] Mainnet: `admin/setRequireCodelessCaller.js 0.0.<v2> on`. No redeploy. LazyLotto V3 still needs its own redeploy.

## Still open (accepted for v2)

| Item | Risk | Handling |
|---|---|---|
| TL-01 non-finality | If LGS can't pay, or a win hits the 24h cap, the roll reverts and the ticket re-arms with fresh randomness. Atomic batches can't be used to do this on purpose (network rule: one EVM transaction per batch, placed last), but the `tx.origin` check isn't what stops them | Superseded by the two-stage redesign (outcome fixed by a later block, so a revert can't re-roll). Until then: keep LGS well above `maxJackpotPool + maxWinAmtCap` (it holds about 13.5M LAZY) and size the 24h cap so it only trips under abuse |
| Fixed 24h windows | Up to 2× the cap can pay out across a window boundary | Accepted; set the cap with that in mind |
| Signer trusted for `burnExempt` | A leaked key can also sign 0% burn | Bounded by both caps; same trust as odds and amounts |
