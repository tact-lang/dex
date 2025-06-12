//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

const bigintSqrt = (value: bigint): bigint => {
    if (value < 0n) {
        throw new Error("Square root of negative numbers is not supported for bigints.")
    }
    if (value < 2n) {
        return value
    }

    let x0 = value
    let x1 = (value >> 1n) + 1n
    while (x1 < x0) {
        x0 = x1
        x1 = (value / x1 + x1) >> 1n // Newton's method
    }
    return x0
}

const bigintMin = (a: bigint, b: bigint): bigint => {
    return a < b ? a : b
}

type LiquidityProvisioningResult = {
    reserveA: bigint
    reserveB: bigint
    lpTokens: bigint
}

// https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol#L110
// https://github.com/Uniswap/v2-periphery/blob/master/contracts/UniswapV2Router01.sol#L30
export const calculateLiquidityProvisioning = (
    tokenAReserveBefore: bigint,
    tokenBReserveBefore: bigint,
    amountADesired: bigint,
    amountBDesired: bigint,
    amountAMin: bigint,
    amountBMin: bigint,
    mintedLpTokenTotalSupply: bigint,
): LiquidityProvisioningResult => {
    if (tokenAReserveBefore === BigInt(0) && tokenBReserveBefore === BigInt(0)) {
        return {
            lpTokens: bigintSqrt(amountADesired * amountBDesired),
            reserveA: amountADesired,
            reserveB: amountBDesired,
        }
    }

    if (amountADesired * tokenBReserveBefore >= amountBDesired * tokenAReserveBefore) {
        if (amountBDesired < amountBMin) {
            throw new Error("Insufficient B token amount")
        }

        const amountA = (amountBDesired * tokenAReserveBefore) / tokenBReserveBefore
        if (amountA < amountAMin) {
            throw new Error("Insufficient A token amount")
        }

        return {
            lpTokens: bigintMin(
                (amountA * mintedLpTokenTotalSupply) / tokenAReserveBefore,
                (amountBDesired * mintedLpTokenTotalSupply) / tokenBReserveBefore,
            ),
            reserveA: amountA + tokenAReserveBefore,
            reserveB: amountBDesired + tokenBReserveBefore,
        }
    }

    if (amountADesired < amountAMin) {
        throw new Error("Insufficient A token amount")
    }
    const amountB = (amountADesired * tokenBReserveBefore) / tokenAReserveBefore
    if (amountB < amountBMin) {
        throw new Error("Insufficient B token amount")
    }

    return {
        lpTokens: bigintMin(
            (amountADesired * mintedLpTokenTotalSupply) / tokenAReserveBefore,
            (amountB * mintedLpTokenTotalSupply) / tokenBReserveBefore,
        ),
        reserveA: amountADesired + tokenAReserveBefore,
        reserveB: amountB + tokenBReserveBefore,
    }
}

export const calculateLiquidityWithdraw = (
    tokenAReserveBefore: bigint,
    tokenBReserveBefore: bigint,
    burnAmount: bigint,
    amountAMin: bigint,
    amountBMin: bigint,
    mintedLpTokenTotalSupply: bigint,
) => {
    const amountA = (tokenAReserveBefore * burnAmount) / mintedLpTokenTotalSupply
    const amountB = (tokenBReserveBefore * burnAmount) / mintedLpTokenTotalSupply

    if (amountA < amountAMin) {
        throw new Error("Insufficient A token amount")
    }

    if (amountB < amountBMin) {
        throw new Error("Insufficient B token amount")
    }

    return {
        reserveA: tokenAReserveBefore - amountA,
        reserveB: tokenBReserveBefore - amountB,
        amountA,
        amountB,
        totalSupply: mintedLpTokenTotalSupply - burnAmount,
    }
}

// https://github.com/Uniswap/v2-periphery/blob/master/contracts/libraries/UniswapV2Library.sol#L43
export const calculateAmountOut = (
    tokenAReserveBefore: bigint,
    tokenBReserveBefore: bigint,
    poolFee: bigint,
    tokenAIn: bigint,
) => {
    const amountInWithFee = tokenAIn * (1000n - poolFee)
    const numerator = amountInWithFee * tokenBReserveBefore
    const denominator = tokenAReserveBefore * 1000n + amountInWithFee

    return numerator / denominator
}

type SwapResult = {
    reserveA: bigint
    reserveB: bigint
    amountOut: bigint
}

export const calculateSwapResult = (
    tokenAReserveBefore: bigint,
    tokenBReserveBefore: bigint,
    poolFee: bigint,
    tokenAIn: bigint,
    minAmountOut: bigint,
): SwapResult => {
    const amountInWithFee = tokenAIn * (1000n - poolFee)
    const numerator = amountInWithFee * tokenBReserveBefore
    const denominator = tokenAReserveBefore * 1000n + amountInWithFee

    const amountOut = numerator / denominator

    if (amountOut < minAmountOut) {
        throw new Error("Could not satisfy min amount out")
    }

    return {
        amountOut,
        reserveA: tokenAReserveBefore + tokenAIn,
        reserveB: tokenBReserveBefore - amountOut,
    }
}

export const calculateAmountIn = (
    tokenAReserveBefore: bigint,
    tokenBReserveBefore: bigint,
    poolFee: bigint,
    tokenBOut: bigint,
) => {
    const numerator = tokenAReserveBefore * tokenBOut * 1000n
    const denominator = (tokenBReserveBefore - tokenBOut) * (1000n - poolFee)

    return numerator / denominator
}
