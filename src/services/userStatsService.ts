/**
 * 用户统计服务 - 处理用户交易行为统计
 */
import sql from "../storage/supabaseClient";
import {
  UserStatsData,
  saveOrUpdateUserStats,
  getUserStats,
} from "../storage/userStatsRepository";
import { SwapData } from "../storage/swapRepository";
import { LiquidityEventData } from "../storage/liquidityRepository";

export class UserStatsService {
  /**
   * 更新用户的 Swap 交易统计
   */
  async updateUserStatsFromSwap(swap: SwapData): Promise<void> {
    try {
      // 更新 sender 的统计
      await this.updateUserStatsForAddress(
        swap.sender,
        {
          swapType: swap.swap_type,
          usdValue: Number(swap.usd_value || 0),
          transactionTime: swap.block_timestamp,
        },
        false // 不是流动性提供者
      );

      // 如果 recipient 和 sender 不同，也更新 recipient
      if (
        swap.recipient.toLowerCase() !== swap.sender.toLowerCase()
      ) {
        await this.updateUserStatsForAddress(
          swap.recipient,
          {
            swapType: swap.swap_type,
            usdValue: Number(swap.usd_value || 0),
            transactionTime: swap.block_timestamp,
          },
          false
        );
      }
    } catch (error: any) {
      console.error("更新用户 Swap 统计失败:", error.message || error);
    }
  }

  /**
   * 更新用户的流动性事件统计
   */
  async updateUserStatsFromLiquidityEvent(
    event: LiquidityEventData
  ): Promise<void> {
    try {
      const isLiquidityProvider = event.event_type === "MINT" || event.event_type === "BURN";
      const liquidityValue = Number(event.usd_value || 0);

      await this.updateUserStatsForAddress(
        event.owner,
        {
          swapType: null, // 流动性事件不是 swap
          usdValue: liquidityValue,
          transactionTime: event.block_timestamp,
        },
        isLiquidityProvider,
        liquidityValue
      );

      // 如果 sender 存在且与 owner 不同，也更新 sender
      if (
        event.sender &&
        event.sender.toLowerCase() !== event.owner.toLowerCase()
      ) {
        await this.updateUserStatsForAddress(
          event.sender,
          {
            swapType: null,
            usdValue: liquidityValue,
            transactionTime: event.block_timestamp,
          },
          isLiquidityProvider,
          liquidityValue
        );
      }
    } catch (error: any) {
      console.error("更新用户流动性统计失败:", error.message || error);
    }
  }

  /**
   * 为指定地址更新用户统计
   */
  private async updateUserStatsForAddress(
    address: string,
    transaction: {
      swapType: "BUY" | "SELL" | null;
      usdValue: number;
      transactionTime: Date;
    },
    isLiquidityProvider: boolean,
    liquidityValue: number = 0
  ): Promise<void> {
    try {
      // 获取现有统计数据
      const existingStats = await getUserStats(address);

      // 计算新的统计数据
      const stats: UserStatsData = {
        address,
        total_transactions: (existingStats?.total_transactions || 0) + (transaction.swapType ? 1 : 0),
        buy_transactions:
          (existingStats?.buy_transactions || 0) +
          (transaction.swapType === "BUY" ? 1 : 0),
        sell_transactions:
          (existingStats?.sell_transactions || 0) +
          (transaction.swapType === "SELL" ? 1 : 0),
        total_volume_usd:
          (Number(existingStats?.total_volume_usd || 0)) + transaction.usdValue,
        largest_transaction_usd: this.calculateLargestTransaction(
          existingStats?.largest_transaction_usd,
          transaction.usdValue
        ),
        first_transaction_at: this.calculateFirstTransaction(
          existingStats?.first_transaction_at,
          transaction.transactionTime
        ),
        last_transaction_at: this.calculateLastTransaction(
          existingStats?.last_transaction_at,
          transaction.transactionTime
        ),
        is_liquidity_provider:
          (existingStats?.is_liquidity_provider || false) || isLiquidityProvider,
        total_liquidity_provided_usd:
          (Number(existingStats?.total_liquidity_provided_usd || 0)) +
          (isLiquidityProvider ? liquidityValue : 0),
        user_type: this.determineUserType(
          existingStats,
          transaction.usdValue,
          isLiquidityProvider
        ),
      };

      await saveOrUpdateUserStats(stats);
    } catch (error: any) {
      console.error(`更新用户统计失败 (${address}):`, error.message || error);
      throw error;
    }
  }

