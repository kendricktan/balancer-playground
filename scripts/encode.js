const ethers = require("ethers");

const data = ethers.utils.defaultAbiCoder.encode(
  [
    "address",
    "address",
    "tuple(string,string,address[],uint256[],uint256[],uint256)",
    "tuple(uint256,uint256,uint256)",
    "tuple(bool,bool,bool,bool,bool,bool)",
  ],
  [
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
    [
      "Smart Pool",
      "SPT",
      [ethers.constants.AddressZero, ethers.constants.AddressZero],
      [ethers.constants.One, ethers.constants.One],
      [ethers.utils.parseEther("25"), ethers.utils.parseEther("25")],
      ethers.utils.parseEther("0.1"),
    ],
    [ethers.utils.parseEther("100"), "10", "10"],
    [true, true, true, true, true, true],
  ]
);

console.log(data)