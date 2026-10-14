// SPDX-License-Identifier: ISC
pragma solidity >=0.8.12 <0.9.0;

/// @title LazyTradeLotto
/// @author stowerling.eth / stowerling.hbar
/// @notice This contract is a decentralized lotto system to reward users for using the Lazy Secure Trade platform.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IPrngSystemContract} from "./interfaces/IPrngSystemContract.sol";
import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";

contract LazyTradeLotto is Ownable, ReentrancyGuard, Pausable {
    using Address for address;

    event LottoRoll(
        address indexed _user,
        address indexed _token,
        uint256 _serial,
        uint256 _nonce,
        bool _buyer,
        uint256 _winRateThreshold,
        uint256 _winRoll,
        uint256 _minWinAmt,
        uint256 _maxWinAmt,
        uint256 _winAmount,
        uint256 _jackpotThreshold,
        uint256 _jackpotRoll
    );

    event JackpotWin(
        address indexed _user,
        uint256 _jackpotThreshold,
        uint256 _jackpotRoll,
        uint256 _jackpotAmt
    );

    event JackpotUpdate(uint256 _amount);

    event ContractUpdate(
        string _functionName,
        address _sender,
        uint256 _amount,
        string _message
    );

    error InvalidUserSignature();
    error InvalidTeamSignature();
    error BadArguments(string message);
    error AlreadyRolled();
    error SignatureExpired();
    error OnlyEOA();
    error PayoutCapReached();

    /// @notice Mapping to track rolls that have been made to prevent replay attacks
    /// @dev Maps hash of transaction details to a boolean indicating if it has been processed
    mapping(bytes32 => bool) public history;

    /// @notice Maximum possible threshold for winning (100%)
    /// @dev Expressed as integer from 0-100,000,000 where 100,000,000 represents 100%
    uint256 public constant MAX_WIN_RATE_THRESHOLD = 100_000_000;

    /// @notice Length of the payout window that payoutWindowCap applies to
    uint256 public constant PAYOUT_WINDOW = 1 days;

    /// @notice Interface to the PRNG system contract for random number generation
    IPrngSystemContract public prngSystemContract;
    /// @notice Interface to the Lazy Gas Station contract for token payouts
    ILazyGasStation public lazyGasStation;

    /// @notice Address of the wallet that signs transaction parameters
    address public systemWallet;

    /// @notice Current amount in the jackpot pool
    uint256 public jackpotPool;
    /// @notice Maximum threshold for the jackpot pool
    uint256 public maxJackpotPool;
    /// @notice Total number of jackpots won
    uint256 public jackpotsWon;
    /// @notice Total amount paid out in jackpots
    uint256 public jackpotPaid;
    /// @notice Total number of lotto rolls
    uint256 public totalRolls;
    /// @notice Total number of regular wins
    uint256 public totalWins;
    /// @notice Total amount paid out in regular wins (excluding jackpots)
    uint256 public totalPaid;
    /// @notice Amount to increment the jackpot by on each roll
    uint256 public lottoLossIncrement;

    /// @notice Percentage of winnings to burn unless the signed roll is burn-exempt
    uint256 public burnPercentage;

    /// @notice Upper bound on the signed maxWinAmt of any roll
    /// @dev Bounds what a leaked or buggy systemWallet signer can pay out per regular win
    uint256 public maxWinAmtCap;

    /// @notice Most $LAZY (regular wins + jackpots) payable within one PAYOUT_WINDOW
    /// @dev Bounds total loss from a leaked signer, which could otherwise roll repeatedly at
    ///      maxWinAmtCap each; rolls that would exceed it revert until the window resets
    uint256 public payoutWindowCap;
    /// @notice Start of the current payout window (resets on the first payout after it ends)
    uint256 public payoutWindowStart;
    /// @notice Amount paid out in the current payout window
    uint256 public payoutWindowPaid;

    /// @notice When true, rolls also require msg.sender to have no code
    /// @dev Off by default. HIP-1340 (EIP-7702) delegated EOAs pass tx.origin == msg.sender but
    ///      report a delegation indicator as code; enable once that is validated on testnet.
    bool public requireCodelessCaller;

    /**
     * @notice Initialize the LazyTradeLotto contract with required parameters
     * @dev Sets up all necessary references and initial values
     * @param _prngSystemContract Address of the PRNG system contract for random number generation
     * @param _lazyGasStation Address of the Lazy Gas Station for token payouts
     * @param _systemWallet Address of the wallet that signs transaction parameters
     * @param _initialJackpot Initial amount in the jackpot pool
     * @param _lottoLossIncrement Amount to increment the jackpot by on each roll
     * @param _burnPercentage Percentage of winnings to burn unless the roll is burn-exempt
     * @param _maxWinAmtCap Upper bound on the signed maxWinAmt of any roll
     * @param _payoutWindowCap Most $LAZY payable within one PAYOUT_WINDOW
     */
    constructor(
        address _prngSystemContract,
        address _lazyGasStation,
        address _systemWallet,
        uint256 _initialJackpot,
        uint256 _lottoLossIncrement,
        uint256 _burnPercentage,
        uint256 _maxWinAmtCap,
        uint256 _payoutWindowCap
    ) {
        if (
            !_prngSystemContract.isContract() ||
            _prngSystemContract == address(0)
        ) {
            revert BadArguments("PRNG Contract");
        }
        if (!_lazyGasStation.isContract() || _lazyGasStation == address(0)) {
            revert BadArguments("Lazy Gas Station");
        }
        if (_systemWallet == address(0)) {
            revert BadArguments("System Wallet");
        }
        if (_maxWinAmtCap == 0) {
            revert BadArguments("Max Win Cap");
        }
        if (_payoutWindowCap == 0) {
            revert BadArguments("Payout Window Cap");
        }

        prngSystemContract = IPrngSystemContract(_prngSystemContract);
        lazyGasStation = ILazyGasStation(_lazyGasStation);
        systemWallet = _systemWallet;

        jackpotPool = _initialJackpot;
        lottoLossIncrement = _lottoLossIncrement;
        burnPercentage = _burnPercentage;
        maxWinAmtCap = _maxWinAmtCap;
        payoutWindowCap = _payoutWindowCap;

        // Default maximum jackpot pool to 500,000
        maxJackpotPool = 500_000; // Assuming LAZY_DECIMAL is 1

        // Initialize as paused by default for safety
        _pause();
    }

    /**
     * @notice Executes a lotto roll for a trade with potential for regular win and jackpot
     * @dev Can be called by both buyer and seller but only once each per trade
     * @param token The address of the NFT token contract involved in the trade
     * @param serial The token ID/serial of the NFT involved in the trade
     * @param nonce A unique number for this trade to prevent replay attacks
     * @param buyer Whether the caller is the buyer (true) or seller (false)
     * @param winRateThreshold Threshold for winning a regular prize (0-100,000,000)
     * @param minWinAmt Minimum amount that can be won in a regular win
     * @param maxWinAmt Maximum amount that can be won in a regular win
     * @param jackpotThreshold Threshold for winning the jackpot (0-100,000,000)
     * @param burnExempt True if the signer resolved the roller as an LSH holder / valid delegate (0% burn)
     * @param deadline Unix time (seconds) after which the signature is no longer accepted
     * @param teamSignature Signature from the system wallet validating these parameters
     */
    function rollLotto(
        address token,
        uint256 serial,
        uint256 nonce,
        bool buyer,
        uint256 winRateThreshold,
        uint256 minWinAmt,
        uint256 maxWinAmt,
        uint256 jackpotThreshold,
        bool burnExempt,
        uint256 deadline,
        bytes memory teamSignature
    ) external nonReentrant whenNotPaused {
        // The outcome is drawn and paid in this transaction, so a caller able to run code after
        // it could revert a losing roll (un-setting history) and retry with a fresh PRNG seed.
        // The off-chain signer only signs for EOAs calling directly; this enforces it on-chain.
        // HIP-1340 (EIP-7702) delegated EOAs still pass tx.origin == msg.sender, so the owner can
        // additionally require codeless callers once delegation is validated on testnet.
        if (
            // solhint-disable-next-line avoid-tx-origin
            msg.sender != tx.origin ||
            (requireCodelessCaller && msg.sender.code.length != 0)
        ) {
            revert OnlyEOA();
        }

        // each trade can be rolled by both the buyer and the seller but only once
        bytes32 hash = keccak256(abi.encodePacked(token, serial, nonce, buyer));

        // design note: history (not the deadline) is the replay guard. The deadline only bounds how
        // long a signature stays usable; an unrolled ticket can be re-signed with a new deadline.

        if (history[hash]) {
            revert AlreadyRolled();
        }

        // update the history early to prevent replay attacks as good hygiene even if reentrancy guard is present
        history[hash] = true;

        // Validate parameters and signature (moved to a separate function to reduce stack usage)
        validateRollParameters(
            token,
            serial,
            nonce,
            buyer,
            winRateThreshold,
            minWinAmt,
            maxWinAmt,
            jackpotThreshold,
            burnExempt,
            deadline,
            teamSignature
        );

        uint256 burn = burnExempt ? 0 : burnPercentage;

        // Get random rolls and process the lotto roll
        uint256[] memory winRolls = prngSystemContract
            .getPseudorandomNumberArray(0, MAX_WIN_RATE_THRESHOLD, nonce, 2);

        // Check for regular win and handle prize distribution
        uint256 winAmt = processRegularWin(
            winRateThreshold,
            minWinAmt,
            maxWinAmt,
            nonce,
            winRolls[0],
            burn
        );

        // Check for jackpot win
        processJackpotWin(jackpotThreshold, winRolls[1], burn);

        // Update the stats and emit events
        totalRolls += 1;

        // log the roll
        postLottoRoll(
            token,
            serial,
            nonce,
            buyer,
            winRateThreshold,
            minWinAmt,
            maxWinAmt,
            jackpotThreshold,
            winRolls,
            winAmt
        );

        emit JackpotUpdate(jackpotPool);
    }

    /**
     * @notice Validates all parameters for a lotto roll
     * @dev Verifies parameters are valid and the signature is authentic
     * @param token The address of the NFT token contract
     * @param serial The token ID/serial of the NFT
     * @param nonce A unique number for this trade
     * @param buyer Whether the caller is the buyer or seller
     * @param winRateThreshold Threshold for winning a regular prize
     * @param minWinAmt Minimum amount that can be won
     * @param maxWinAmt Maximum amount that can be won
     * @param jackpotThreshold Threshold for winning the jackpot
     * @param burnExempt Whether the signer marked the roller as burn-exempt
     * @param deadline Unix time (seconds) after which the signature is no longer accepted
     * @param teamSignature Signature from the system wallet
     * @return bool True if all parameters are valid
     */
    function validateRollParameters(
        address token,
        uint256 serial,
        uint256 nonce,
        bool buyer,
        uint256 winRateThreshold,
        uint256 minWinAmt,
        uint256 maxWinAmt,
        uint256 jackpotThreshold,
        bool burnExempt,
        uint256 deadline,
        bytes memory teamSignature
    ) internal view returns (bool) {
        if (block.timestamp > deadline) {
            revert SignatureExpired();
        }

        // check the parameters are valid
        if (token == address(0) || serial == 0) {
            revert BadArguments("Trade Params");
        }

        if (minWinAmt > maxWinAmt || maxWinAmt == 0) {
            revert BadArguments("Win Amounts");
        }

        if (maxWinAmt > maxWinAmtCap) {
            revert BadArguments("Win Cap");
        }

        if (winRateThreshold > MAX_WIN_RATE_THRESHOLD) {
            revert BadArguments("Win Rate");
        }

        if (jackpotThreshold > MAX_WIN_RATE_THRESHOLD) {
            revert BadArguments("Jackpot Rate");
        }

        bytes32 ethSignedMessageHash = ECDSA.toEthSignedMessageHash(
            getRollMessageHash(
                msg.sender,
                token,
                serial,
                nonce,
                buyer,
                winRateThreshold,
                minWinAmt,
                maxWinAmt,
                jackpotThreshold,
                burnExempt,
                deadline
            )
        );

        address recoveredSigner = ECDSA.recover(
            ethSignedMessageHash,
            teamSignature
        );

        if (recoveredSigner != systemWallet) {
            revert InvalidTeamSignature();
        }

        return true;
    }

    /**
     * @notice The digest the systemWallet signs (EIP-191 personal_sign) to authorise a roll
     * @dev Binds this contract and chain so a signature cannot be replayed on another deployment
     *      or network that shares the signer key. Exposed so the off-chain signer can check its
     *      encoding against the deployed contract.
     * @param roller The address that will call rollLotto (msg.sender)
     * @param token The address of the NFT token contract
     * @param serial The token ID/serial of the NFT
     * @param nonce A unique number for this trade
     * @param buyer Whether the roller is the buyer or seller
     * @param winRateThreshold Threshold for winning a regular prize
     * @param minWinAmt Minimum amount that can be won
     * @param maxWinAmt Maximum amount that can be won
     * @param jackpotThreshold Threshold for winning the jackpot
     * @param burnExempt Whether the roller pays 0% burn (LSH holder / valid delegate, resolved off-chain)
     * @param deadline Unix time (seconds) after which the signature is no longer accepted
     * @return The keccak256 of the packed message, before the EIP-191 prefix
     */
    function getRollMessageHash(
        address roller,
        address token,
        uint256 serial,
        uint256 nonce,
        bool buyer,
        uint256 winRateThreshold,
        uint256 minWinAmt,
        uint256 maxWinAmt,
        uint256 jackpotThreshold,
        bool burnExempt,
        uint256 deadline
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    address(this),
                    block.chainid,
                    roller,
                    token,
                    serial,
                    nonce,
                    buyer,
                    winRateThreshold,
                    minWinAmt,
                    maxWinAmt,
                    jackpotThreshold,
                    burnExempt,
                    deadline
                )
            );
    }

    /**
     * @notice Processes a regular win condition and pays out if won
     * @dev Compares random roll against threshold and pays out if winner
     * @param winRateThreshold Threshold for winning (0-100,000,000)
     * @param minWinAmt Minimum amount that can be won
     * @param maxWinAmt Maximum amount that can be won
     * @param nonce The nonce used for random number generation
     * @param randomRoll The random number generated for this roll
     * @param burn The burn percentage to apply to the payout
     * @return winAmt The amount won (0 if no win)
     */
    function processRegularWin(
        uint256 winRateThreshold,
        uint256 minWinAmt,
        uint256 maxWinAmt,
        uint256 nonce,
        uint256 randomRoll,
        uint256 burn
    ) private returns (uint256 winAmt) {
        winAmt = 0;
        if (winRateThreshold >= randomRoll) {
            // we have a winner!
            winAmt = prngSystemContract.getPseudorandomNumber(
                minWinAmt,
                maxWinAmt,
                maxWinAmt + nonce
            );

            // pay the winner
            recordPayout(winAmt);
            lazyGasStation.payoutLazy(msg.sender, winAmt, burn);

            totalWins += 1;
            totalPaid += winAmt;
        }
        return winAmt;
    }

    /**
     * @notice Processes a jackpot win condition and pays out if won
     * @dev Compares random roll against threshold and pays out if jackpot winner
     * @param jackpotThreshold Threshold for winning the jackpot (0-100,000,000)
     * @param randomRoll The random number generated for this roll
     * @param burn The burn percentage to apply to the payout
     */
    function processJackpotWin(
        uint256 jackpotThreshold,
        uint256 randomRoll,
        uint256 burn
    ) private {
        if (jackpotThreshold >= randomRoll) {
            // we have a jackpot winner!
            uint256 jackpotAmt = jackpotPool;

            // pay the jackpot winner
            recordPayout(jackpotAmt);
            lazyGasStation.payoutLazy(msg.sender, jackpotAmt, burn);

            // update the jackpot stats
            jackpotPool = 0;
            jackpotsWon += 1;
            jackpotPaid += jackpotAmt;

            emit JackpotWin(
                msg.sender,
                jackpotThreshold,
                randomRoll,
                jackpotAmt
            );
        }

        // update the jackpot pool
        // ensures there is always some amount in the jackpot pool to give out
        // nobody is excited by a 0 jackpot!
        jackpotPool += lottoLossIncrement;

        // Ensure jackpot pool does not exceed the maximum threshold
        if (jackpotPool > maxJackpotPool) {
            jackpotPool = maxJackpotPool;
        }
    }

    /**
     * @notice Counts a payout against the current payout window, starting a new window if the
     *         previous one has ended
     * @dev Reverts PayoutCapReached if the window total would exceed payoutWindowCap. That reverts
     *      the whole roll (the ticket can be rolled again once the window resets), which is the
     *      intended circuit-breaker behaviour: set the cap well above normal daily payouts.
     * @param amount The gross payout (before burn)
     */
    function recordPayout(uint256 amount) private {
        if (block.timestamp >= payoutWindowStart + PAYOUT_WINDOW) {
            payoutWindowStart = block.timestamp;
            payoutWindowPaid = 0;
        }
        payoutWindowPaid += amount;
        if (payoutWindowPaid > payoutWindowCap) {
            revert PayoutCapReached();
        }
    }

    /**
     * @notice The current payout window and how much can still be paid in it
     * @return start Start of the current window (0 before the first payout)
     * @return paid Amount paid in the current window
     * @return cap The window cap
     * @return remaining Amount still payable before PayoutCapReached
     */
    function getPayoutWindow()
        external
        view
        returns (uint256 start, uint256 paid, uint256 cap, uint256 remaining)
    {
        cap = payoutWindowCap;
        if (block.timestamp >= payoutWindowStart + PAYOUT_WINDOW) {
            // the next payout starts a fresh window
            return (payoutWindowStart, 0, cap, cap);
        }
        start = payoutWindowStart;
        paid = payoutWindowPaid;
        remaining = paid >= cap ? 0 : cap - paid;
    }

    /**
     * @notice Increases the jackpot pool by a specified amount, up to maxJackpotPool
     * @dev Can only be called by the contract owner. Emits the new pool total, like rollLotto.
     * @param amount The amount to add to the jackpot pool
     */
    function boostJackpot(uint256 amount) external onlyOwner {
        jackpotPool += amount;
        if (jackpotPool > maxJackpotPool) {
            jackpotPool = maxJackpotPool;
        }

        emit JackpotUpdate(jackpotPool);
    }

    /**
     * @notice Updates the upper bound on the signed maxWinAmt of any roll
     * @dev Can only be called by the contract owner
     * @param cap The new cap (must be non-zero)
     */
    function updateMaxWinAmtCap(uint256 cap) external onlyOwner {
        if (cap == 0) {
            revert BadArguments("Max Win Cap");
        }
        maxWinAmtCap = cap;

        emit ContractUpdate("MaxWinAmtCap", msg.sender, cap, "Updated");
    }

    /**
     * @notice Updates the most $LAZY payable within one PAYOUT_WINDOW
     * @dev Can only be called by the contract owner
     * @param cap The new window cap (must be non-zero)
     */
    function updatePayoutWindowCap(uint256 cap) external onlyOwner {
        if (cap == 0) {
            revert BadArguments("Payout Window Cap");
        }
        payoutWindowCap = cap;

        emit ContractUpdate("PayoutWindowCap", msg.sender, cap, "Updated");
    }

    /**
     * @notice Requires (or stops requiring) roll callers to have no code
     * @dev Can only be called by the contract owner. Enable once HIP-1340 code delegation is live
     *      and validated on testnet: delegated EOAs report a delegation indicator as code.
     * @param enabled True to reject callers whose address has code
     */
    function setRequireCodelessCaller(bool enabled) external onlyOwner {
        requireCodelessCaller = enabled;

        emit ContractUpdate(
            "RequireCodelessCaller",
            msg.sender,
            enabled ? 1 : 0,
            "Updated"
        );
    }

    /**
     * @notice Updates the amount added to the jackpot pool after each roll
     * @dev Can only be called by the contract owner
     * @param increment The new jackpot loss increment value
     */
    function updateJackpotLossIncrement(uint256 increment) external onlyOwner {
        lottoLossIncrement = increment;

        emit ContractUpdate(
            "JackpotLossIncrement",
            msg.sender,
            increment,
            "Updated"
        );
    }

    /**
     * @notice Updates the maximum threshold for the jackpot pool
     * @dev Can only be called by the contract owner
     * @param maxThreshold The new maximum jackpot threshold
     */
    function updateMaxJackpotPool(uint256 maxThreshold) external onlyOwner {
        maxJackpotPool = maxThreshold;

        emit ContractUpdate(
            "MaxJackpotPool",
            msg.sender,
            maxThreshold,
            "Updated"
        );
    }

    /**
     * @notice Updates the burn percentage applied to non-NFT holders
     * @dev Can only be called by the contract owner
     * @param percentage The new burn percentage (0-100)
     */
    function updateBurnPercentage(uint256 percentage) external onlyOwner {
        burnPercentage = percentage;

        emit ContractUpdate(
            "BurnPercentage",
            msg.sender,
            percentage,
            "Updated"
        );
    }

    /**
     * @notice Updates the system wallet address used for validating signatures
     * @dev Can only be called by the contract owner
     * @param newWallet The address of the new system wallet
     */
    function updateSystemWallet(address newWallet) external onlyOwner {
        systemWallet = newWallet;

        emit ContractUpdate("SystemWallet", msg.sender, 0, "Updated");
    }

    /**
     * @notice Emits a LottoRoll event with all roll details
     * @dev Called internally after processing a roll
     * @param token The address of the NFT token contract
     * @param serial The token ID/serial of the NFT
     * @param nonce The unique nonce for this roll
     * @param buyer Whether the roller was the buyer or seller
     * @param winRateThreshold The threshold for winning
     * @param minWinAmt Minimum win amount
     * @param maxWinAmt Maximum win amount
     * @param jackpotThreshold Threshold for jackpot win
     * @param winRolls Array of random numbers generated for this roll
     * @param winAmt The amount won (0 if no win)
     */
    function postLottoRoll(
        address token,
        uint256 serial,
        uint256 nonce,
        bool buyer,
        uint256 winRateThreshold,
        uint256 minWinAmt,
        uint256 maxWinAmt,
        uint256 jackpotThreshold,
        uint256[] memory winRolls,
        uint256 winAmt
    ) internal {
        emit LottoRoll(
            msg.sender,
            token,
            serial,
            nonce,
            buyer,
            winRateThreshold,
            winRolls[0],
            minWinAmt,
            maxWinAmt,
            winAmt,
            jackpotThreshold,
            winRolls[1]
        );
    }

    /***
     * @notice Get the current jackpot pool and stats in one call
     * @dev This is a view function that returns the current jackpot pool and stats
     * @return _jackpotPool the current jackpot pool
     * @return _jackpotsWon the total number of jackpots won
     * @return _jackpotPaid the total amount of jackpots paid out
     * @return _totalRolls the total number of rolls
     * @return _totalWins the total number of wins
     * @return _totalPaid the total amount paid out
     * @return _lottoLossIncrement the current jackpot loss increment
     * @return _maxJackpotPool the maximum jackpot pool threshold
     */
    function getLottoStats()
        external
        view
        returns (
            uint256 _jackpotPool,
            uint256 _jackpotsWon,
            uint256 _jackpotPaid,
            uint256 _totalRolls,
            uint256 _totalWins,
            uint256 _totalPaid,
            uint256 _lottoLossIncrement,
            uint256 _maxJackpotPool
        )
    {
        return (
            jackpotPool,
            jackpotsWon,
            jackpotPaid,
            totalRolls,
            totalWins,
            totalPaid,
            lottoLossIncrement,
            maxJackpotPool
        );
    }

    /**
     * @notice Pauses the contract to prevent any new lotto rolls
     * @dev Can only be called by the contract owner
     */
    function pause() external onlyOwner {
        _pause();
        emit ContractUpdate("Pause", msg.sender, 0, "Contract Paused");
    }

    /**
     * @notice Unpauses the contract to allow lotto rolls
     * @dev Can only be called by the contract owner
     */
    function unpause() external onlyOwner {
        _unpause();
        emit ContractUpdate("Unpause", msg.sender, 0, "Contract Unpaused");
    }

    /**
     * @notice Checks if the contract is currently paused
     * @return bool True if the contract is paused, false otherwise
     */
    function isPaused() external view returns (bool) {
        return paused();
    }

    /***
     * @notice Remove Hbar from the contract
     * Used on sunset to avoid trapped collateral
     * **ONLY OWNER**
     * @param receiverAddress the address to send the Hbar to
     * @param amount the amount of Hbar to send
     */
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyOwner {
        if (receiverAddress == address(0)) {
            revert BadArguments("Address");
        } else if (amount == 0) {
            revert BadArguments("Amount");
        }

        Address.sendValue(receiverAddress, amount);
    }

    /**
     * @notice Default function to receive HBAR
     * @dev Triggered when HBAR is sent to the contract
     */
    receive() external payable {
        emit ContractUpdate("Receive", msg.sender, msg.value, "Received HBAR");
    }

    /**
     * @notice Fallback function that's triggered when the contract is called with non-existent functions
     * @dev Also allows receiving HBAR
     */
    fallback() external payable {
        emit ContractUpdate("Fallback", msg.sender, msg.value, "Fallback");
    }
}
