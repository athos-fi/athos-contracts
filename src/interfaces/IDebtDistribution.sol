// SPDX-License-Identifier: MIT
pragma solidity >=0.6.12 <0.9.0;

interface IDebtDistribution {
    function getCollateralDebtBalanceByDebtSystemAddress(address _debtSystem) external view returns (uint256);

    function increaseDebt(uint256 _amount) external;

    function decreaseDebt(uint256 _amount) external;
}
