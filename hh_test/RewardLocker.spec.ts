import { ethers, waffle } from "hardhat";
import { expect, use } from "chai";
import { BigNumber, Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  setNextBlockTimestamp,
  getBlockDateTime,
} from "./utilities/timeTravel";
import { DateTime } from "luxon";
import { mockAddress, zeroAddress } from "./utilities";

import { AccessController, RewardLocker } from "../typechain";
import ICollateralSystem from "../hh_out/src/interfaces/ICollateralSystem.sol/ICollateralSystem.json";

const { formatBytes32String } = ethers.utils;

use(waffle.solidity);

describe("RewardLocker", function () {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    charlie: SignerWithAddress,
    rewarder: SignerWithAddress;

  let accessController: AccessController,
    rewardLocker: RewardLocker,
    collateralSystem: Contract;

  beforeEach(async function () {
    [deployer, alice, bob, charlie, rewarder] = await ethers.getSigners();

    const AccessController = await ethers.getContractFactory(
      "AccessController"
    );
    const RewardLocker = await ethers.getContractFactory("RewardLocker");

    accessController = await AccessController.deploy();
    await accessController.connect(deployer).__AccessController_init();

    rewardLocker = await RewardLocker.deploy();
    await rewardLocker.connect(deployer).__RewardLocker_init(
      mockAddress, // _linaTokenAddr
      accessController.address // _accessCtrl
    );

    collateralSystem = await waffle.deployMockContract(
      deployer,
      ICollateralSystem.abi
    );
    await collateralSystem.mock.collateralFromUnlockReward.returns();
  });

  it("only LOCK_REWARD role can add reward", async () => {
    await expect(
      rewardLocker.connect(alice).addReward(
        bob.address, // user
        10, // amount
        20 // unlockTime
      )
    ).to.be.revertedWith("RewardLocker: not LOCK_REWARD role");

    await accessController.connect(deployer).grantRole(
      formatBytes32String("LOCK_REWARD"), // role
      alice.address // account
    );

    await expect(
      rewardLocker.connect(alice).addReward(
        bob.address, // user
        10, // amount
        20 // unlockTime
      )
    )
      .to.emit(rewardLocker, "RewardEntryAdded")
      .withArgs(
        1, //entryId
        bob.address, // user
        10, // amount
        20 // unlockTime
      );

    const rewardEntry = await rewardLocker.rewardEntries(1, bob.address);
    expect(rewardEntry.amount).to.equal(10);
    expect(rewardEntry.unlockTime).to.equal(20);

    expect(await rewardLocker.lockedAmountByAddresses(bob.address)).to.equal(
      10
    );
    expect(await rewardLocker.totalLockedAmount()).to.equal(10);
  });

  it("only owner can migrate rewards", async () => {
    await expect(
      rewardLocker.connect(alice).migrateRewards(
        [alice.address, bob.address], // users
        [10, 20], // amounts
        [30, 40] // unlockTimes
      )
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(
      rewardLocker.connect(deployer).migrateRewards(
        [alice.address, bob.address], // users
        [10, 20], // amounts
        [30, 40] // unlockTimes
      )
    )
      .to.emit(rewardLocker, "RewardEntryAdded")
      .withArgs(
        1, //entryId
        alice.address, // user
        10, // amount
        30 // unlockTime
      )
      .and.emit(rewardLocker, "RewardEntryAdded")
      .withArgs(
        2, //entryId
        bob.address, // user
        20, // amount
        40 // unlockTime
      );

    const aliceEntry = await rewardLocker.rewardEntries(1, alice.address);
    expect(aliceEntry.amount).to.equal(10);
    expect(aliceEntry.unlockTime).to.equal(30);

    const bobEntry = await rewardLocker.rewardEntries(2, bob.address);
    expect(bobEntry.amount).to.equal(20);
    expect(bobEntry.unlockTime).to.equal(40);

    expect(await rewardLocker.lockedAmountByAddresses(alice.address)).to.equal(
      10
    );
    expect(await rewardLocker.lockedAmountByAddresses(bob.address)).to.equal(
      20
    );
    expect(await rewardLocker.totalLockedAmount()).to.equal(30);
  });

  it("reward amount cannot overflow", async () => {
    const uint216Max = BigNumber.from("0x" + "f".repeat(216 / 4));

    // Allow Alice to add reward
    await accessController.connect(deployer).grantRole(
      formatBytes32String("LOCK_REWARD"), // role
      alice.address // account
    );

    await expect(
      rewardLocker.connect(alice).addReward(
        alice.address, // user
        uint216Max.add(1), // amount
        10 // unlockTime
      )
    ).to.revertedWith("RewardLocker: reward amount overflow");

    await rewardLocker.connect(alice).addReward(
      alice.address, // user
      uint216Max, // amount
      10 // unlockTime
    );
  });

  it("unlock time cannot overflow", async () => {
    const uint40Max = BigNumber.from("0x" + "f".repeat(40 / 4));

    // Allow Alice to add reward
    await accessController.connect(deployer).grantRole(
      formatBytes32String("LOCK_REWARD"), // role
      alice.address // account
    );

    await expect(
      rewardLocker.connect(alice).addReward(
        alice.address, // user
        10, // amount
        uint40Max.add(1) // unlockTime
      )
    ).to.revertedWith("RewardLocker: unlock time overflow");

    await rewardLocker.connect(alice).addReward(
      alice.address, // user
      10, // amount
      uint40Max // unlockTime
    );
  });

  it("reward can be unlocked from contract", async () => {
    let unlockTime: DateTime = (await getBlockDateTime(ethers.provider)).plus({
      hours: 1,
    });

    await accessController.connect(deployer).grantRole(
      formatBytes32String("LOCK_REWARD"), // role
      alice.address // account
    );

    await rewardLocker.connect(alice).addReward(
      bob.address, // user
      10, // amount
      unlockTime.toSeconds() // unlockTime
    );

    expect(await rewardLocker.lockedAmountByAddresses(bob.address)).to.equal(
      10
    );

    await setNextBlockTimestamp(ethers.provider, unlockTime);
    await rewardLocker
      .connect(deployer)
      .updateCollateralSystemAddress(collateralSystem.address);
    await rewardLocker
      .connect(deployer)
      .updateRewarderAddress(rewarder.address);

    await expect(
      rewardLocker.connect(charlie).unlockReward(
        bob.address, // user
        1 // rewardEntryId
      )
    )
      .to.emit(rewardLocker, "RewardEntryUnlocked")
      .withArgs(
        1, //entryId
        bob.address, // user
        10 // amount
      );

    const rewardEntry = await rewardLocker.rewardEntries(1, bob.address);
    expect(rewardEntry.amount).to.equal(0);
    expect(rewardEntry.unlockTime).to.equal(0);

    expect(await rewardLocker.lockedAmountByAddresses(bob.address)).to.equal(0);
    expect(await rewardLocker.totalLockedAmount()).to.equal(0);
  });

  it("only owner can set collateral system address", async () => {
    expect(await rewardLocker.collateralSystemAddr()).to.be.eq(zeroAddress);
    await expect(
      rewardLocker
        .connect(alice)
        .updateCollateralSystemAddress(collateralSystem.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await rewardLocker
      .connect(deployer)
      .updateCollateralSystemAddress(collateralSystem.address);
    expect(await rewardLocker.collateralSystemAddr()).to.be.eq(
      collateralSystem.address
    );
  });

  it("only owner can set rewarder address", async () => {
    expect(await rewardLocker.rewarderAddress()).to.be.eq(zeroAddress);
    await expect(
      rewardLocker.connect(alice).updateRewarderAddress(rewarder.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await rewardLocker
      .connect(deployer)
      .updateRewarderAddress(rewarder.address);
    expect(await rewardLocker.rewarderAddress()).to.be.eq(rewarder.address);
  });

  it("cannot unlock reward if collateral system and rewarder address is not set", async () => {
    await expect(
      rewardLocker.connect(charlie).unlockReward(
        bob.address, // user
        1 // rewardEntryId
      )
    ).to.be.revertedWith("RewardLocker: Rewarder address not set");

    rewardLocker.connect(deployer).updateRewarderAddress(rewarder.address);
    await expect(
      rewardLocker.connect(charlie).unlockReward(
        bob.address, // user
        1 // rewardEntryId
      )
    ).to.be.revertedWith("RewardLocker: Collateral system address not set");
  });

  it("cannot unlock reward if user doesn't have reward locked", async () => {
    rewardLocker
      .connect(deployer)
      .updateCollateralSystemAddress(collateralSystem.address);
    rewardLocker.connect(deployer).updateRewarderAddress(rewarder.address);

    await expect(
      rewardLocker.connect(charlie).unlockReward(
        bob.address, // user
        1 // rewardEntryId
      )
    ).to.be.revertedWith(
      "RewardLocker: Reward entry amount is 0, no reward to unlock"
    );
  });

  it("reward can only be unlocked if unlock time is reached", async () => {
    let unlockTime: DateTime = (await getBlockDateTime(ethers.provider)).plus({
      hours: 1,
    });

    await accessController.connect(deployer).grantRole(
      formatBytes32String("LOCK_REWARD"), // role
      alice.address // account
    );

    await rewardLocker.connect(alice).addReward(
      bob.address, // user
      10, // amount
      unlockTime.toSeconds() // unlockTime
    );

    expect(await rewardLocker.lockedAmountByAddresses(bob.address)).to.equal(
      10
    );

    rewardLocker
      .connect(deployer)
      .updateCollateralSystemAddress(collateralSystem.address);
    rewardLocker.connect(deployer).updateRewarderAddress(rewarder.address);

    await setNextBlockTimestamp(
      ethers.provider,
      unlockTime.minus({ seconds: 10 }).toSeconds()
    );
    await expect(
      rewardLocker.connect(charlie).unlockReward(
        bob.address, // user
        1 // rewardEntryId
      )
    ).to.be.revertedWith("RewardLocker: Unlock time not reached");

    await setNextBlockTimestamp(
      ethers.provider,
      unlockTime.plus({ seconds: 1 }).toSeconds()
    );

    await expect(
      rewardLocker.connect(charlie).unlockReward(
        bob.address, // user
        1 // rewardEntryId
      )
    )
      .to.emit(rewardLocker, "RewardEntryUnlocked")
      .withArgs(
        1, //entryId
        bob.address, // user
        10 // amount
      );

    const rewardEntry = await rewardLocker.rewardEntries(1, bob.address);
    expect(rewardEntry.amount).to.equal(0);
    expect(rewardEntry.unlockTime).to.equal(0);

    expect(await rewardLocker.lockedAmountByAddresses(bob.address)).to.equal(0);
    expect(await rewardLocker.totalLockedAmount()).to.equal(0);
  });

  describe("Swap Entries", function () {
    beforeEach(async function () {
      await rewardLocker.connect(deployer).migrateRewards(
        [alice.address, alice.address], // users
        [10, 20], // amounts
        [30, 40] // unlockTimes
      );
    });

    it("only owner can swap reward entries", async () => {
      await expect(
        rewardLocker.connect(alice).swapRewardEntries(
          alice.address, // user
          [1, 2], // entryIds
          [5, 10, 15], // newAmounts
          [50, 60, 70] // newUnlockTimes
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await rewardLocker.connect(deployer).swapRewardEntries(
        alice.address, // user
        [1, 2], // entryIds
        [5, 10, 15], // newAmounts
        [50, 60, 70] // newUnlockTimes
      );
    });

    it("cannot swap entries with mismatched amounts", async () => {
      await expect(
        rewardLocker.connect(deployer).swapRewardEntries(
          alice.address, // user
          [1, 2], // entryIds
          [5, 10, 10], // newAmounts
          [50, 60, 70] // newUnlockTimes
        )
      ).to.be.revertedWith("RewardLocker: total amount mismatch");
    });

    it("cannot swap non-existent entries", async () => {
      await expect(
        rewardLocker.connect(deployer).swapRewardEntries(
          alice.address, // user
          [2, 3], // entryIds
          [5, 10, 15], // newAmounts
          [50, 60, 70] // newUnlockTimes
        )
      ).to.be.revertedWith("RewardLocker: entry not found");
    });

    // Quick and dirty sanity test
    it("sanity test", async () => {
      await expect(
        rewardLocker.connect(deployer).swapRewardEntries(
          alice.address, // user
          [1, 2], // entryIds
          [5, 10, 15], // newAmounts
          [50, 60, 70] // newUnlockTimes
        )
      )
        .to.emit(rewardLocker, "RewardEntryRemoved")
        .withArgs(
          1 //entryId
        )
        .and.emit(rewardLocker, "RewardEntryRemoved")
        .withArgs(
          2 //entryId
        )
        .and.emit(rewardLocker, "RewardEntryAdded")
        .withArgs(
          3, //entryId
          alice.address, // user
          5, // amount
          50 // unlockTime
        )
        .and.emit(rewardLocker, "RewardEntryAdded")
        .withArgs(
          4, //entryId
          alice.address, // user
          10, // amount
          60 // unlockTime
        )
        .and.emit(rewardLocker, "RewardEntryAdded")
        .withArgs(
          5, //entryId
          alice.address, // user
          15, // amount
          70 // unlockTime
        );

      const entry1 = await rewardLocker.rewardEntries(1, alice.address);
      expect(entry1.amount).to.equal(0);
      expect(entry1.unlockTime).to.equal(0);

      const entry2 = await rewardLocker.rewardEntries(2, bob.address);
      expect(entry2.amount).to.equal(0);
      expect(entry2.unlockTime).to.equal(0);

      const entry3 = await rewardLocker.rewardEntries(3, alice.address);
      expect(entry3.amount).to.equal(5);
      expect(entry3.unlockTime).to.equal(50);

      const entry4 = await rewardLocker.rewardEntries(4, alice.address);
      expect(entry4.amount).to.equal(10);
      expect(entry4.unlockTime).to.equal(60);

      const entry5 = await rewardLocker.rewardEntries(5, alice.address);
      expect(entry5.amount).to.equal(15);
      expect(entry5.unlockTime).to.equal(70);

      expect(
        await rewardLocker.lockedAmountByAddresses(alice.address)
      ).to.equal(30);
      expect(await rewardLocker.totalLockedAmount()).to.equal(30);

      expect(await rewardLocker.lastRewardEntryId()).to.equal(5);
    });
  });
});
