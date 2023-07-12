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
    rewardSigner1: Wallet,
    rewardSigner2: Wallet;

  let stack: DeployedStack;

  let aliceSignaturePeriod1: string[];
  const periodDuration: Duration = Duration.fromObject({ weeks: 1 });
  const stakingRewardLockTime: Duration = Duration.fromObject({ weeks: 52 });

  const createSignatures = async (
    signers: Wallet[],
    periodId: BigNumber,
    recipient: string,
    stakingReward: BigNumber,
    feeReward: BigNumber,
  ): Promise<string[]> => {
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

    return await Promise.all(
      signers.map((signer) => signer._signTypedData(domain, types, value)),
    );
  };

  beforeEach(async function () {
    [deployer, alice, rewardUnlocker, rewarder] = await ethers.getSigners();
    rewardSigner1 = Wallet.createRandom();
    rewardSigner2 = Wallet.createRandom();
    if (
      BigNumber.from(rewardSigner1.address).gt(
        BigNumber.from(rewardSigner2.address),
      )
    ) {
      const temp = rewardSigner1;
      rewardSigner1 = rewardSigner2;
      rewardSigner2 = temp;
    }

    stack = await deployAthosStack(deployer);

    // Mint 1,000,000 ATH to Alice
    await stack.collaterals.ath.token
      .connect(deployer)
      .transfer(alice.address, expandTo18Decimals(1_000_000));

    await stack.collaterals.ath.token
      .connect(alice)
      .approve(stack.collaterals.ath.collateralSystem.address, uint256Max);

    await stack.collaterals.ath.token
      .connect(alice)
      .transfer(rewarder.address, expandTo18Decimals(10_000));

    // Set rewarder address to `RewardLocker`
    await stack.rewardLocker
      .connect(deployer)
      .updateRewarderAddress(rewarder.address);

    // Update RewardSystem reward signer to rewardSigner
    await stack.rewardSystem
      .connect(deployer)
      .setRewardSigners([rewardSigner1.address, rewardSigner2.address]);

    // Create a signature of Period 1, 100 staking reward, 0 fee reward
    aliceSignaturePeriod1 = await createSignatures(
      [rewardSigner1, rewardSigner2],
      BigNumber.from(1),
      alice.address,
      expandTo18Decimals(100),
      BigNumber.from(0),
    );
  });

  it("end to end test from claim reward to unlock reward", async () => {
    // Alice stakes 9,000 ATH
    await stack.collaterals.ath.collateralSystem.connect(alice).Collateral(
      formatBytes32String("ATH"), // _currency
      expandTo18Decimals(9_000), // _amount
    );

    // Returns 9,000 when locked amount is zero
    expect(
      await stack.collaterals.ath.collateralSystem.maxRedeemableLina(
        alice.address, // user
      ),
    ).to.equal(expandTo18Decimals(9_000));

    // Fast forward to 1st period end
    const rewardSystemFirstPeriod =
      await stack.rewardSystem.firstPeriodStartTime();
    await setNextBlockTimestamp(
      ethers.provider,
      DateTime.fromSeconds(parseInt(rewardSystemFirstPeriod.toString())).plus(
        periodDuration,
      ),
    );

    // Alice claim reward
    await expect(
      stack.rewardSystem.connect(alice).claimReward(
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        BigNumber.from(0), // feeReward
        aliceSignaturePeriod1, // signature
      ),
    )
      .to.emit(stack.rewardSystem, "RewardClaimed")
      .withArgs(
        alice.address, // recipient
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        BigNumber.from(0), // feeReward
      );

    expect(
      await stack.rewardLocker.lockedAmountByAddresses(alice.address),
    ).to.equal(expandTo18Decimals(100));

    // Fast forward to unlock time
    await setNextBlockTimestamp(
      ethers.provider,
      DateTime.fromSeconds(parseInt(rewardSystemFirstPeriod.toString()))
        .plus(periodDuration)
        .plus(stakingRewardLockTime),
    );

    // Approve lnCollateralSystem to spend ATH from rewarder
    await stack.collaterals.ath.token
      .connect(rewarder)
      .approve(
        stack.collaterals.ath.collateralSystem.address,
        expandTo18Decimals(100),
      );

    await expect(
      stack.rewardLocker.connect(rewardUnlocker).unlockReward(
        alice.address, // user
        1, // rewardEntryId
      ),
    )
      .to.emit(stack.rewardLocker, "RewardEntryUnlocked")
      .withArgs(
        1, //entryId
        alice.address, // user
        expandTo18Decimals(100), // amount
      )
      .to.emit(stack.collaterals.ath.collateralSystem, "CollateralUnlockReward")
      .withArgs(
        alice.address,
        formatBytes32String("ATH"),
        expandTo18Decimals(100),
        expandTo18Decimals(9_100),
      )
      .to.emit(stack.collaterals.ath.token, "Transfer")
      .withArgs(
        rewarder.address,
        stack.collaterals.ath.collateralSystem.address,
        expandTo18Decimals(100),
      );

    // Returns 9,000 when locked amount is zero
    expect(
      await stack.collaterals.ath.collateralSystem.maxRedeemableLina(
        alice.address, // user
      ),
    ).to.equal(expandTo18Decimals(9_100));

    await expect(
      stack.collaterals.ath.collateralSystem
        .connect(alice)
        .RedeemMax(formatBytes32String("ATH")),
    )
      .to.emit(stack.collaterals.ath.collateralSystem, "RedeemCollateral")
      .withArgs(
        alice.address,
        formatBytes32String("ATH"),
        expandTo18Decimals(9_100),
        BigNumber.from("0"),
      )
      .to.emit(stack.collaterals.ath.token, "Transfer")
      .withArgs(
        stack.collaterals.ath.collateralSystem.address,
        alice.address,
        expandTo18Decimals(9_100),
      );

    expect(await stack.collaterals.ath.token.balanceOf(alice.address)).to.eq(
      expandTo18Decimals(990_100),
    );
  });
});
