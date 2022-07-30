import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "@typechain/hardhat";
import { HardhatUserConfig } from "hardhat/types";

const config: HardhatUserConfig = {
  paths: {
    cache: "hh_cache",
    artifacts: "hh_out",
    sources: "src",
    tests: "hh_test",
  },
  networks: {
    moonbeam: {
      url: process.env.MOONBEAM_RPC || "https://rpc.api.moonbeam.network/",
      chainId: 1284,
      gas: 8_000_000,
      gasPrice: 150_000_000_000,
    },
  },
  solidity: {
    compilers: [
      // For WETH9
      {
        version: "0.4.19",
        settings: {
          optimizer: {
            enabled: false,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.15",
        settings: {
          optimizer: {
            enabled: true,
            runs: 999999,
          },
        },
      },
    ],
  },
  typechain: {
    outDir: "typechain",
  },
};

export default config;
