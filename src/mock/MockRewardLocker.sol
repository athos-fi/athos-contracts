// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

contract MockRewardLocker {
    struct AppendRewardArgs {
        address _user;
        uint256 _amount;
        uint256 _lockTo;
    }

    AppendRewardArgs[] appendRewardCalls;

    function lastAppendRewardCall() public view returns (AppendRewardArgs memory) {
        AppendRewardArgs memory args = appendRewardCalls[appendRewardCalls.length - 1];
        return args;
    }

    function allAppendRewardCalls() public view returns (AppendRewardArgs[] memory) {
        return appendRewardCalls;
    }

    function addReward(address _user, uint256 _amount, uint256 _lockTo) external {
        appendRewardCalls.push(AppendRewardArgs({_user: _user, _amount: _amount, _lockTo: _lockTo}));
    }
}
