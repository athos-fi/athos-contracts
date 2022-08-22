// SPDX-License-Identifier: MIT
pragma solidity >=0.6.12 <0.9.0;

interface ICollateralSystem {
    function getUserLinaCollateralBreakdown(address _user) external view returns (uint256 staked, uint256 locked);

    function IsSatisfyTargetRatio(address _user) external view returns (bool);

    function GetUserTotalCollateralInUsd(address _user) external view returns (uint256 rTotal);

    function MaxRedeemableInUsd(address _user) external view returns (uint256);

    function getFreeCollateralInUsd(address user) external view returns (uint256);

    function moveCollateral(address fromUser, address toUser, bytes32 currency, uint256 amount) external;

    function collateralFromUnlockReward(address user, address rewarder, bytes32 currency, uint256 amount) external;
}
