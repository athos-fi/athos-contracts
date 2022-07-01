// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";

import "src/AirdropDistributor.sol";
import "src/AthToken.sol";
import "src/mock/MockRewardLocker.sol";

contract AirdropDistributorTest is Test {
    event Transfer(address indexed from, address indexed to, uint256 value);

    AthToken athToken;
    MockRewardLocker rewardLocker;
    AirdropDistributor airdrop;

    uint256 deadline;
    uint256 firstUnlockTime;
    uint256 unlockInterval;

    address private constant ALICE = 0x0000000000000000000000000000000000000011;
    address private constant BOB = 0x0000000000000000000000000000000000000022;
    address private constant CHARLIE =
        0x0000000000000000000000000000000000000033;

    function setUp() public {
        payable(ALICE).transfer(1_000 ether);
        payable(BOB).transfer(1_000 ether);
        payable(CHARLIE).transfer(1_000 ether);

        deadline = block.timestamp + 365 days;
        firstUnlockTime = deadline + 1 days;
        unlockInterval = 1 days;

        athToken = new AthToken();
        athToken.__AthToken_init(
            address(this) // genesis_holder
        );

        rewardLocker = new MockRewardLocker();

        airdrop = new AirdropDistributor();
        airdrop.__AirdropDistributor_init(
            deadline, // _deadline
            10, // _unlockedPercentage
            firstUnlockTime, // _firstUnlockTime
            unlockInterval, // _unlockInterval
            10, // _unlockCount
            IRewardLocker(address(rewardLocker)), // _rewardLocker
            IERC20Upgradeable(address(athToken)) // _token
        );

        athToken.approve(address(airdrop), type(uint256).max);

        {
            address[] memory recipients = new address[](2);
            recipients[0] = ALICE;
            recipients[1] = BOB;

            uint256[] memory amounts = new uint256[](2);
            amounts[0] = 100e18;
            amounts[1] = 200e18;

            airdrop.importAirdropEntries(recipients, amounts);
        }
    }

    function testInitializerCannotBeCalledAfterDeployment() public {
        vm.expectRevert(bytes("Initializable: contract is already initialized"));
        airdrop.__AirdropDistributor_init(
            deadline, // _deadline
            10, // _unlockedPercentage
            firstUnlockTime, // _firstUnlockTime
            unlockInterval, // _unlockInterval
            10, // _unlockCount
            IRewardLocker(address(rewardLocker)), // _rewardLocker
            IERC20Upgradeable(address(athToken)) // _token
        );
    }

    function testAirdropContractOwnsTokensToBeDistributed() public {
        assertEq(athToken.balanceOf(address(airdrop)), 300e18);
    }

    function testOnlyOwnerCanImportEntries() public {
        address[] memory recipients = new address[](1);
        recipients[0] = CHARLIE;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100e18;

        vm.expectRevert(bytes("Ownable: caller is not the owner"));
        vm.prank(ALICE);
        airdrop.importAirdropEntries(recipients, amounts);

        airdrop.importAirdropEntries(recipients, amounts);
    }

    function testOnlyOwnerCanClaimRemainingTokens() public {
        vm.warp(deadline);

        vm.expectRevert(bytes("Ownable: caller is not the owner"));
        vm.prank(ALICE);
        airdrop.withdrawRemaining();

        airdrop.withdrawRemaining();
    }

    function testTokenIsTransferredAndLockedOnClaim() public {
        vm.expectEmit(true, true, true, true, address(athToken));
        emit Transfer(address(airdrop), address(ALICE), 10e18);
        vm.expectEmit(true, true, true, true, address(athToken));
        emit Transfer(address(airdrop), address(rewardLocker), 90e18);
        vm.prank(BOB);
        airdrop.claim(ALICE);

        // Immediately unlocked
        assertEq(athToken.balanceOf(ALICE), 10e18);

        // Locked
        assertEq(athToken.balanceOf(address(rewardLocker)), 90e18);

        MockRewardLocker.AppendRewardArgs[] memory lockedEntries =
            rewardLocker.allAppendRewardCalls();
        assertEq(lockedEntries.length, 10);
        assertEq(lockedEntries[0]._amount, 9e18);
        assertEq(lockedEntries[0]._lockTo, firstUnlockTime);
        assertEq(lockedEntries[9]._amount, 9e18);
        assertEq(lockedEntries[9]._lockTo, firstUnlockTime + unlockInterval * 9);
    }

    function testTheSameEntryCanOnlyBeClaimedOnce() public {
        vm.prank(BOB);
        airdrop.claim(ALICE);

        vm.expectRevert(bytes("AirdropDistributor: already claimed"));
        vm.prank(BOB);
        airdrop.claim(ALICE);
    }

    function testCannotClaimWithoutAnEntry() public {
        vm.expectRevert(bytes("AirdropDistributor: no token to claim"));
        vm.prank(BOB);
        airdrop.claim(CHARLIE);
    }

    function testEntryMarkedAsClaimedAfterClaiming() public {
        vm.prank(BOB);
        airdrop.claim(ALICE);

        (, bool claimed, uint32 claimTime) = airdrop.airdropEntries(ALICE);
        assertEq(claimed, true);
        assertGt(claimTime, 0);
    }

    function testCanOnlyClaimBeforeDeadlineIsReached_1() public {
        vm.warp(deadline - 1);

        vm.prank(ALICE);
        airdrop.claim(ALICE);
    }

    function testCanOnlyClaimBeforeDeadlineIsReached_2() public {
        vm.warp(deadline);

        vm.expectRevert(bytes("AirdropDistributor: deadline reached"));
        vm.prank(ALICE);
        airdrop.claim(ALICE);
    }

    function testOwnerCanForceClaimAfterDeadlineIsReached() public {
        vm.warp(deadline);

        vm.expectRevert(bytes("AirdropDistributor: deadline reached"));
        vm.prank(ALICE);
        airdrop.claim(ALICE);

        airdrop.forceClaim(ALICE);
    }

    function testCanOnlyWithdrawRemainingTokensOnceDeadlineIsReached_1()
        public
    {
        vm.prank(ALICE);
        airdrop.claim(ALICE);

        vm.warp(deadline - 1);

        vm.expectRevert(bytes("AirdropDistributor: deadline not reached"));
        airdrop.withdrawRemaining();
    }

    function testCanOnlyWithdrawRemainingTokensOnceDeadlineIsReached_2()
        public
    {
        vm.prank(ALICE);
        airdrop.claim(ALICE);

        vm.warp(deadline);

        vm.expectEmit(true, true, true, true, address(athToken));
        emit Transfer(address(airdrop), address(this), 200e18);
        airdrop.withdrawRemaining();
    }
}
