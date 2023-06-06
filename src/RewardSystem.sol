// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "./interfaces/ICollateralSystem.sol";
import "./interfaces/IRewardLocker.sol";

contract RewardSystem is OwnableUpgradeable {
    using ECDSAUpgradeable for bytes32;
    using SafeMathUpgradeable for uint256;

    event RewardSignersChanged(address[] newSigners);
    event RewardLockerAddressChanged(address oldAddress, address newAddress);
    event RewardClaimed(address recipient, uint256 periodId, uint256 stakingReward, uint256 feeReward);

    uint256 public firstPeriodStartTime;

    // This is a storage slot that used to be called `rewardSigner` when only one signer was used.
    // It's now replaced by `rewardSigners`. The slot is kept to not break storage structure but
    // it's no longer needed for the contract.
    address private DEPRECATED_DO_NOT_USE;

    mapping(address => uint256) public userLastClaimPeriodIds;

    IERC20Upgradeable public lusd;
    ICollateralSystem public collateralSystem;
    IRewardLocker public rewardLocker;

    bytes32 public DOMAIN_SEPARATOR; // For EIP-712

    address[] public rewardSigners;

    /* EIP-712 type hashes */
    bytes32 public constant REWARD_TYPEHASH =
        keccak256("Reward(uint256 periodId,address recipient,uint256 stakingReward,uint256 feeReward)");

    uint256 public constant PERIOD_LENGTH = 1 weeks;
    uint256 public constant CLAIM_WINDOW_PERIOD_COUNT = 2;
    uint256 public constant STAKING_REWARD_LOCK_PERIOD = 52 weeks;

    function getSignerCount() public view returns (uint256) {
        return rewardSigners.length;
    }

    function getCurrentPeriodId() public view returns (uint256) {
        require(block.timestamp >= firstPeriodStartTime, "RewardSystem: first period not started");
        return (block.timestamp - firstPeriodStartTime) / PERIOD_LENGTH + 1; // No SafeMath needed
    }

    function getPeriodStartTime(uint256 periodId) public view returns (uint256) {
        require(periodId > 0, "RewardSystem: period ID must be positive");
        return firstPeriodStartTime.add(periodId.sub(1).mul(PERIOD_LENGTH));
    }

    function getPeriodEndTime(uint256 periodId) public view returns (uint256) {
        require(periodId > 0, "RewardSystem: period ID must be positive");
        return firstPeriodStartTime.add(periodId.mul(PERIOD_LENGTH));
    }

    function __RewardSystem_init(
        uint256 _firstPeriodStartTime,
        address[] calldata _rewardSigners,
        address _lusdAddress,
        address _collateralSystemAddress,
        address _rewardLockerAddress
    ) public initializer {
        __Ownable_init();

        require(block.timestamp < _firstPeriodStartTime + PERIOD_LENGTH, "RewardSystem: first period already ended");

        firstPeriodStartTime = _firstPeriodStartTime;

        _setRewardSigners(_rewardSigners);

        require(
            _lusdAddress != address(0) && _collateralSystemAddress != address(0) && _rewardLockerAddress != address(0),
            "RewardSystem: zero address"
        );
        lusd = IERC20Upgradeable(_lusdAddress);
        collateralSystem = ICollateralSystem(_collateralSystemAddress);
        rewardLocker = IRewardLocker(_rewardLockerAddress);

        // While we could in-theory calculate the EIP-712 domain separator off-chain, doing
        // it on-chain simplifies deployment and the cost here is one-off and acceptable.
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Athos")),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    function setRewardSigners(address[] calldata _rewardSigners) external onlyOwner {
        _setRewardSigners(_rewardSigners);
    }

    function setRewardLockerAddress(address _rewardLockerAddress) external onlyOwner {
        _setRewardLockerAddress(_rewardLockerAddress);
    }

    function claimReward(uint256 periodId, uint256 stakingReward, uint256 feeReward, bytes[] calldata signatures)
        external
    {
        _claimReward(periodId, msg.sender, stakingReward, feeReward, signatures);
    }

    function claimRewardFor(
        uint256 periodId,
        address recipient,
        uint256 stakingReward,
        uint256 feeReward,
        bytes[] calldata signatures
    ) external {
        _claimReward(periodId, recipient, stakingReward, feeReward, signatures);
    }

    function _setRewardSigners(address[] calldata _rewardSigners) private {
        // We free up this slot so that we can reuse it in the next upgrade
        DEPRECATED_DO_NOT_USE = address(0);

        require(_rewardSigners.length > 1, "RewardSystem: at least 2 signers");

        require(_rewardSigners[0] != address(0), "RewardSystem: zero address");

        // We technically don't need this ordering enforced but this would be helpful if we
        // implement quorum in the future. Plus we need to check zero address anyways.
        for (uint256 ind = 1; ind < _rewardSigners.length; ind++) {
            require(_rewardSigners[ind] > _rewardSigners[ind - 1], "RewardSystem: invalid signer order");
        }

        if (rewardSigners.length > 0) {
            uint256 deleteCount = rewardSigners.length;
            for (uint256 ind = 0; ind < deleteCount; ind++) {
                rewardSigners.pop();
            }
        }

        for (uint256 ind = 0; ind < _rewardSigners.length; ind++) {
            rewardSigners.push(_rewardSigners[ind]);
        }

        emit RewardSignersChanged(_rewardSigners);
    }

    function _setRewardLockerAddress(address _rewardLockerAddress) private {
        require(_rewardLockerAddress != address(0), "RewardSystem: zero address");
        require(_rewardLockerAddress != address(rewardLocker), "RewardSystem: address not changed");

        address oldAddress = address(rewardLocker);
        rewardLocker = IRewardLocker(_rewardLockerAddress);

        emit RewardLockerAddressChanged(oldAddress, address(rewardLocker));
    }

    function _claimReward(
        uint256 periodId,
        address recipient,
        uint256 stakingReward,
        uint256 feeReward,
        bytes[] calldata signatures
    ) private {
        require(periodId > 0, "RewardSystem: period ID must be positive");
        require(stakingReward > 0 || feeReward > 0, "RewardSystem: nothing to claim");

        // Check if the target period is in the claiming window
        uint256 currentPeriodId = getCurrentPeriodId();
        require(periodId < currentPeriodId, "RewardSystem: period not ended");
        require(
            currentPeriodId <= CLAIM_WINDOW_PERIOD_COUNT || periodId >= currentPeriodId - CLAIM_WINDOW_PERIOD_COUNT,
            "RewardSystem: reward expired"
        );

        // Re-entrance prevention
        require(userLastClaimPeriodIds[recipient] < periodId, "RewardSystem: reward already claimed");
        userLastClaimPeriodIds[recipient] = periodId;

        // Users can only claim rewards if target ratio is satisfied
        require(collateralSystem.IsSatisfyTargetRatio(recipient), "RewardSystem: below target ratio");

        // Verify EIP-712 signature
        require(rewardSigners.length > 0, "RewardSystem: empty signer set");
        require(signatures.length == rewardSigners.length, "RewardSystem: signature count mismatch");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(REWARD_TYPEHASH, periodId, recipient, stakingReward, feeReward))
            )
        );
        for (uint256 ind; ind < signatures.length; ind++) {
            address recoveredAddress = digest.recover(signatures[ind]);
            require(recoveredAddress == rewardSigners[ind], "RewardSystem: invalid signature");
        }

        if (stakingReward > 0) {
            rewardLocker.addReward(recipient, stakingReward, getPeriodEndTime(periodId) + STAKING_REWARD_LOCK_PERIOD);
        }

        if (feeReward > 0) {
            lusd.transfer(recipient, feeReward);
        }

        emit RewardClaimed(recipient, periodId, stakingReward, feeReward);
    }

    // Reserved storage space to allow for layout changes in the future.
    uint256[42] private __gap;
}
