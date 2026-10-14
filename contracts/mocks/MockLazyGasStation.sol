// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;

/// @title MockLazyGasStation — test-only payout recorder
/// @author security review harness (NOT for production use)
/// @notice Stands in for LazyGasStation.payoutLazy so LazyTradeLotto win paths (burn rate, payout
///         window cap) can be exercised on a plain EVM. Records each call instead of moving tokens.
contract MockLazyGasStation {
    struct Payout {
        address user;
        uint256 amount;
        uint256 burnPercentage;
    }

    Payout[] public payouts;

    function payoutLazy(
        address _user,
        uint256 _amount,
        uint256 _burnPercentage
    ) external returns (uint256) {
        payouts.push(Payout(_user, _amount, _burnPercentage));
        return _amount - ((_amount * _burnPercentage) / 100);
    }

    function payoutCount() external view returns (uint256) {
        return payouts.length;
    }
}