  /**
   * 计算最大交易额
   */
  private calculateLargestTransaction(
    existing: number | null | undefined,
    newValue: number
  ): number | null {
    if (newValue <= 0) return existing ?? null;
    if (!existing) return newValue;
    return Math.max(existing, newValue);
  }

  /**
   * 计算首次交易时间
   */
  private calculateFirstTransaction(
    existing: Date | null | undefined,
    newTime: Date
  ): Date {
    if (!existing) return newTime;
    return newTime < new Date(existing) ? newTime : new Date(existing);
  }

  /**
   * 计算最后交易时间
   */
  private calculateLastTransaction(
    existing: Date | null | undefined,
    newTime: Date
  ): Date {
    if (!existing) return newTime;
    return newTime > new Date(existing) ? newTime : new Date(existing);
  }

  /**
   * 确定用户类型
   */
  private determineUserType(
    existingStats: any,
    usdValue: number,
    isLiquidityProvider: boolean
  ): "RETAIL" | "WHALE" | "BOT" | "LP" | "MEV" | null {
    // 如果已经是 LP，保持 LP 类型
    if (isLiquidityProvider || existingStats?.is_liquidity_provider) {
      return "LP";
    }

    // 如果已有类型，保持原类型（除非是 LP）
    if (existingStats?.user_type && existingStats.user_type !== "LP") {
      // 检查是否需要更新为大户
      if (usdValue > 100000) {
        return "WHALE";
      }
      return existingStats.user_type;
    }

    // 根据交易额判断
    if (usdValue > 100000) {
      return "WHALE";
    }

    if (usdValue < 100) {
      return "RETAIL";
    }

    // 默认返回 null，让系统后续分析
    return null;
  }

  /**
   * 批量更新用户统计（从数据库中的 swaps 和 liquidity_events 表）
   * 用于初始化或修复统计数据
   */
  async syncAllUserStats(): Promise<void> {
    console.log("🔄 开始同步所有用户统计数据...");

    try {
      // 从 swaps 表获取所有用户数据
      const swaps = await sql`
        SELECT 
          sender, recipient,
          swap_type, usd_value, block_timestamp
        FROM swaps
        WHERE usd_value IS NOT NULL
        ORDER BY block_timestamp ASC
      `;

      console.log(`   找到 ${swaps.length} 条 Swap 记录`);

      // 处理每个 swap
      for (const swap of swaps) {
        await this.updateUserStatsForAddress(
          swap.sender,
          {
            swapType: swap.swap_type,
            usdValue: Number(swap.usd_value || 0),
            transactionTime: swap.block_timestamp,
          },
          false
        );

        if (
          swap.recipient.toLowerCase() !== swap.sender.toLowerCase()
        ) {
          await this.updateUserStatsForAddress(
            swap.recipient,
            {
              swapType: swap.swap_type,
              usdValue: Number(swap.usd_value || 0),
              transactionTime: swap.block_timestamp,
            },
            false
          );
        }
      }

      // 从 liquidity_events 表获取所有流动性数据
      const liquidityEvents = await sql`
        SELECT 
          owner, sender, event_type, usd_value, block_timestamp
        FROM liquidity_events
        WHERE usd_value IS NOT NULL
        ORDER BY block_timestamp ASC
      `;

      console.log(`   找到 ${liquidityEvents.length} 条流动性事件记录`);

      // 处理每个流动性事件
      for (const event of liquidityEvents) {
        const isLP = event.event_type === "MINT" || event.event_type === "BURN";
        const liquidityValue = Number(event.usd_value || 0);

        await this.updateUserStatsForAddress(
          event.owner,
          {
            swapType: null,
            usdValue: liquidityValue,
            transactionTime: event.block_timestamp,
          },
          isLP,
          liquidityValue
        );

        if (event.sender && event.sender.toLowerCase() !== event.owner.toLowerCase()) {
          await this.updateUserStatsForAddress(
            event.sender,
            {
              swapType: null,
              usdValue: liquidityValue,
              transactionTime: event.block_timestamp,
            },
            isLP,
            liquidityValue
          );
        }
      }

      console.log("✅ 所有用户统计数据同步完成");
    } catch (error: any) {
      console.error("同步用户统计数据失败:", error.message || error);
      throw error;
    }
  }
}

// 导出单例
let userStatsServiceInstance: UserStatsService | null = null;

export function getUserStatsService(): UserStatsService {
  if (!userStatsServiceInstance) {
    userStatsServiceInstance = new UserStatsService();
  }
  return userStatsServiceInstance;
}

