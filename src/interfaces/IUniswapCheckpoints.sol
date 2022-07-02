// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.12 <0.9.0;

interface IUniswapCheckpoints {
    struct Checkpoint {
        uint256 priceCumulative;
        uint256 timestamp;
    }

    function getCurrentCumulativePrice(address baseToken, address quoteToken)
        external
        view
        returns (uint256 priceCumulative);

    function getLatestCheckpointOlderThan(
        address baseToken,
        address quoteToken,
        uint256 minAge
    )
        external
        view
        returns (Checkpoint memory checkpoint);

    function makeCheckpoint(address baseToken, address quoteToken) external;
}
