//SPDX-License-Identifier: Unlicense
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "hardhat/console.sol";

library RightsManager {
    struct Rights {
        bool canPauseSwapping;
        bool canChangeSwapFee;
        bool canChangeWeights;
        bool canAddRemoveTokens;
        bool canWhitelistLPs;
        bool canChangeCap;
    }
}

abstract contract ERC20 {
    function approve(address spender, uint256 amount)
        external
        virtual
        returns (bool);

    function transfer(address dst, uint256 amt) external virtual returns (bool);

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external virtual returns (bool);

    function balanceOf(address whom) external virtual view returns (uint256);

    function allowance(address, address)
        external
        virtual
        view
        returns (uint256);
}

abstract contract BalancerOwnable {
    function setController(address controller) external virtual;
}

abstract contract AbstractPool is ERC20, BalancerOwnable {
    function setSwapFee(uint256 swapFee) external virtual;

    function setPublicSwap(bool public_) external virtual;

    function joinPool(uint256 poolAmountOut, uint256[] calldata maxAmountsIn)
        external
        virtual;

    function joinswapExternAmountIn(
        address tokenIn,
        uint256 tokenAmountIn,
        uint256 minPoolAmountOut
    ) external virtual returns (uint256 poolAmountOut);
}

abstract contract BPool is AbstractPool {
    function finalize() external virtual;

    function bind(
        address token,
        uint256 balance,
        uint256 denorm
    ) external virtual;

    function rebind(
        address token,
        uint256 balance,
        uint256 denorm
    ) external virtual;

    function getSpotPrice(address tokenIn, address tokenOut)
        external virtual
        view
        returns (uint256 spotPrice);

    function unbind(address token) external virtual;

    function isBound(address t) external virtual view returns (bool);

    function getCurrentTokens()
        external
        virtual
        view
        returns (address[] memory);

    function getFinalTokens() external virtual view returns (address[] memory);

    function getBalance(address token) external virtual view returns (uint256);

    function swapExactAmountIn(
        address tokenIn,
        uint256 tokenAmountIn,
        address tokenOut,
        uint256 minAmountOut,
        uint256 maxPrice
    ) external virtual returns (uint256 tokenAmountOut, uint256 spotPriceAfter);

    function swapExactAmountOut(
        address tokenIn,
        uint256 maxAmountIn,
        address tokenOut,
        uint256 tokenAmountOut,
        uint256 maxPrice
    ) external virtual returns (uint256 tokenAmountIn, uint256 spotPriceAfter);
}

abstract contract BFactory {
    function newBPool() external virtual returns (BPool);
}

abstract contract ConfigurableRightsPool is AbstractPool {
    struct PoolParams {
        string poolTokenSymbol;
        string poolTokenName;
        address[] constituentTokens;
        uint256[] tokenBalances;
        uint256[] tokenWeights;
        uint256 swapFee;
    }

    struct CrpParams {
        uint256 initialSupply;
        uint256 minimumWeightChangeBlockPeriod;
        uint256 addTokenTimeLockInBlocks;
    }

    function exitPool(uint poolAmountIn, uint[] calldata minAmountsOut) external virtual;

    function createPool(
        uint256 initialSupply,
        uint256 minimumWeightChangeBlockPeriod,
        uint256 addTokenTimeLockInBlocks
    ) external virtual;

    function getController() external virtual view returns (address);

    function createPool(uint256 initialSupply) external virtual;

    function setCap(uint256 newCap) external virtual;

    function updateWeight(address token, uint256 newWeight) external virtual;

    function updateWeightsGradually(
        uint256[] calldata newWeights,
        uint256 startBlock,
        uint256 endBlock
    ) external virtual;

    function commitAddToken(
        address token,
        uint256 balance,
        uint256 denormalizedWeight
    ) external virtual;

    function applyAddToken() external virtual;

    function removeToken(address token) external virtual;

    function whitelistLiquidityProvider(address provider) external virtual;

    function removeWhitelistedLiquidityProvider(address provider)
        external
        virtual;

    function bPool() external virtual view returns (BPool);
}

abstract contract CRPFactory {
    function newCrp(
        address factoryAddress,
        ConfigurableRightsPool.PoolParams calldata params,
        RightsManager.Rights calldata rights
    ) external virtual returns (ConfigurableRightsPool);
}

/********************************** WARNING **********************************/
//                                                                           //
// This contract is only meant to be used in conjunction with ds-proxy.      //
// Calling this contract directly will lead to loss of funds.                //
//                                                                           //
/********************************** WARNING **********************************/

