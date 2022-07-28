import { ethers } from "hardhat";
import { Signer, providers } from "ethers";
import LedgerSigner from "./ledgerSigner";
import TtySigner from "./ttySigner";

enum SignerType {
  Hardhat = "hardhat",
  Ledger = "ledger",
  Tty = "tty",
}

export async function selectSigner(
  provider?: providers.Provider
): Promise<Signer> {
  switch (process.env.SIGNER_TYPE) {
    case SignerType.Ledger: {
      const path = process.env.LEDGER_PATH || "m/44'/60'/0'/0/0";
      return new LedgerSigner(path, provider || ethers.provider, true);
    }
    case SignerType.Tty: {
      const outputFile = process.env.TTY_OUTPUT_FILE || undefined;
      return new TtySigner(outputFile, provider || ethers.provider);
    }
    case SignerType.Hardhat:
    case null:
    case undefined: {
      const hardhatSigners = await ethers.getSigners();
      return hardhatSigners[0];
    }
    default: {
      throw new Error(`Unknown SIGNER_TYPE value: ${process.env.SIGNER_TYPE}`);
    }
  }
}
