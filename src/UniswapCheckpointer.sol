// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/IUniswapCheckpoints.sol";

contract UniswapCheckpointer is OwnableUpgradeable {
    IUniswapCheckpoints public checkpoints;

    function __UniswapCheckpointer_init(IUniswapCheckpoints _checkpoints)
        public
        initializer
    {
        __Ownable_init();

        require(
            address(_checkpoints) != address(0),
            "UniswapCheckpointer: zero address"
        );

        checkpoints = _checkpoints;
    }

    // Permission-less. Anyone can make checkpoints
    function makeCheckpoints(
        address[] calldata baseTokens,
        address[] calldata quoteTokens
    )
        external
    {
        require(baseTokens.length > 0, "UniswapCheckpointer: empty array");
        require(
            baseTokens.length == quoteTokens.length,
            "UniswapCheckpointer: length mismatch"
        );

        for (uint256 ind = 0; ind < baseTokens.length; ind++) {
            checkpoints.makeCheckpoint(baseTokens[ind], quoteTokens[ind]);
        }
    }
}
