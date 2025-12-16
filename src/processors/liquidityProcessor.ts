import { PriceCalculator } from "../collectors/priceCalculator";
import {
  MintEventV3,
  BurnEventV3,
  CollectEventV3,
} from "../collectors/eventListener";
import { LiquidityEventData } from "../storage/liquidityRepository";
import { ethers } from "ethers";
import { getPriceService } from "../services/priceService";
import { getQuoterService } from "../services/quoterService";

export class LiquidityProcessor {
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
   * 获取区块时间戳
   */
  private async getBlockTimestamp(blockNumber: number): Promise<Date> {
    const block = await this.provider.getBlock(blockNumber);
    return new Date(block!.timestamp * 1000);
  }

  /**
   * 获取真实的交易发送者（从交易收据中获取）
   */
  private async getActualSender(
    transactionHash: string
  ): Promise<string | null> {
    try {
      const receipt = await this.provider.getTransactionReceipt(
        transactionHash
      );
      return receipt?.from || null;
    } catch (error) {
      console.error("获取真实 sender 失败:", error);
      return null;
    }
  }

  /**
   * 处理 Mint 事件，转换为数据库格式
   */
  async processMint(mintEvent: MintEventV3): Promise<LiquidityEventData> {
    const {
      sender,
      owner,
      tick_lower,
      tick_upper,
      amount,
      amount0,
      amount1,
      transaction_hash,
      log_index,
      block_number,
    } = mintEvent;

    // 计算可读数量
    const tokenInfo = this.priceCalculator.getTokenInfo();
    if (!tokenInfo.token0 || !tokenInfo.token1) {
      throw new Error("Token 信息未设置，请先调用 setTokenInfo()");
    }

    const amount0_readable = this.priceCalculator.calculateReadableAmount(
      amount0,
      tokenInfo.token0.decimals
    );
    const amount1_readable = this.priceCalculator.calculateReadableAmount(
      amount1,
      tokenInfo.token1.decimals
    );

    const block_timestamp = await this.getBlockTimestamp(block_number);

    // 获取真实的 sender（交易发起者）
    const actualSender = await this.getActualSender(transaction_hash);

    // 计算 USD 值
    const usdValue = await this.calculateUSDValue(
      amount0_readable,
      amount1_readable
    );

    const liquidityEvent: LiquidityEventData = {
      transaction_hash,
      block_number: Number(block_number),
      block_timestamp,
      log_index,
      event_type: "MINT",
      owner,
      sender: actualSender || sender, // 优先使用真实的 sender
      liquidity_delta: amount.toString(),
      tick_lower,
      tick_upper,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      amount0_readable,
      amount1_readable,
      usd_value: usdValue,
    };

    return liquidityEvent;
  }

  /**
   * 处理 Burn 事件，转换为数据库格式
   */
  async processBurn(burnEvent: BurnEventV3): Promise<LiquidityEventData> {
    const {
      owner,
      tick_lower,
      tick_upper,
      amount,
      amount0,
      amount1,
      transaction_hash,
      log_index,
      block_number,
    } = burnEvent;

    // 计算可读数量
    const tokenInfo = this.priceCalculator.getTokenInfo();
    if (!tokenInfo.token0 || !tokenInfo.token1) {
      throw new Error("Token 信息未设置，请先调用 setTokenInfo()");
    }

    const amount0_readable = this.priceCalculator.calculateReadableAmount(
      amount0,
      tokenInfo.token0.decimals
    );
    const amount1_readable = this.priceCalculator.calculateReadableAmount(
      amount1,
      tokenInfo.token1.decimals
    );

    const block_timestamp = await this.getBlockTimestamp(block_number);

    // 获取真实的 sender（交易发起者）
    const actualSender = await this.getActualSender(transaction_hash);

    // 计算 USD 值
    const usdValue = await this.calculateUSDValue(
      amount0_readable,
      amount1_readable
    );

    const liquidityEvent: LiquidityEventData = {
      transaction_hash,
      block_number: Number(block_number),
      block_timestamp,
      log_index,
      event_type: "BURN",
      owner,
      sender: actualSender, // 使用真实的 sender（交易发起者）
      liquidity_delta: amount.toString(),
      tick_lower,
      tick_upper,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      amount0_readable,
      amount1_readable,
      usd_value: usdValue,
    };

    return liquidityEvent;
  }

  /**
   * 处理 Collect 事件，转换为数据库格式
   */
  async processCollect(
    collectEvent: CollectEventV3
  ): Promise<LiquidityEventData> {
    const {
      owner,
      recipient,
      tick_lower,
      tick_upper,
      amount0,
      amount1,
      transaction_hash,
      log_index,
      block_number,
    } = collectEvent;

    // 计算可读数量
    const tokenInfo = this.priceCalculator.getTokenInfo();
    if (!tokenInfo.token0 || !tokenInfo.token1) {
      throw new Error("Token 信息未设置，请先调用 setTokenInfo()");
    }

    const amount0_readable = this.priceCalculator.calculateReadableAmount(
      amount0,
      tokenInfo.token0.decimals
    );
    const amount1_readable = this.priceCalculator.calculateReadableAmount(
      amount1,
      tokenInfo.token1.decimals
    );

    const block_timestamp = await this.getBlockTimestamp(block_number);

    // 获取真实的 sender（交易发起者）
    const actualSender = await this.getActualSender(transaction_hash);

    // 计算 USD 值
    const usdValue = await this.calculateUSDValue(
      amount0_readable,
      amount1_readable
    );

    const liquidityEvent: LiquidityEventData = {
      transaction_hash,
      block_number: Number(block_number),
      block_timestamp,
      log_index,
      event_type: "COLLECT",
      owner,
      sender: actualSender || recipient, // 优先使用真实的 sender，失败时使用 recipient
      liquidity_delta: "0", // Collect 事件不改变流动性
      tick_lower,
      tick_upper,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      amount0_readable,
      amount1_readable,
      usd_value: usdValue,
    };

    return liquidityEvent;
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

      // 对于流动性事件（Mint/Burn），使用总和（useSum = true）
      const usdValue = priceService.calculateUSDValue(
        amount0,
        amount1,
        price0,
        price1,
        true // 使用总和而不是平均值
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
