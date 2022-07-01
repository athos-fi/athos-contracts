// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "openzeppelin-contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/**
 * @title AthToken
 *
 * @dev A minimal ERC20 token contract for the Athos Finance token.
 */
contract AthToken is ERC20Upgradeable {
    uint256 private constant TOTAL_SUPPLY = 100000000e18;

    function __AthToken_init(address genesis_holder) public initializer {
        __ERC20_init("Athos Finance Token", "ATH");

        _mint(genesis_holder, TOTAL_SUPPLY);
    }
}
