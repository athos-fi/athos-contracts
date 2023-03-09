import { DateTime, Duration } from "luxon";
import { ethers, waffle } from "hardhat";
import { expect, use } from "chai";
import { BigNumber, Wallet } from "ethers";
import { MockContract } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { expandTo18Decimals } from "./utilities";
import {
  getBlockDateTime,
  setNextBlockTimestamp,
} from "./utilities/timeTravel";

import { MockERC20, MockRewardLocker, RewardSystem } from "../typechain";
import ICollateralSystem from "../hh_out/src/interfaces/ICollateralSystem.sol/ICollateralSystem.json";

use(waffle.solidity);

describe("RewardSystem", function () {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    rewardSigner: Wallet;

  let ausd: MockERC20,
    collateralSystem: MockContract,
    rewardLocker: MockRewardLocker,
    rewardSystem: RewardSystem;

  let aliceSignaturePeriod1: string;

  let firstPeriodStartTime: DateTime;
  const periodDuration: Duration = Duration.fromObject({ weeks: 1 });
  const stakingRewardLockTime: Duration = Duration.fromObject({ weeks: 52 });

  const getPeriodEndTime = (periodId: number): DateTime => {
    let endTime = firstPeriodStartTime;
    for (let ind = 0; ind < periodId; ind++) {
      endTime = endTime.plus(periodDuration);
    }
    return endTime;
  };

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
      verifyingContract: rewardSystem.address,
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
    [deployer, alice, bob] = await ethers.getSigners();
    rewardSigner = Wallet.createRandom();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const MockRewardLocker = await ethers.getContractFactory(
      "MockRewardLocker"
    );
    const RewardSystem = await ethers.getContractFactory("RewardSystem");

    firstPeriodStartTime = (await getBlockDateTime(ethers.provider)).plus({
      days: 1,
    });

    ausd = await MockERC20.deploy(
      "athUSD", // _name
      "athUSD", // _symbol
      18 // _decimals
    );

    collateralSystem = await waffle.deployMockContract(
      deployer,
      ICollateralSystem.abi
    );
    await collateralSystem.mock.IsSatisfyTargetRatio.returns(true);

    rewardLocker = await MockRewardLocker.deploy();

    rewardSystem = await RewardSystem.deploy();
    await rewardSystem.connect(deployer).__RewardSystem_init(
      firstPeriodStartTime.toSeconds(), // _firstPeriodStartTime
      rewardSigner.address, // _rewardSigner
      ausd.address, // _lusdAddress
      collateralSystem.address, // _collateralSystemAddress
      rewardLocker.address // _rewardLockerAddress
    );

    // RewardSystem holds 1,000,000 athUSD to start
    await ausd
      .connect(deployer)
      .mint(rewardSystem.address, expandTo18Decimals(1_000_000));

    // Period 1, 100 staking reward, 100 fee reward
    aliceSignaturePeriod1 = await createSignature(
      rewardSigner,
      BigNumber.from(1),
      alice.address,
      expandTo18Decimals(100),
      expandTo18Decimals(200)
    );
  });

  it("only owner can change signer", async () => {
    expect(await rewardSystem.rewardSigner()).to.equal(rewardSigner.address);

    await expect(
      rewardSystem.connect(alice).setRewardSigner(alice.address)
    ).to.revertedWith("Ownable: caller is not the owner");

    await rewardSystem.connect(deployer).setRewardSigner(alice.address);

    expect(await rewardSystem.rewardSigner()).to.equal(alice.address);
  });

  it("can claim reward with valid signature", async () => {
    await setNextBlockTimestamp(ethers.provider, getPeriodEndTime(1));

    await expect(
      rewardSystem.connect(alice).claimReward(
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        expandTo18Decimals(200), // feeReward
        aliceSignaturePeriod1 // signature
      )
    )
      .to.emit(rewardSystem, "RewardClaimed")
      .withArgs(
        alice.address, // recipient
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        expandTo18Decimals(200) // feeReward
      )
      .to.emit(ausd, "Transfer")
      .withArgs(rewardSystem.address, alice.address, expandTo18Decimals(200));

    // Assert staking reward
    const lastAppendRewardCall = await rewardLocker.lastAppendRewardCall();
    expect(lastAppendRewardCall._user).to.equal(alice.address);
    expect(lastAppendRewardCall._amount).to.equal(expandTo18Decimals(100));
    expect(lastAppendRewardCall._lockTo).to.equal(
      getPeriodEndTime(1).plus(stakingRewardLockTime).toSeconds()
    );

    // Assert fee reward
    expect(await ausd.balanceOf(rewardSystem.address)).to.equal(
      expandTo18Decimals(999_800)
    );
    expect(await ausd.balanceOf(alice.address)).to.equal(
      expandTo18Decimals(200)
    );
  });

  it("cannot claim reward with invalid signature", async () => {
    // Signature for the same struct generated by a random signer
    const fakeSigner = Wallet.createRandom();
    const fakeSignature = await createSignature(
      fakeSigner,
      BigNumber.from(1),
      alice.address,
      expandTo18Decimals(100),
      expandTo18Decimals(200)
    );

    await setNextBlockTimestamp(ethers.provider, getPeriodEndTime(2));

    // Wrong period id
    await expect(
      rewardSystem.connect(alice).claimReward(
        2, // periodId
        expandTo18Decimals(100), // stakingReward
        expandTo18Decimals(200), // feeReward
        aliceSignaturePeriod1 // signature
      )
    ).to.revertedWith("RewardSystem: invalid signature");

    // Wrong staking reward
    await expect(
      rewardSystem.connect(alice).claimReward(
        1, // periodId
        expandTo18Decimals(200), // stakingReward
        expandTo18Decimals(200), // feeReward
        aliceSignaturePeriod1 // signature
      )
    ).to.revertedWith("RewardSystem: invalid signature");

    // Wrong fee reward
    await expect(
      rewardSystem.connect(alice).claimReward(
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        expandTo18Decimals(300), // feeReward
        aliceSignaturePeriod1 // signature
      )
    ).to.revertedWith("RewardSystem: invalid signature");

    // Wrong signer
    await expect(
      rewardSystem.connect(alice).claimReward(
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        expandTo18Decimals(200), // feeReward
        fakeSignature // signature
      )
    ).to.revertedWith("RewardSystem: invalid signature");
  });

  it("cannot claim reward before period ends", async () => {
    await setNextBlockTimestamp(
      ethers.provider,
      getPeriodEndTime(1).minus({ seconds: 1 })
    );

    await expect(
      rewardSystem.connect(alice).claimReward(
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        expandTo18Decimals(200), // feeReward
        aliceSignaturePeriod1 // signature
      )
    ).to.revertedWith("RewardSystem: period not ended");
  });

  it("cannot claim reward after expiration", async () => {
    await setNextBlockTimestamp(ethers.provider, getPeriodEndTime(3));

    await expect(
      rewardSystem.connect(alice).claimReward(
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        expandTo18Decimals(200), // feeReward
        aliceSignaturePeriod1 // signature
      )
    ).to.revertedWith("RewardSystem: reward expired");
  });

  it("cannot claim reward if target ratio is not met", async () => {
    await setNextBlockTimestamp(ethers.provider, getPeriodEndTime(1));

    // This is a unit test so we just set it to false directly
    await collateralSystem.mock.IsSatisfyTargetRatio.returns(false);

    await expect(
      rewardSystem.connect(alice).claimReward(
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        expandTo18Decimals(200), // feeReward
        aliceSignaturePeriod1 // signature
      )
    ).to.revertedWith("RewardSystem: below target ratio");
  });

  it("cannot claim reward multiple times", async () => {
    await setNextBlockTimestamp(ethers.provider, getPeriodEndTime(1));

    await rewardSystem.connect(alice).claimReward(
      1, // periodId
      expandTo18Decimals(100), // stakingReward
      expandTo18Decimals(200), // feeReward
      aliceSignaturePeriod1 // signature
    );

    await expect(
      rewardSystem.connect(alice).claimReward(
        1, // periodId
        expandTo18Decimals(100), // stakingReward
        expandTo18Decimals(200), // feeReward
        aliceSignaturePeriod1 // signature
      )
    ).to.revertedWith("RewardSystem: reward already claimed");
  });
});
