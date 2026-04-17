import { expect } from 'chai';
import { ethers } from 'hardhat';
import { MockUSDC } from '../typechain-types';

describe('MockUSDC', () => {
  let usdc: MockUSDC;
  let alice: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof ethers.getSigners>>[number];

  beforeEach(async () => {
    [alice, bob] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('MockUSDC');
    usdc = (await factory.deploy()) as unknown as MockUSDC;
    await usdc.waitForDeployment();
  });

  it('has 6 decimals', async () => {
    expect(await usdc.decimals()).to.equal(6);
  });

  it('mints up to the faucet cap', async () => {
    await usdc.mint(alice.address, 500n * 10n ** 6n);
    expect(await usdc.balanceOf(alice.address)).to.equal(500n * 10n ** 6n);
  });

  it('rejects mints above the cap', async () => {
    await expect(usdc.mint(alice.address, 1001n * 10n ** 6n)).to.be.revertedWithCustomError(
      usdc,
      'FaucetAmountTooLarge',
    );
  });

  describe('transferWithAuthorization', () => {
    const value = 100n * 10n ** 6n;

    async function signAuth(
      signer: typeof alice,
      from: string,
      to: string,
      amount: bigint,
      validAfter: bigint,
      validBefore: bigint,
      nonce: string,
    ) {
      const domain = {
        name: 'USDC',
        version: '1',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await usdc.getAddress(),
      };
      const types = {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      };
      const sig = await signer.signTypedData(domain, types, {
        from,
        to,
        value: amount,
        validAfter,
        validBefore,
        nonce,
      });
      return ethers.Signature.from(sig);
    }

    it('transfers when signature is valid', async () => {
      await usdc.mint(alice.address, value);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const validAfter = 0n;
      const validBefore = now + 3600n;
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await signAuth(alice, alice.address, bob.address, value, validAfter, validBefore, nonce);

      await usdc.connect(bob).transferWithAuthorization(
        alice.address, bob.address, value,
        validAfter, validBefore, nonce,
        sig.v, sig.r, sig.s,
      );
      expect(await usdc.balanceOf(bob.address)).to.equal(value);
      expect(await usdc.authorizationState(alice.address, nonce)).to.equal(true);
    });

    it('rejects replay of same nonce', async () => {
      await usdc.mint(alice.address, value * 2n);
      const validBefore = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await signAuth(alice, alice.address, bob.address, value, 0n, validBefore, nonce);

      await usdc.transferWithAuthorization(
        alice.address, bob.address, value, 0n, validBefore, nonce, sig.v, sig.r, sig.s,
      );
      await expect(
        usdc.transferWithAuthorization(
          alice.address, bob.address, value, 0n, validBefore, nonce, sig.v, sig.r, sig.s,
        ),
      ).to.be.revertedWithCustomError(usdc, 'AuthorizationAlreadyUsed');
    });

    it('rejects expired authorization', async () => {
      await usdc.mint(alice.address, value);
      const validBefore = BigInt(Math.floor(Date.now() / 1000)) - 10n;
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await signAuth(alice, alice.address, bob.address, value, 0n, validBefore, nonce);

      await expect(
        usdc.transferWithAuthorization(
          alice.address, bob.address, value, 0n, validBefore, nonce, sig.v, sig.r, sig.s,
        ),
      ).to.be.revertedWithCustomError(usdc, 'AuthorizationExpired');
    });
  });
});
