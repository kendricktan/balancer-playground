const { expect } = require("chai");
const { ethers } = require("hardhat");

const ADDRESSES = {
  BActions: "0x2fcc6f96418764439f8dc26af559ed5cddaeefac",
  Factory: "0xed52d8e202401645edad1c0aa21e872498ce47d0",
  BFactory: "0x9424b1412450d0f8fc2255faf6046b98213b76bd",
  DSProxyRegistry: "0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4",
  ExchangeProxy: "0x3E66B66Fd1d0b02fDa6C811Da9E0547970DB2f21",
};

describe("Balancer Smart Pool", function () {
  it("Initialize", async function () {
    const [user] = await ethers.getSigners();

    const ProxyRegistry = await ethers.getContractAt(
      "ProxyRegistry",
      ADDRESSES.DSProxyRegistry
    );
    
    const BActionsFactory = await ethers.getContractFactory('BActions')
    const BActions = await BActionsFactory.deploy()

    let proxyAddress = await ProxyRegistry.proxies(user.address);
    if (proxyAddress === ethers.constants.AddressZero) {
      await ProxyRegistry["build()"]();
      proxyAddress = await ProxyRegistry.proxies(user.address);
    }

    const MockERC20 = await ethers.getContractFactory("MockERC20");

    const Proxy = await ethers.getContractAt("DSProxy", proxyAddress);
    const Token0 = await MockERC20.deploy("Token0", "TK0");
    const Token1 = await MockERC20.deploy("Token1", "TK1");

    await Token0.mint(user.address, ethers.utils.parseEther("1000"))
    await Token1.mint(user.address, ethers.utils.parseEther("1000"))

    // Approve proxy to get tokens
    await Token0.approve(proxyAddress, ethers.constants.MaxUint256);
    await Token1.approve(proxyAddress, ethers.constants.MaxUint256);

    // Create smart pool
    // const data = ethers.utils.defaultAbiCoder.encode(
    //   [
    //     "address",
    //     "address",
    //     "tuple(string,string,address[],uint256[],uint256[],uint256)",
    //     "tuple(uint256,uint256,uint256)",
    //     "tuple(bool,bool,bool,bool,bool,bool)",
    //   ],
    //   [
    //     ADDRESSES.Factory,
    //     ADDRESSES.BFactory,
    //     [
    //       "Smart Pool",
    //       "SPT",
    //       [Token0.address, Token1.address],
    //       [ethers.constants.One, ethers.constants.One],
    //       [ethers.utils.parseEther("25"), ethers.utils.parseEther("25")],
    //       ethers.utils.parseEther("0.1"),
    //     ],
    //     [ethers.utils.parseEther("100"), "10", "10"],
    //     [true, true, true, true, true, true],
    //   ]
    // );

    const data = BActions.interface.encodeFunctionData("createSmartPool", [
      ADDRESSES.Factory,
      ADDRESSES.BFactory,
      [
        "SPT",
        "Smart Pool",
        [Token0.address, Token1.address],
        [ethers.utils.parseEther("1"), ethers.utils.parseEther("1")],
        [ethers.utils.parseEther("25"), ethers.utils.parseEther("25")],
        ethers.utils.parseEther("0.1"),
      ],
      [ethers.utils.parseEther("100"), "90000", "500"],
      [true, true, true, true, true, false],
    ]);

    await Proxy["execute(address,bytes)"](BActions.address, data, { gasLimit: '16000000'});
  });
});