contract BActions {
    // --- Pool Creation ---

    function create(
        BFactory factory,
        address[] calldata tokens,
        uint256[] calldata balances,
        uint256[] calldata weights,
        uint256 swapFee,
        bool finalize
    ) external returns (BPool pool) {
        require(tokens.length == balances.length, "ERR_LENGTH_MISMATCH");
        require(tokens.length == weights.length, "ERR_LENGTH_MISMATCH");

        pool = factory.newBPool();
        pool.setSwapFee(swapFee);

        for (uint256 i = 0; i < tokens.length; i++) {
            ERC20 token = ERC20(tokens[i]);
            require(
                token.transferFrom(msg.sender, address(this), balances[i]),
                "ERR_TRANSFER_FAILED"
            );
            _safeApprove(token, address(pool), balances[i]);
            pool.bind(tokens[i], balances[i], weights[i]);
        }

        if (finalize) {
            pool.finalize();
            require(
                pool.transfer(msg.sender, pool.balanceOf(address(this))),
                "ERR_TRANSFER_FAILED"
            );
        } else {
            pool.setPublicSwap(true);
        }
    }

    function createSmartPool(
        CRPFactory factory,
        BFactory bFactory,
        ConfigurableRightsPool.PoolParams calldata poolParams,
        ConfigurableRightsPool.CrpParams calldata crpParams,
        RightsManager.Rights calldata rights
    ) external returns (ConfigurableRightsPool crp) {
        require(
            poolParams.constituentTokens.length ==
                poolParams.tokenBalances.length,
            "ERR_LENGTH_MISMATCH"
        );
        require(
            poolParams.constituentTokens.length ==
                poolParams.tokenWeights.length,
            "ERR_LENGTH_MISMATCH"
        );

        crp = factory.newCrp(address(bFactory), poolParams, rights);

        for (uint256 i = 0; i < poolParams.constituentTokens.length; i++) {
            ERC20 token = ERC20(poolParams.constituentTokens[i]);
            require(
                token.transferFrom(
                    msg.sender,
                    address(this),
                    poolParams.tokenBalances[i]
                ),
                "ERR_TRANSFER_FAILED"
            );
            _safeApprove(token, address(crp), poolParams.tokenBalances[i]);
        }

        crp.createPool(
            crpParams.initialSupply,
            crpParams.minimumWeightChangeBlockPeriod,
            crpParams.addTokenTimeLockInBlocks
        );

        require(
            crp.transfer(msg.sender, crpParams.initialSupply),
            "ERR_TRANSFER_FAILED"
        );
        // DSProxy instance keeps pool ownership to enable management
    }

    // --- Joins ---

    function joinPool(
        BPool pool,
        uint256 poolAmountOut,
        uint256[] calldata maxAmountsIn
    ) external {
        address[] memory tokens = pool.getFinalTokens();
        _join(pool, tokens, poolAmountOut, maxAmountsIn);
    }

    function joinSmartPool(
        ConfigurableRightsPool pool,
        uint256 poolAmountOut,
        uint256[] calldata maxAmountsIn
    ) external {
        address[] memory tokens = pool.bPool().getCurrentTokens();
        _join(pool, tokens, poolAmountOut, maxAmountsIn);
    }

    function joinswapExternAmountIn(
        AbstractPool pool,
        ERC20 token,
        uint256 tokenAmountIn,
        uint256 minPoolAmountOut
    ) external {
        require(
            token.transferFrom(msg.sender, address(this), tokenAmountIn),
            "ERR_TRANSFER_FAILED"
        );
        _safeApprove(token, address(pool), tokenAmountIn);
        uint256 poolAmountOut = pool.joinswapExternAmountIn(
            address(token),
            tokenAmountIn,
            minPoolAmountOut
        );
        require(
            pool.transfer(msg.sender, poolAmountOut),
            "ERR_TRANSFER_FAILED"
        );
    }

    // --- Pool management (common) ---

    function setPublicSwap(AbstractPool pool, bool publicSwap) external {
        pool.setPublicSwap(publicSwap);
    }

    function setSwapFee(AbstractPool pool, uint256 newFee) external {
        pool.setSwapFee(newFee);
    }

    function setController(AbstractPool pool, address newController) external {
        pool.setController(newController);
    }

    // --- Private pool management ---

    function setTokens(
        BPool pool,
        address[] calldata tokens,
        uint256[] calldata balances,
        uint256[] calldata denorms
    ) external {
        require(tokens.length == balances.length, "ERR_LENGTH_MISMATCH");
        require(tokens.length == denorms.length, "ERR_LENGTH_MISMATCH");

        for (uint256 i = 0; i < tokens.length; i++) {
            ERC20 token = ERC20(tokens[i]);
            if (pool.isBound(tokens[i])) {
                if (balances[i] > pool.getBalance(tokens[i])) {
                    require(
                        token.transferFrom(
                            msg.sender,
                            address(this),
                            balances[i] - pool.getBalance(tokens[i])
                        ),
                        "ERR_TRANSFER_FAILED"
                    );
                    _safeApprove(
                        token,
                        address(pool),
                        balances[i] - pool.getBalance(tokens[i])
                    );
                }
                if (balances[i] > 10**6) {
                    pool.rebind(tokens[i], balances[i], denorms[i]);
                } else {
                    pool.unbind(tokens[i]);
                }
            } else {
                require(
                    token.transferFrom(msg.sender, address(this), balances[i]),
                    "ERR_TRANSFER_FAILED"
                );
                _safeApprove(token, address(pool), balances[i]);
                pool.bind(tokens[i], balances[i], denorms[i]);
            }

            if (token.balanceOf(address(this)) > 0) {
                require(
                    token.transfer(msg.sender, token.balanceOf(address(this))),
                    "ERR_TRANSFER_FAILED"
                );
            }
        }
    }

    function finalize(BPool pool) external {
        pool.finalize();
        require(
            pool.transfer(msg.sender, pool.balanceOf(address(this))),
            "ERR_TRANSFER_FAILED"
        );
    }

    // --- Smart pool management ---

    function increaseWeight(
        ConfigurableRightsPool crp,
        ERC20 token,
        uint256 newWeight,
        uint256 tokenAmountIn
    ) external {
        require(
            token.transferFrom(msg.sender, address(this), tokenAmountIn),
            "ERR_TRANSFER_FAILED"
        );
        _safeApprove(token, address(crp), tokenAmountIn);
        crp.updateWeight(address(token), newWeight);
        require(
            crp.transfer(msg.sender, crp.balanceOf(address(this))),
            "ERR_TRANSFER_FAILED"
        );
    }

    function decreaseWeight(
        ConfigurableRightsPool crp,
        ERC20 token,
        uint256 newWeight,
        uint256 poolAmountIn
    ) external {
        require(
            crp.transferFrom(msg.sender, address(this), poolAmountIn),
            "ERR_TRANSFER_FAILED"
        );
        crp.updateWeight(address(token), newWeight);
        require(
            token.transfer(msg.sender, token.balanceOf(address(this))),
            "ERR_TRANSFER_FAILED"
        );
    }

    function updateWeightsGradually(
        ConfigurableRightsPool crp,
        uint256[] calldata newWeights,
        uint256 startBlock,
        uint256 endBlock
    ) external {
        crp.updateWeightsGradually(newWeights, startBlock, endBlock);
    }

    function setCap(ConfigurableRightsPool crp, uint256 newCap) external {
        crp.setCap(newCap);
    }

    function commitAddToken(
        ConfigurableRightsPool crp,
        ERC20 token,
        uint256 balance,
        uint256 denormalizedWeight
    ) external {
        crp.commitAddToken(address(token), balance, denormalizedWeight);
    }

    function applyAddToken(
        ConfigurableRightsPool crp,
        ERC20 token,
        uint256 tokenAmountIn
    ) external {
        require(
            token.transferFrom(msg.sender, address(this), tokenAmountIn),
            "ERR_TRANSFER_FAILED"
        );
        _safeApprove(token, address(crp), tokenAmountIn);
        crp.applyAddToken();
        require(
            crp.transfer(msg.sender, crp.balanceOf(address(this))),
            "ERR_TRANSFER_FAILED"
        );
    }

    function removeToken(
        ConfigurableRightsPool crp,
        ERC20 token,
        uint256 poolAmountIn
    ) external {
        require(
            crp.transferFrom(msg.sender, address(this), poolAmountIn),
            "ERR_TRANSFER_FAILED"
        );
        crp.removeToken(address(token));
        require(
            token.transfer(msg.sender, token.balanceOf(address(this))),
            "ERR_TRANSFER_FAILED"
        );
    }

    function whitelistLiquidityProvider(
        ConfigurableRightsPool crp,
        address provider
    ) external {
        crp.whitelistLiquidityProvider(provider);
    }

    function removeWhitelistedLiquidityProvider(
        ConfigurableRightsPool crp,
        address provider
    ) external {
        crp.removeWhitelistedLiquidityProvider(provider);
    }

    // --- Internals ---

    function _safeApprove(
        ERC20 token,
        address spender,
        uint256 amount
    ) internal {
        if (token.allowance(address(this), spender) > 0) {
            token.approve(spender, 0);
        }
        token.approve(spender, amount);
    }

    function _join(
        AbstractPool pool,
        address[] memory tokens,
        uint256 poolAmountOut,
        uint256[] memory maxAmountsIn
    ) internal {
        require(maxAmountsIn.length == tokens.length, "ERR_LENGTH_MISMATCH");

        for (uint256 i = 0; i < tokens.length; i++) {
            ERC20 token = ERC20(tokens[i]);
            require(
                token.transferFrom(msg.sender, address(this), maxAmountsIn[i]),
                "ERR_TRANSFER_FAILED"
            );
            _safeApprove(token, address(pool), maxAmountsIn[i]);
        }
        pool.joinPool(poolAmountOut, maxAmountsIn);
        for (uint256 i = 0; i < tokens.length; i++) {
            ERC20 token = ERC20(tokens[i]);
            if (token.balanceOf(address(this)) > 0) {
                require(
                    token.transfer(msg.sender, token.balanceOf(address(this))),
                    "ERR_TRANSFER_FAILED"
                );
            }
        }
        require(
            pool.transfer(msg.sender, pool.balanceOf(address(this))),
            "ERR_TRANSFER_FAILED"
        );
    }
}
