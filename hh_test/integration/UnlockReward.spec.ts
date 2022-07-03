import { DateTime, Duration } from "luxon";
import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Wallet } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { expandTo18Decimals, uint256Max } from "../utilities";
import { deployAthosStack, DeployedStack } from "../utilities/init";
import { setNextBlockTimestamp } from "../utilities/timeTravel";

const { formatBytes32String } = ethers.utils;

describe("Integration | Unlock Reward", function () {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    rewardUnlocker: SignerWithAddress,
    rewarder: SignerWithAddress,
    rewardSigner: Wallet;

  let stack: DeployedStack;

  let aliceSignaturePeriod1: string;
  const periodDuration: Duration = Duration.fromObject({ weeks: 1 });
  const stakingRewardLockTime: Duration = Duration.fromObject({ weeks: 52 });

  const createSignature = async (
    signer: Wallet,
    periodId: BigNumber,
    recipient: string,
    stakingReward: BigNumber,
    feeReward: BigNumber
  ): Promise<string> => {
    const domain = {
      name: "Athos",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: stack.rewardSystem.address,
    };

    const types = {
      Reward: [
        { name: "periodId", type: "uint256" },
        { name: "recipient", type: "address" },
        { name: "stakingReward", type: "uint256" },
        { name: "feeReward", type: "uint256" },
      ],
    };

    const value = {
      periodId,
      recipient,
      stakingReward,
      feeReward,
    };

    const signatureHex = await signer._signTypedData(domain, types, value);

    return signatureHex;
  };

  beforeEach(async function () {
    [deployer, alice, rewardUnlocker, rewarder] = await ethers.getSigners();
    rewardSigner = Wallet.createRandom();

    stack = await deployAthosStack(deployer);

    // Mint 1,000,000 ATH to Alice
    await stack.athToken
      .connect(deployer)
      .transfer(alice.address, expandTo18Decimals(1_000_000));

    await stack.athToken
      .connect(alice)
      .approve(stack.collateralSystem.address, uint256Max);

    await stack.athToken
      .connect(alice)
      .transfer(rewarder.address, expandTo18Decimals(10_000));

    // Set rewarder address to `RewardLocker`
    await stack.rewardLocker
      .connect(deployer)
      .updateRewarderAddress(rewarder.address);

    // Update RewardSystem reward signer to rewardSigner
    await stack.rewardSystem
      .connect(deployer)
      .setRewardSigner(rewardSigner.address);

    // Create a signature of Period 1, 100 staking reward, 0 fee reward
    aliceSignaturePeriod1 = await createSignature(
      rewardSigner,
      BigNumber.from(1),
      alice.address,
      expandTo18Decimals(100),
      BigNumber.from(0)
    );
  });

  it("end to end test from claim reward to unlock reward", async () => {
    // Alice stakes 9,000 ATH
    await stack.collateralSystem.connect(alice).Collateral(
      formatBytes32String("ATH"), // _currency
      expandTo18Decimals(9_000) // _amount
    );

    // Returns 9,000 when locked amount is zero
    expect(
      await stack.collateralSystem.maxRedeemableLina(
        alice.address // user
      )
    ).to.equal(expandTo18Decimals(9_000));

    // Fast forward to 1st period end
    const rewardSystemFirstPeriod =
      await stack.rewardSystem.firstPeriodStartTime();
    await setNextBlockTimestamp(
      ethers.provider,
      DateTime.fromSeconds(parseInt(rewardSystemFirstPeriod.toString())).plus(
        periodDuration
      )
    );

    // Alice claim reward
    await expect(
      stack.rewardSystem.connect(alice).claimReward(
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        BigNumber.from(0), // feeReward
        aliceSignaturePeriod1 // signature
      )
    )
      .to.emit(stack.rewardSystem, "RewardClaimed")
      .withArgs(
        alice.address, // recipient
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        BigNumber.from(0) // feeReward
      );

    expect(
      await stack.rewardLocker.lockedAmountByAddresses(alice.address)
    ).to.equal(expandTo18Decimals(100));

    // Fast forward to unlock time
    await setNextBlockTimestamp(
      ethers.provider,
      DateTime.fromSeconds(parseInt(rewardSystemFirstPeriod.toString()))
        .plus(periodDuration)
        .plus(stakingRewardLockTime)
    );

    // Approve lnCollateralSystem to spend ATH from rewarder
    await stack.athToken
      .connect(rewarder)
      .approve(stack.collateralSystem.address, expandTo18Decimals(100));

    await expect(
      stack.rewardLocker.connect(rewardUnlocker).unlockReward(
        alice.address, // user
        1 // rewardEntryId
      )
    )
      .to.emit(stack.rewardLocker, "RewardEntryUnlocked")
      .withArgs(
        1, //entryId
        alice.address, // user
        expandTo18Decimals(100) // amount
      )
      .to.emit(stack.collateralSystem, "CollateralUnlockReward")
      .withArgs(
        alice.address,
        formatBytes32String("ATH"),
        expandTo18Decimals(100),
        expandTo18Decimals(9_100)
      )
      .to.emit(stack.athToken, "Transfer")
      .withArgs(
        rewarder.address,
        stack.collateralSystem.address,
        expandTo18Decimals(100)
      );

    // Returns 9,000 when locked amount is zero
    expect(
      await stack.collateralSystem.maxRedeemableLina(
        alice.address // user
      )
    ).to.equal(expandTo18Decimals(9_100));

    await expect(
      stack.collateralSystem
        .connect(alice)
        .RedeemMax(formatBytes32String("ATH"))
    )
      .to.emit(stack.collateralSystem, "RedeemCollateral")
      .withArgs(
        alice.address,
        formatBytes32String("ATH"),
        expandTo18Decimals(9_100),
        BigNumber.from("0")
      )
      .to.emit(stack.athToken, "Transfer")
      .withArgs(
        stack.collateralSystem.address,
        alice.address,
        expandTo18Decimals(9_100)
      );

    expect(await stack.athToken.balanceOf(alice.address)).to.eq(
      expandTo18Decimals(990_100)
    );
  });
});
