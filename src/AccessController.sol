// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract AccessController is AccessControlUpgradeable {
    function __AccessController_init() public initializer {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
}
