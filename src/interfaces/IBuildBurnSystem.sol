// SPDX-License-Identifier: MIT
pragma solidity >=0.6.12 <0.9.0;

interface IBuildBurnSystem {
    function buildFromCollateralSys(address user, uint256 amount, bytes32 currencySymbol) external;

    function buildMaxFromCollateralSys(address user, bytes32 currencySymbol) external;

    function burnFromCollateralSys(address user, uint256 amount, bytes32 currencySymbol) external;

    function burnForLiquidation(address user, address liquidator, uint256 amount, bytes32 currencySymbol) external;
}
