import { PriceCalculator } from "../collectors/priceCalculator";
import { SwapEventV3 } from "../collectors/eventListener";
import { SwapData } from "../storage/swapRepository";
import { ethers } from "ethers";
import { getPriceService } from "../services/priceService";
import { getQuoterService } from "../services/quoterService";

export class SwapProcessor {
  private priceCalculator: PriceCalculator;
  private provider: ethers.JsonRpcProvider;
  private token0Address?: string;
  private token1Address?: string;
  private token0Symbol?: string;
  private token1Symbol?: string;
  private token0Decimals?: number;
  private token1Decimals?: number;
  private chainId?: number;

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
    this.priceCalculator = new PriceCalculator();
  }

  /**
   * 设置 Token 信息到价格计算器
   */
  setTokenInfo(
    token0Decimals: number,
    token1Decimals: number,
    token0Symbol?: string,
    token1Symbol?: string,
    token0Address?: string,
    token1Address?: string
  ): void {
    this.token0Address = token0Address;
    this.token1Address = token1Address;
    this.token0Symbol = token0Symbol;
    this.token1Symbol = token1Symbol;
    this.token0Decimals = token0Decimals;
    this.token1Decimals = token1Decimals;
    this.priceCalculator.setTokenInfo(
      {
        address: token0Address || "",
        decimals: token0Decimals,
        symbol: token0Symbol,
      },
      {
        address: token1Address || "",
        decimals: token1Decimals,
        symbol: token1Symbol,
      }
    );
  }

  /**
   * 处理 Swap 事件，转换为数据库格式
   */
  async processSwap(swapEvent: SwapEventV3): Promise<SwapData> {
    const {
      sender,
      recipient,
      amount0,
      amount1,
      sqrt_price_x96,
      liquidity,
      tick,
      transaction_hash,
      log_index,
    } = swapEvent;

    // 1. 计算价格相关字段
    const priceResult = this.priceCalculator.calculate(
      amount0,
      amount1,
      sqrt_price_x96
    );

    // 2. 获取 Gas 信息
    const gasInfo = await this.getGasInfo(transaction_hash);

    // 3. 计算交易手续费（ETH）
    const transactionFee =
      gasInfo.gas_used && gasInfo.gas_price
        ? Number(BigInt(gasInfo.gas_used) * BigInt(gasInfo.gas_price)) / 1e18
        : null;
    const block_number = await this.getBlockNumber(transaction_hash);
    const block_timestamp = await this.getBlockTimestamp(block_number);
    const actualSender = await this.getActualSender(transaction_hash);

    // 4. 计算 USD 值
    const usdValue = await this.calculateUSDValue(
      priceResult.amount0_readable,
      priceResult.amount1_readable
    );

    // 5. 转换 block_timestamp 为 Date
    const blockTimestamp = new Date(block_timestamp);

    // 6. 构建符合数据库格式的数据
    const swapData: SwapData = {
      // 区块链基础信息
      transaction_hash,
      block_number: Number(block_number),
      block_timestamp: blockTimestamp,
      log_index,

      // 交易参与方
      sender: actualSender || sender,
      recipient,

      // 交易数据（bigint 转为 string，数据库 DECIMAL 类型）
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      sqrt_price_x96: sqrt_price_x96.toString(),
      liquidity: liquidity.toString(),
      tick,

      // 计算字段（来自 priceResult）
      amount0_readable: priceResult.amount0_readable,
      amount1_readable: priceResult.amount1_readable,
      price_token0: priceResult.price_token0,
      price_token1: priceResult.price_token1,
      swap_type: priceResult.swap_type,
      usd_value: usdValue,

      // Gas 信息
      gas_used: gasInfo.gas_used ? BigInt(gasInfo.gas_used) : null,
      gas_price: gasInfo.gas_price || null,
      transaction_fee: transactionFee,
    };

    return swapData;
  }

  /**
   * 获取 Gas 信息
   */
  private async getGasInfo(transactionHash: string): Promise<{
    gas_used?: string;
    gas_price?: string;
  }> {
    try {
      const receipt = await this.provider.getTransactionReceipt(
        transactionHash
      );
      if (!receipt) {
        return {};
      }

      return {
        gas_used: receipt.gasUsed.toString(),
        gas_price: receipt.gasPrice?.toString() || "0",
      };
    } catch (error) {
      console.error("获取 Gas 信息失败:", error);
      return {};
    }
  }

  /**
   * 获取 block_timestamp
   */
  private async getBlockTimestamp(blockNumber: number): Promise<Date> {
    const block = await this.provider.getBlock(blockNumber);
    if (!block) {
      throw new Error(`无法获取区块 ${blockNumber} 的信息`);
    }
    return new Date(block.timestamp * 1000);
  }

  /**
   * 获取 block_number
   */
  private async getBlockNumber(transactionHash: string): Promise<number> {
    const receipt = await this.provider.getTransactionReceipt(transactionHash);
    return receipt?.blockNumber || 0;
  }

  /**
   * 获取 实际发送人
   */
  private async getActualSender(transactionHash: string): Promise<string> {
    const receipt = await this.provider.getTransactionReceipt(transactionHash);
    return receipt?.from || "";
  }

  /**
   * 获取 实际接收人
   */
  private async getActualRecipient(transactionHash: string): Promise<string> {
    const receipt = await this.provider.getTransactionReceipt(transactionHash);
    return receipt?.to || "";
  }

  /**
   * 计算 USD 值（优先使用 Quoter，失败时回退到 CoinGecko）
   */
  private async calculateUSDValue(
    amount0: number,
    amount1: number
  ): Promise<number | null> {
    try {
      if (!this.token0Address || !this.token1Address) {
        console.warn("⚠️  Token 地址未设置，无法计算 USD 值");
        return null;
      }

      if (
        this.token0Decimals === undefined ||
        this.token1Decimals === undefined
      ) {
        console.warn("⚠️  Token 精度未设置，无法计算 USD 值");
        return null;
      }

      // 优先使用 Quoter 服务（链上实时价格）
      try {
        const quoterService = getQuoterService(this.provider);
        const usdValue = await quoterService.calculateUSDValue(
          amount0,
          amount1,
          this.token0Address,
          this.token1Address,
          this.token0Decimals,
          this.token1Decimals
        );

        if (usdValue !== null) {
          console.log(
            `✅ 通过 Quoter 计算 USD 值成功: $${usdValue.toFixed(2)}`
          );
          return usdValue;
        }
      } catch (error: any) {
        console.warn("⚠️  Quoter 服务失败，回退到 CoinGecko:", error.message);
      }

      // 回退到 CoinGecko API
      if (!this.chainId) {
        try {
          const network = await this.provider.getNetwork();
          this.chainId = Number(network.chainId);
        } catch (error: any) {
          console.warn("⚠️  无法获取链 ID:", error.message);
          return null;
        }
      }

      const priceService = getPriceService();

      console.log(
        `💰 使用 CoinGecko 获取价格: token0(${
          this.token0Symbol || "N/A"
        }) / token1(${this.token1Symbol || "N/A"})`
      );

      // 并行获取两个 token 的价格
      const [price0, price1] = await Promise.all([
        priceService.getTokenPrice(
          this.token0Address,
          this.token0Symbol,
          this.chainId
        ),
        priceService.getTokenPrice(
          this.token1Address,
          this.token1Symbol,
          this.chainId
        ),
      ]);

      const usdValue = priceService.calculateUSDValue(
        amount0,
        amount1,
        price0,
        price1
      );

      if (usdValue !== null) {
        console.log(
          `✅ 通过 CoinGecko 计算 USD 值成功: $${usdValue.toFixed(2)}`
        );
      } else {
        console.warn(
          `⚠️  USD 值计算失败: price0=${price0}, price1=${price1}, amount0=${amount0}, amount1=${amount1}`
        );
      }

      return usdValue;
    } catch (error: any) {
      console.error("计算 USD 值失败:", error.message || error);
      return null;
    }
  }
}
