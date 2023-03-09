import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import {
  expandTo18Decimals,
  expandTo8Decimals,
  uint256Max,
} from "../utilities";
import { deployAthosStack, DeployedStack } from "../utilities/init";
import { getBlockDateTime } from "../utilities/timeTravel";

const { formatBytes32String } = ethers.utils;

describe("Integration | Build", function () {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress;

  let stack: DeployedStack;

  beforeEach(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    stack = await deployAthosStack(deployer);

    // Set ATH price to $0.01
    await stack.athOracle.connect(deployer).setPrice(
      expandTo8Decimals(0.01) // price
    );

    // Mint 1,000,000 ATH to Alice
    await stack.collaterals.ath.token
      .connect(deployer)
      .transfer(alice.address, expandTo18Decimals(1_000_000));

    await stack.collaterals.ath.token
      .connect(alice)
      .approve(stack.collaterals.ath.collateralSystem.address, uint256Max);
  });

  it("can build athUSD with just locked reward", async function () {
    // Lock 10,000 ATH of rewards for Alice
    await stack.rewardLocker.connect(deployer).migrateRewards(
      [alice.address], // _users
      [expandTo18Decimals(10_000)], // _amounts
      [(await getBlockDateTime(ethers.provider)).plus({ years: 1 }).toSeconds()] // _lockTo
    );

    // Alice can build 1 athUSD without staking
    await stack.collaterals.ath.buildBurnSystem.connect(alice).BuildAsset(
      expandTo18Decimals(1) // amount
    );

    expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
      expandTo18Decimals(1)
    );
  });

  it("maxRedeemableLina() should return staked amount when debt is zero regardless of locked collateral", async function () {
    // Alice stakes 9,000 ATH
    await stack.collaterals.ath.collateralSystem.connect(alice).Collateral(
      formatBytes32String("ATH"), // _currency
      expandTo18Decimals(9_000) // _amount
    );

    // Returns 9,000 when locked amount is zero
    expect(
      await stack.collaterals.ath.collateralSystem.maxRedeemableLina(
        alice.address // user
      )
    ).to.equal(expandTo18Decimals(9_000));

    // Lock rewards for Alice
    await stack.rewardLocker.connect(deployer).migrateRewards(
      [alice.address], // _users
      [expandTo18Decimals(9_000).sub(1)], // _amounts
      [(await getBlockDateTime(ethers.provider)).plus({ years: 1 }).toSeconds()] // _lockTo
    );

    // Returns 9,000 when locked amount is less than staked
    expect(
      await stack.collaterals.ath.collateralSystem.maxRedeemableLina(
        alice.address // user
      )
    ).to.equal(expandTo18Decimals(9_000));

    // Lock 1 unit of ATH rewards for Alice
    await stack.rewardLocker.connect(deployer).migrateRewards(
      [alice.address], // _users
      [1], // _amounts
      [(await getBlockDateTime(ethers.provider)).plus({ years: 1 }).toSeconds()] // _lockTo
    );

    // Returns 9,000 when locked amount is the same as staked
    expect(
      await stack.collaterals.ath.collateralSystem.maxRedeemableLina(
        alice.address // user
      )
    ).to.equal(expandTo18Decimals(9_000));

    // Lock 1 unit of ATH rewards for Alice
    await stack.rewardLocker.connect(deployer).migrateRewards(
      [alice.address], // _users
      [1], // _amounts
      [(await getBlockDateTime(ethers.provider)).plus({ years: 1 }).toSeconds()] // _lockTo
    );

    // Returns 9,000 when locked amount is the same as staked
    expect(
      await stack.collaterals.ath.collateralSystem.maxRedeemableLina(
        alice.address // user
      )
    ).to.equal(expandTo18Decimals(9_000));
  });

  it("maxRedeemableLina() should reflect debt amount", async function () {
    // Alice stakes 9,000 ATH
    await stack.collaterals.ath.collateralSystem.connect(alice).Collateral(
      formatBytes32String("ATH"), // _currency
      expandTo18Decimals(9_000) // _amount
    );

    // Alice builds 10 athUSD
    await stack.collaterals.ath.buildBurnSystem.connect(alice).BuildAsset(
      expandTo18Decimals(10) // amount
    );

    // 5,000 ATH is set aside
    expect(
      await stack.collaterals.ath.collateralSystem.maxRedeemableLina(
        alice.address // user
      )
    ).to.equal(expandTo18Decimals(4_000));

    // Lock 4,000 ATH rewards for Alice
    await stack.rewardLocker.connect(deployer).migrateRewards(
      [alice.address], // _users
      [expandTo18Decimals(4_000)], // _amounts
      [(await getBlockDateTime(ethers.provider)).plus({ years: 1 }).toSeconds()] // _lockTo
    );

    // Now 8,000 ATH is withdrawable
    expect(
      await stack.collaterals.ath.collateralSystem.maxRedeemableLina(
        alice.address // user
      )
    ).to.equal(expandTo18Decimals(8_000));

    // Lock 1,000 ATH rewards for Alice
    await stack.rewardLocker.connect(deployer).migrateRewards(
      [alice.address], // _users
      [expandTo18Decimals(1_000)], // _amounts
      [(await getBlockDateTime(ethers.provider)).plus({ years: 1 }).toSeconds()] // _lockTo
    );

    // All staked amount available
    expect(
      await stack.collaterals.ath.collateralSystem.maxRedeemableLina(
        alice.address // user
      )
    ).to.equal(expandTo18Decimals(9_000));

    // Locking more won't increase withdrawable amount
    await stack.rewardLocker.connect(deployer).migrateRewards(
      [alice.address], // _users
      [1], // _amounts
      [(await getBlockDateTime(ethers.provider)).plus({ years: 1 }).toSeconds()] // _lockTo
    );
    expect(
      await stack.collaterals.ath.collateralSystem.maxRedeemableLina(
        alice.address // user
      )
    ).to.equal(expandTo18Decimals(9_000));
  });
});
