/**
 * 价格计算器 - 只负责价格相关的计算逻辑
 */
export interface TokenInfo {
  address: string;
  decimals: number;
  symbol?: string;
}

export interface PriceCalculationResult {
  amount0_readable: number;
  amount1_readable: number;
  price_token0: number; // token0 价格（以 token1 计价）
  price_token1: number; // token1 价格（以 token0 计价）
  swap_type: "BUY" | "SELL";
}

export class PriceCalculator {
  private token0Info?: TokenInfo;
  private token1Info?: TokenInfo;

  /**
   * 设置 Token 信息
   */
  setTokenInfo(token0Info: TokenInfo, token1Info: TokenInfo): void {
    this.token0Info = token0Info;
    this.token1Info = token1Info;
  }

  /**
   * 从 sqrtPriceX96 计算价格
   * price = (sqrtPriceX96 / 2^96)^2
   *
   * @param sqrtPriceX96 Q64.96 格式的平方根价格
   * @returns 价格比率 (token1/token0)
   */
  calculatePriceFromSqrtPriceX96(sqrtPriceX96: bigint): number {
    // sqrtPriceX96 是 Q64.96 格式的定点数
    // price = (sqrtPriceX96 / 2^96)^2
    const Q96 = 2n ** 96n;
    const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
    return sqrtPrice * sqrtPrice;
  }

  /**
   * 计算可读数量（考虑 decimals）
   *
   * @param amount 原始数量（wei 单位）
   * @param decimals Token 精度
   * @returns 可读数量
   */
  calculateReadableAmount(amount: bigint, decimals: number): number {
    const divisor = 10n ** BigInt(decimals);
    const absAmount = amount < 0n ? -amount : amount;
    return Number(absAmount) / Number(divisor);
  }

  /**
   * 判断 Swap 类型
   * amount0 < 0 表示卖出 token0，买入 token1 (SELL)
   * amount0 > 0 表示买入 token0，卖出 token1 (BUY)
   *
   * @param amount0 token0 数量变化
   * @returns Swap 类型
   */
  determineSwapType(amount0: bigint): "BUY" | "SELL" {
    return amount0 > 0n ? "SELL" : "BUY";
  }

  /**
   * 计算价格相关字段
   *
   * @param amount0 token0 数量变化
   * @param amount1 token1 数量变化
   * @param sqrtPriceX96 平方根价格
   * @returns 价格计算结果
   */
  calculate(
    amount0: bigint,
    amount1: bigint,
    sqrtPriceX96: bigint
  ): PriceCalculationResult {
    if (!this.token0Info || !this.token1Info) {
      throw new Error("Token 信息未设置，请先调用 setTokenInfo()");
    }

    // 计算可读数量
    const amount0_readable = this.calculateReadableAmount(
      amount0,
      this.token0Info.decimals
    );
    const amount1_readable = this.calculateReadableAmount(
      amount1,
      this.token1Info.decimals
    );

    // 计算价格
    const price = this.calculatePriceFromSqrtPriceX96(sqrtPriceX96);
    // price 是 token1/token0 的比率
    const price_token0 = price; // token0 价格（以 token1 计价）
    const price_token1 = 1 / price; // token1 价格（以 token0 计价）

    // 判断 Swap 类型
    const swap_type = this.determineSwapType(amount0);

    return {
      amount0_readable,
      amount1_readable,
      price_token0,
      price_token1,
      swap_type,
    };
  }

  /**
   * 获取 Token 信息
   */
  getTokenInfo(): { token0?: TokenInfo; token1?: TokenInfo } {
    return {
      token0: this.token0Info,
      token1: this.token1Info,
    };
  }
}
