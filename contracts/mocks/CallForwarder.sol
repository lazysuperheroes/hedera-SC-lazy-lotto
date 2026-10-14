// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;

/// @title CallForwarder — test-only contract caller
/// @author security review harness (NOT for production use)
/// @notice Forwards arbitrary calldata to a target and bubbles up its revert data, so tests can
///         prove that EOA-only entry points (e.g. LazyTradeLotto.rollLotto) reject contract callers
///         with their own custom error rather than a generic failure.
contract CallForwarder {
    function forward(
        address target,
        bytes calldata data
    ) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }
}
