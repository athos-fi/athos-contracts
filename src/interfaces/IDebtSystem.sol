// SPDX-License-Identifier: MIT
pragma solidity >=0.6.12 <0.9.0;

interface IDebtSystem {
    function GetUserDebtBalanceInUsdByCurrency(address _user, bytes32 _currency)
        external
        view
        returns (uint256, uint256);

    function UpdateDebt(address _user, uint256 _debtProportion, uint256 _factor) external;

    function UpdateDebtByCurrency(address _user, uint256 _debtProportion, uint256 _factor, bytes32 _currencySymbol)
        external;
}
