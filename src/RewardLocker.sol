// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/IAccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "./interfaces/ICollateralSystem.sol";
import "./interfaces/IRewardLocker.sol";

contract RewardLocker is IRewardLocker, OwnableUpgradeable {
    using SafeMathUpgradeable for uint256;

    event RewardEntryAdded(uint256 entryId, address user, uint256 amount, uint256 unlockTime);
    event RewardEntryRemoved(uint256 entryId);
    event RewardAmountChanged(uint256 entryId, uint256 oldAmount, uint256 newAmount);
    event RewardEntryUnlocked(uint256 entryId, address user, uint256 amount);

    /**
     * @dev The struct used to store reward data. Address is deliberately left out and put in the
     * mapping key of `rewardEntries` to minimize struct size. Struct fields are padded to 256 bits
     * to save storage space, and thus gas fees.
     */
    struct RewardEntry {
        uint216 amount;
        uint40 unlockTime;
    }

    struct MoveEntryParams {
        address from;
        address recipient1;
        uint256 amount1;
        address recipient2;
        uint256 amount2;
        uint256 rewardEntryId;
        uint256 amount1Left;
        uint256 amount2Left;
    }

    uint256 public lastRewardEntryId;
    mapping(uint256 => mapping(address => RewardEntry)) public rewardEntries;
    mapping(address => uint256) public lockedAmountByAddresses;
    uint256 public override totalLockedAmount;

    address public linaTokenAddr;
    IAccessControlUpgradeable public accessCtrl;
    address public collateralSystemAddr;
    address public rewarderAddress;

    bytes32 private constant ROLE_LOCK_REWARD = "LOCK_REWARD";
    bytes32 private constant ROLE_MOVE_REWARD = "MOVE_REWARD";

    modifier onlyLockRewardRole() {
        require(accessCtrl.hasRole(ROLE_LOCK_REWARD, msg.sender), "RewardLocker: not LOCK_REWARD role");
        _;
    }

    modifier onlyMoveRewardRole() {
        require(accessCtrl.hasRole(ROLE_MOVE_REWARD, msg.sender), "RewardLocker: not MOVE_REWARD role");
        _;
    }

    function balanceOf(address user) external view override returns (uint256) {
        return lockedAmountByAddresses[user];
    }

    function __RewardLocker_init(address _linaTokenAddr, IAccessControlUpgradeable _accessCtrl) public initializer {
        __Ownable_init();

        require(_linaTokenAddr != address(0), "RewardLocker: zero address");
        require(address(_accessCtrl) != address(0), "RewardLocker: zero address");

        linaTokenAddr = _linaTokenAddr;
        accessCtrl = _accessCtrl;
    }

    function addReward(address user, uint256 amount, uint256 unlockTime) external override onlyLockRewardRole {
        _addReward(user, amount, unlockTime);
    }

    /**
     * @dev A temporary function for migrating reward entries in bulk from the old contract.
     * To be removed via a contract upgrade after migration.
     */
    function migrateRewards(address[] calldata users, uint256[] calldata amounts, uint256[] calldata unlockTimes)
        external
        onlyOwner
    {
        require(users.length > 0, "RewardLocker: empty array");
        require(users.length == amounts.length && amounts.length == unlockTimes.length, "RewardLocker: length mismatch");

        for (uint256 ind = 0; ind < users.length; ind++) {
            _addReward(users[ind], amounts[ind], unlockTimes[ind]);
        }
    }

    function moveReward(address from, address recipient, uint256 amount, uint256[] calldata rewardEntryIds)
        external
        override
        onlyMoveRewardRole
    {
        _moveRewardProRata(from, recipient, amount, address(0), 0, rewardEntryIds);
    }

    function moveRewardProRata(
        address from,
        address recipient1,
        uint256 amount1,
        address recipient2,
        uint256 amount2,
        uint256[] calldata rewardEntryIds
    ) external override onlyMoveRewardRole {
        _moveRewardProRata(from, recipient1, amount1, recipient2, amount2, rewardEntryIds);
    }

    function updateCollateralSystemAddress(address _collateralSystemAddr) external onlyOwner {
        require(_collateralSystemAddr != address(0), "RewardLocker: Collateral system address must not be 0");
        collateralSystemAddr = _collateralSystemAddr;
    }

    function updateRewarderAddress(address _rewarderAddress) external onlyOwner {
        require(_rewarderAddress != address(0), "RewardLocker: Rewarder address must not be 0");
        rewarderAddress = _rewarderAddress;
    }

    function unlockReward(address user, uint256 rewardEntryId) external {
        _unlockReward(user, rewardEntryId);
    }

    function unlockRewards(address[] calldata users, uint256[] calldata rewardEntryIds) external {
        require(users.length == rewardEntryIds.length, "RewardLocker: array length mismatch");

        for (uint256 ind = 0; ind < users.length; ind++) {
            _unlockReward(users[ind], rewardEntryIds[ind]);
        }
    }

    function swapRewardEntries(
        address user,
        uint256[] calldata entriesIds,
        uint216[] calldata newAmounts,
        uint40[] calldata newUnlockTimes
    ) external onlyOwner {
        require(entriesIds.length > 0 && newAmounts.length > 0, "RewardLocker: empty array");
        require(newAmounts.length == newUnlockTimes.length, "RewardLocker: array length mismatch");

        // Removes existing entries
        uint256 totalAmount = 0;
        for (uint256 ind = 0; ind < entriesIds.length; ind++) {
            uint256 oldRewardEntryId = entriesIds[ind];
            uint216 amount = rewardEntries[oldRewardEntryId][user].amount;

            // Aborts tx instead of failing silently to expose potential bugs off chain
            require(amount > 0, "RewardLocker: entry not found");

            // No SafeMath needed since we're on 0.8.x
            totalAmount += amount;

            // No need to adjust user or global amounts since we'll make sure they stay unchangeed
            delete rewardEntries[oldRewardEntryId][user];
            emit RewardEntryRemoved(oldRewardEntryId);
        }

        // Adds new entries
        for (uint256 ind = 0; ind < newAmounts.length; ind++) {
            uint216 newAmount = newAmounts[ind];
            uint40 newUnlockTime = newUnlockTimes[ind];

            totalAmount -= uint256(newAmount);

            uint256 newRewardEntryId = lastRewardEntryId + ind + 1;

            rewardEntries[newRewardEntryId][user] = RewardEntry({amount: newAmount, unlockTime: newUnlockTime});
            emit RewardEntryAdded(newRewardEntryId, user, uint256(newAmount), uint256(newUnlockTime));
        }

        require(totalAmount == 0, "RewardLocker: total amount mismatch");

        lastRewardEntryId += newAmounts.length;
    }

    function _addReward(address user, uint256 amount, uint256 unlockTime) private {
        require(amount > 0, "RewardLocker: zero amount");

        uint216 trimmedAmount = uint216(amount);
        uint40 trimmedUnlockTime = uint40(unlockTime);
        require(uint256(trimmedAmount) == amount, "RewardLocker: reward amount overflow");
        require(uint256(trimmedUnlockTime) == unlockTime, "RewardLocker: unlock time overflow");

        lastRewardEntryId++;

        rewardEntries[lastRewardEntryId][user] = RewardEntry({amount: trimmedAmount, unlockTime: trimmedUnlockTime});
        lockedAmountByAddresses[user] = lockedAmountByAddresses[user].add(amount);
        totalLockedAmount = totalLockedAmount.add(amount);

        emit RewardEntryAdded(lastRewardEntryId, user, amount, unlockTime);
    }

    function _unlockReward(address user, uint256 rewardEntryId) private {
        require(rewarderAddress != address(0), "RewardLocker: Rewarder address not set");
        require(collateralSystemAddr != address(0), "RewardLocker: Collateral system address not set");

        RewardEntry memory rewardEntry = rewardEntries[rewardEntryId][user];
        require(rewardEntry.amount > 0, "RewardLocker: Reward entry amount is 0, no reward to unlock");
        require(block.timestamp >= rewardEntry.unlockTime, "RewardLocker: Unlock time not reached");

        if (rewarderAddress == address(this)) {
            IERC20Upgradeable(linaTokenAddr).approve(collateralSystemAddr, rewardEntry.amount);
        }

        ICollateralSystem(collateralSystemAddr).collateralFromUnlockReward(
            user, rewarderAddress, "ATH", rewardEntry.amount
        );

        lockedAmountByAddresses[user] = lockedAmountByAddresses[user].sub(rewardEntry.amount);
        totalLockedAmount = totalLockedAmount.sub(rewardEntry.amount);
        emit RewardEntryUnlocked(rewardEntryId, user, rewardEntry.amount);

        delete rewardEntries[rewardEntryId][user];
        emit RewardEntryRemoved(rewardEntryId);
    }

    function _moveRewardProRata(
        address from,
        address recipient1,
        uint256 amount1,
        address recipient2,
        uint256 amount2,
        uint256[] calldata rewardEntryIds
    ) private {
        // Check amount and adjust from balance directly
        uint256 totalAmount = amount1.add(amount2);
        require(totalAmount > 0 && totalAmount <= lockedAmountByAddresses[from], "RewardLocker: amount out of range");
        lockedAmountByAddresses[from] = lockedAmountByAddresses[from].sub(totalAmount);

        uint256 amount1Left = amount1;
        uint256 amount2Left = amount2;

        for (uint256 ind = 0; ind < rewardEntryIds.length; ind++) {
            uint256 currentRewardEntryId = rewardEntryIds[ind];

            (amount1Left, amount2Left) = moveRewardEntry(
                MoveEntryParams({
                    from: from,
                    recipient1: recipient1,
                    amount1: amount1,
                    recipient2: recipient2,
                    amount2: amount2,
                    rewardEntryId: currentRewardEntryId,
                    amount1Left: amount1Left,
                    amount2Left: amount2Left
                })
            );

            if (amount1Left == 0 && amount2Left == 0) {
                break;
            }
        }

        // Ensure all amounts are distributed
        require(amount1Left == 0 && amount2Left == 0, "RewardLocker: amount not filled with all entries");
    }

    function moveRewardEntry(MoveEntryParams memory params)
        private
        returns (uint256 amount1LeftAfter, uint256 amount2LeftAfter)
    {
        RewardEntry memory currentRewardEntry = rewardEntries[params.rewardEntryId][params.from];
        if (currentRewardEntry.amount == 0) {
            /**
             * This reward entry is gone. We're not reverting the tx here because it's possible for
             * moveReward() or moveRewardProRata() to be called multiple times in a single transaction.
             * Instead of asking the caller to precisely track used entries, we just ignore them here.
             */
            return (params.amount1Left, params.amount2Left);
        }

        uint256 totalAmountLeft = params.amount1Left.add(params.amount2Left);

        uint256 currentAmount = MathUpgradeable.min(totalAmountLeft, currentRewardEntry.amount);
        if (currentAmount == currentRewardEntry.amount) {
            // Entry should be removed
            delete rewardEntries[params.rewardEntryId][params.from];

            emit RewardEntryRemoved(params.rewardEntryId);
        } else {
            // Entry should be amended
            uint256 newAmount = uint256(currentRewardEntry.amount).sub(currentAmount);

            rewardEntries[params.rewardEntryId][params.from].amount = uint216(newAmount);

            emit RewardAmountChanged(params.rewardEntryId, currentRewardEntry.amount, newAmount);
        }

        uint256 currentAmountTo1;
        uint256 currentAmountTo2;

        if (totalAmountLeft == currentAmount) {
            // Amount from the current entry is enough for both recipients
            currentAmountTo1 = params.amount1Left;
            currentAmountTo2 = params.amount2Left;
        } else {
            // Pro-rata allocation
            currentAmountTo1 = MathUpgradeable.min(
                params.amount1Left, currentAmount.mul(params.amount1).div(params.amount1.add(params.amount2))
            );
            currentAmountTo2 = currentAmount.sub(currentAmountTo1);
        }

        if (currentAmountTo1 > 0) {
            _addReward(params.recipient1, currentAmountTo1, currentRewardEntry.unlockTime);
        }

        if (currentAmountTo2 > 0) {
            _addReward(params.recipient2, currentAmountTo2, currentRewardEntry.unlockTime);
        }

        return (params.amount1Left.sub(currentAmountTo1), params.amount2Left.sub(currentAmountTo2));
    }
}
