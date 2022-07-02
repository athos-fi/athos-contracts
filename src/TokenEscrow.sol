// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

/**
 * @title TokenEscrow
 *
 * @dev An upgradeable token escrow contract for releasing ERC20 tokens based on
 * schedule.
 */
contract TokenEscrow is OwnableUpgradeable {
    using SafeMathUpgradeable for uint256;

    event VestingScheduleAdded(
        address indexed user,
        uint256 amount,
        uint256 startTime,
        uint256 endTime,
        uint256 step
    );
    event VestingScheduleRemoved(address indexed user);
    event TokenVested(address indexed user, uint256 amount);

    /**
     * @param amount Total amount to be vested over the complete period
     * @param startTime Unix timestamp in seconds for the period start time
     * @param endTime Unix timestamp in seconds for the period end time
     * @param step Interval in seconds at which vestable amounts are accumulated
     * @param lastClaimTime Unix timestamp in seconds for the last claim time
     */
    struct VestingSchedule {
        uint128 amount;
        uint32 startTime;
        uint32 endTime;
        uint32 step;
        uint32 lastClaimTime;
    }

    IERC20Upgradeable public token;
    mapping(address => VestingSchedule) public vestingSchedules;

    function getWithdrawableAmount(address user)
        external
        view
        returns (uint256)
    {
        (uint256 withdrawableFromVesting,,) =
            calculateWithdrawableFromVesting(user);

        return withdrawableFromVesting;
    }

    function __TokenEscrow_init(IERC20Upgradeable _token)
        public
        initializer
    {
        __Ownable_init();

        require(address(_token) != address(0), "TokenEscrow: zero address");
        token = _token;
    }

    function setVestingSchedule(
        address user,
        uint256 amount,
        uint256 startTime,
        uint256 endTime,
        uint256 step
    )
        external
        onlyOwner
    {
        require(user != address(0), "TokenEscrow: zero address");
        require(amount > 0, "TokenEscrow: zero amount");
        require(startTime < endTime, "TokenEscrow: invalid time range");
        require(
            step > 0 && endTime.sub(startTime) % step == 0,
            "TokenEscrow: invalid step"
        );
        require(
            vestingSchedules[user].amount == 0,
            "TokenEscrow: vesting schedule already exists"
        );

        // Overflow checks
        require(
            uint256(uint128(amount)) == amount, "TokenEscrow: amount overflow"
        );
        require(
            uint256(uint32(startTime)) == startTime,
            "TokenEscrow: startTime overflow"
        );
        require(
            uint256(uint32(endTime)) == endTime, "TokenEscrow: endTime overflow"
        );
        require(uint256(uint32(step)) == step, "TokenEscrow: step overflow");

        vestingSchedules[user] = VestingSchedule({
            amount: uint128(amount),
            startTime: uint32(startTime),
            endTime: uint32(endTime),
            step: uint32(step),
            lastClaimTime: uint32(startTime)
        });

        emit VestingScheduleAdded(user, amount, startTime, endTime, step);
    }

    function removeVestingSchedule(address user) external onlyOwner {
        require(
            vestingSchedules[user].amount != 0,
            "TokenEscrow: vesting schedule not set"
        );

        delete vestingSchedules[user];

        emit VestingScheduleRemoved(user);
    }

    function withdraw() external {
        uint256 withdrawableFromVesting;

        // Withdraw from vesting
        {
            uint256 newClaimTime;
            bool allVested;
            (withdrawableFromVesting, newClaimTime, allVested) =
                calculateWithdrawableFromVesting(msg.sender);

            if (withdrawableFromVesting > 0) {
                if (allVested) {
                    // Remove storage slot to save gas
                    delete vestingSchedules[msg.sender];
                } else {
                    vestingSchedules[msg.sender].lastClaimTime =
                        uint32(newClaimTime);
                }
            }
        }

        uint256 totalAmountToSend = withdrawableFromVesting;
        require(totalAmountToSend > 0, "TokenEscrow: nothing to withdraw");

        if (withdrawableFromVesting > 0) emit TokenVested(
            msg.sender, withdrawableFromVesting
            );

        token.transfer(msg.sender, totalAmountToSend);
    }

    function calculateWithdrawableFromVesting(address user)
        private
        view
        returns (uint256 amount, uint256 newClaimTime, bool allVested)
    {
        VestingSchedule memory vestingSchedule = vestingSchedules[user];

        if (vestingSchedule.amount == 0) return (0, 0, false);
        if (block.timestamp < uint256(vestingSchedule.startTime)) return (
            0, 0, false
        );

        uint256 currentStepTime = MathUpgradeable.min(
            block.timestamp.sub(uint256(vestingSchedule.startTime)).div(
                uint256(vestingSchedule.step)
            ).mul(uint256(vestingSchedule.step)).add(uint256(vestingSchedule.startTime)),
            uint256(vestingSchedule.endTime)
        );

        if (currentStepTime <= uint256(vestingSchedule.lastClaimTime)) return (
            0, 0, false
        );

        uint256 totalSteps = uint256(vestingSchedule.endTime).sub(
            uint256(vestingSchedule.startTime)
        ).div(vestingSchedule.step);

        if (currentStepTime == uint256(vestingSchedule.endTime)) {
            // All vested

            uint256 stepsVested = uint256(vestingSchedule.lastClaimTime).sub(
                uint256(vestingSchedule.startTime)
            ).div(vestingSchedule.step);
            uint256 amountToVest = uint256(vestingSchedule.amount).sub(
                uint256(vestingSchedule.amount).div(totalSteps).mul(stepsVested)
            );

            return (amountToVest, currentStepTime, true);
        } else {
            // Partially vested
            uint256 stepsToVest = currentStepTime.sub(
                uint256(vestingSchedule.lastClaimTime)
            ).div(vestingSchedule.step);
            uint256 amountToVest =
                uint256(vestingSchedule.amount).div(totalSteps).mul(stepsToVest);

            return (amountToVest, currentStepTime, false);
        }
    }
}
