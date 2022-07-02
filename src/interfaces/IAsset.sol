// SPDX-License-Identifier: MIT
pragma solidity >=0.6.12 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAsset {
    function keyName() external view returns (bytes32);

    function mint(address account, uint256 amount) external;

    function burn(address account, uint256 amount) external;

    function move(address from, address to, uint256 amount) external;
}
