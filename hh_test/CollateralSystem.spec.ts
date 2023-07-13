import { ethers, waffle } from "hardhat";
import { expect, use } from "chai";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expandTo18Decimals, mockAddress, zeroAddress } from "./utilities";

import { AssetRegistry, CollateralSystem, MockERC20 } from "../typechain";

const { formatBytes32String } = ethers.utils;

use(waffle.solidity);

describe("CollateralSystem", function () {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    rewarder: SignerWithAddress,
    rewardLocker: SignerWithAddress;

  let collateralSystem: CollateralSystem,
    athToken: MockERC20,
    assetRegistry: AssetRegistry;

  beforeEach(async function () {
    [deployer, alice, rewarder, rewardLocker] = await ethers.getSigners();

    const CollateralSystem = await ethers.getContractFactory(
      "CollateralSystem"
    );
    const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
    const MockERC20 = await ethers.getContractFactory("MockERC20");

    collateralSystem = await CollateralSystem.deploy();
    await collateralSystem.connect(deployer).__CollateralSystem_init(
      mockAddress, // _priceGetter
      mockAddress, // _debtSystem
      mockAddress, // _mConfig
      rewardLocker.address, // _mRewardLocker
      mockAddress, // _buildBurnSystem
      mockAddress // _liquidation
    );

    athToken = await MockERC20.deploy(
      "Athos Finance", // _name
      "ATH", // _symbol
      18 // _decimals
    );

    assetRegistry = await AssetRegistry.deploy();
    await assetRegistry
      .connect(deployer)
      .__AssetRegistry_init(deployer.address);

    await collateralSystem
      .connect(deployer)
      .updateTokenInfo(formatBytes32String("ATH"), athToken.address, 1, false);
  });

  it("only reward locker can call collateralFromUnlockReward function", async () => {
    await expect(
      collateralSystem
        .connect(alice)
        .collateralFromUnlockReward(
          alice.address,
          rewarder.address,
          formatBytes32String("ATH"),
          1
        )
    ).to.be.revertedWith("CollateralSystem: not reward locker");

    await athToken.mint(rewarder.address, expandTo18Decimals(10));
    await athToken
      .connect(rewarder)
      .approve(collateralSystem.address, expandTo18Decimals(10));

    await collateralSystem
      .connect(rewardLocker)
      .collateralFromUnlockReward(
        alice.address,
        rewarder.address,
        formatBytes32String("ATH"),
        expandTo18Decimals(10)
      );

    expect(
      await collateralSystem.userCollateralData(
        alice.address,
        formatBytes32String("ATH")
      )
    ).to.eq(expandTo18Decimals(10));
  });

  it("reward locker can send reward to collateral system upon reward locked", async () => {
    await athToken.mint(rewarder.address, expandTo18Decimals(10));
    await athToken
      .connect(rewarder)
      .approve(collateralSystem.address, expandTo18Decimals(10));

    expect(
      await collateralSystem.userCollateralData(
        alice.address,
        formatBytes32String("ATH")
      )
    ).to.eq(BigNumber.from("0"));
    expect(await athToken.balanceOf(collateralSystem.address)).to.eq(
      BigNumber.from("0")
    );

    await expect(
      collateralSystem
        .connect(rewardLocker)
        .collateralFromUnlockReward(
          alice.address,
          rewarder.address,
          formatBytes32String("ATH"),
          expandTo18Decimals(10)
        )
    )
      .to.emit(collateralSystem, "CollateralUnlockReward")
      .withArgs(
        alice.address,
        formatBytes32String("ATH"),
        expandTo18Decimals(10),
        expandTo18Decimals(10)
      )
      .to.emit(athToken, "Transfer")
      .withArgs(
        rewarder.address,
        collateralSystem.address,
        expandTo18Decimals(10)
      );

    expect(
      await collateralSystem.userCollateralData(
        alice.address,
        formatBytes32String("ATH")
      )
    ).to.eq(expandTo18Decimals(10));
    let tokeninfo = await collateralSystem.tokenInfos(
      formatBytes32String("ATH")
    );
    expect(tokeninfo.totalCollateral).to.equal(expandTo18Decimals(10));

    expect(await athToken.balanceOf(collateralSystem.address)).to.eq(
      expandTo18Decimals(10)
    );
  });

  it("reward locker must pass a user address to collateralFromUnlockReward function", async () => {
    await expect(
      collateralSystem
        .connect(rewardLocker)
        .collateralFromUnlockReward(
          "0x0000000000000000000000000000000000000000",
          rewarder.address,
          formatBytes32String("ATH"),
          expandTo18Decimals(10)
        )
    ).to.be.revertedWith("CollateralSystem: User address cannot be zero");
  });

  it("reward locker must pass a valid currency to collateralFromUnlockReward function", async () => {
    let ethTokeninfo = await collateralSystem.tokenInfos(
      ethers.utils.formatBytes32String("ETH")
    );
    expect(ethTokeninfo.tokenAddr).to.be.eq(zeroAddress);

    await expect(
      collateralSystem
        .connect(rewardLocker)
        .collateralFromUnlockReward(
          alice.address,
          rewarder.address,
          ethers.utils.formatBytes32String("ETH"),
          expandTo18Decimals(10)
        )
    ).to.be.revertedWith("CollateralSystem: currency symbol mismatch");

    let athTokeninfo = await collateralSystem.tokenInfos(
      formatBytes32String("ATH")
    );
    expect(athTokeninfo.tokenAddr).to.be.eq(athToken.address);

    await athToken.mint(rewarder.address, expandTo18Decimals(1));
    await athToken
      .connect(rewarder)
      .approve(collateralSystem.address, expandTo18Decimals(1));

    await collateralSystem
      .connect(rewardLocker)
      .collateralFromUnlockReward(
        alice.address,
        rewarder.address,
        formatBytes32String("ATH"),
        expandTo18Decimals(1)
      );

    expect(
      await collateralSystem.userCollateralData(
        alice.address,
        formatBytes32String("ATH")
      )
    ).to.eq(expandTo18Decimals(1));
  });

  it("reward locker must pass amount > 0 to collateralFromUnlockReward function", async () => {
    await expect(
      collateralSystem
        .connect(rewardLocker)
        .collateralFromUnlockReward(
          alice.address,
          rewarder.address,
          formatBytes32String("ATH"),
          BigNumber.from(0)
        )
    ).to.be.revertedWith("CollateralSystem: Collateral amount must be > 0");

    await athToken.mint(rewarder.address, expandTo18Decimals(1));
    await athToken
      .connect(rewarder)
      .approve(collateralSystem.address, expandTo18Decimals(1));

    await collateralSystem
      .connect(rewardLocker)
      .collateralFromUnlockReward(
        alice.address,
        rewarder.address,
        formatBytes32String("ATH"),
        expandTo18Decimals(1)
      );

    expect(
      await collateralSystem.userCollateralData(
        alice.address,
        formatBytes32String("ATH")
      )
    ).to.eq(expandTo18Decimals(1));
  });

  it("collateralFromUnlockReward will fail if rewarder doesn't have sufficient balance", async () => {
    expect(
      await collateralSystem.userCollateralData(
        alice.address,
        formatBytes32String("ATH")
      )
    ).to.eq(BigNumber.from("0"));
    expect(await athToken.balanceOf(collateralSystem.address)).to.eq(
      BigNumber.from("0")
    );
    expect(await athToken.balanceOf(rewarder.address)).to.eq(
      BigNumber.from("0")
    );

    await expect(
      collateralSystem
        .connect(rewardLocker)
        .collateralFromUnlockReward(
          alice.address,
          rewarder.address,
          formatBytes32String("ATH"),
          expandTo18Decimals(10)
        )
    ).to.be.revertedWith("TransferHelper: transferFrom failed");
  });
});
