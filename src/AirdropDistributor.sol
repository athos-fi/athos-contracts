// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "./interfaces/IRewardLocker.sol";

contract AirdropDistributor is OwnableUpgradeable {
    using SafeCastUpgradeable for uint256;

    event Initialized(
        uint256 startTime,
        uint256 deadline,
        uint256 unlockedPercentage,
        uint256 firstUnlockTime,
        uint256 unlockInterval,
        uint256 unlockCount,
        address rewardLocker,
        address token
    );
    event FirstUnlockTimeChanged(uint256 newFirstUnlockTime);
    event AirdropEntryAdded(address recipient, uint256 amount);
    event AirdropClaimed(address sender, address recipient, uint256 amount);
    event RemainingTokensClaimed(address recipient, uint256 amount);

    struct AirdropEntry {
        uint128 amount;
        bool claimed;
        uint32 claimTime;
    }

    uint256 public startTime;
    uint256 public deadline;
    uint256 public unlockedPercentage;
    uint256 public firstUnlockTime;
    uint256 public unlockInterval;
    uint256 public unlockCount;
    IRewardLocker public rewardLocker;
    IERC20Upgradeable public token;

    mapping(address => AirdropEntry) public airdropEntries;

    function __AirdropDistributor_init(
        uint256 _startTime,
        uint256 _deadline,
        uint256 _unlockedPercentage,
        uint256 _firstUnlockTime,
        uint256 _unlockInterval,
        uint256 _unlockCount,
        IRewardLocker _rewardLocker,
        IERC20Upgradeable _token
    ) public initializer {
        __Ownable_init();

        require(_deadline > block.timestamp && _startTime < _deadline, "AirdropDistributor: invalid timestamps");
        require(address(_rewardLocker) != address(0), "AirdropDistributor: zero address");
        require(address(_token) != address(0), "AirdropDistributor: zero address");

        startTime = _startTime;
        deadline = _deadline;
        unlockedPercentage = _unlockedPercentage;
        firstUnlockTime = _firstUnlockTime;
        unlockInterval = _unlockInterval;
        unlockCount = _unlockCount;
        rewardLocker = _rewardLocker;
        token = _token;

        emit Initialized(
            _startTime,
            _deadline,
            _unlockedPercentage,
            _firstUnlockTime,
            _unlockInterval,
            _unlockCount,
            address(_rewardLocker),
            address(_token)
            );
    }

    function setFirstUnlockTime(uint256 _firstUnlockTime) external onlyOwner {
        firstUnlockTime = _firstUnlockTime;
        emit FirstUnlockTimeChanged(_firstUnlockTime);
    }

    function importAirdropEntries(address[] calldata recipients, uint256[] calldata amounts) external onlyOwner {
        require(recipients.length == amounts.length, "AirdropDistributor: array length mismatch");

        uint256 totalAmount = 0;
        for (uint256 ind = 0; ind < recipients.length; ind++) {
            _importAirdropEntry(recipients[ind], amounts[ind]);
            totalAmount += amounts[ind];
        }

        token.transferFrom(msg.sender, address(this), totalAmount);
    }

    function withdrawRemaining() external onlyOwner {
        require(block.timestamp >= deadline, "AirdropDistributor: deadline not reached");

        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "AirdropDistributor: no token to withdraw");

        token.transfer(msg.sender, balance);

        emit RemainingTokensClaimed(msg.sender, balance);
    }

    function claim(address recipient) external {
        require(block.timestamp >= startTime, "AirdropDistributor: not started");
        require(block.timestamp < deadline, "AirdropDistributor: deadline reached");
        _claim(recipient);
    }

    function forceClaim(address recipient) external onlyOwner {
        _claim(recipient);
    }

    function _claim(address recipient) private {
        AirdropEntry memory airdropEntry = airdropEntries[recipient];
        require(airdropEntry.amount > 0, "AirdropDistributor: no token to claim");
        require(!airdropEntry.claimed, "AirdropDistributor: already claimed");

        airdropEntries[recipient] =
            AirdropEntry({amount: airdropEntry.amount, claimed: true, claimTime: block.timestamp.toUint32()});

        uint256 immediatelyUnlockedAmount = airdropEntry.amount * unlockedPercentage / 100;
        if (immediatelyUnlockedAmount != 0) {
            token.transfer(recipient, immediatelyUnlockedAmount);
        }

        uint256 amountEachPeriod = (airdropEntry.amount - immediatelyUnlockedAmount) / unlockCount;
        if (amountEachPeriod > 0) {
            for (uint256 indPeriod = 0; indPeriod < unlockCount; indPeriod++) {
                rewardLocker.addReward(recipient, amountEachPeriod, firstUnlockTime + indPeriod * unlockInterval);
            }

            token.transfer(address(rewardLocker), amountEachPeriod * unlockCount);
        }

        emit AirdropClaimed(msg.sender, recipient, airdropEntry.amount);
    }

    function _importAirdropEntry(address recipient, uint256 amount) private {
        require(airdropEntries[recipient].amount == 0, "AirdropDistributor: entry already exists");
        airdropEntries[recipient] = AirdropEntry({amount: amount.toUint128(), claimed: false, claimTime: 0});

        emit AirdropEntryAdded(recipient, amount);
    }
}
