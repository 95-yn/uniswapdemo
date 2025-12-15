// 用户统计数据存储
import sql from "./supabaseClient";

export interface UserStatsData {
  address: string;
  total_transactions: number;
  buy_transactions: number;
  sell_transactions: number;
  total_volume_usd: number;
  largest_transaction_usd?: number | null;
  first_transaction_at?: Date | null;
  last_transaction_at?: Date | null;
  is_liquidity_provider: boolean;
  total_liquidity_provided_usd: number;
  user_type?: "RETAIL" | "WHALE" | "BOT" | "LP" | "MEV" | null;
}

/**
 * 保存或更新用户统计数据
 */
export async function saveOrUpdateUserStats(
  stats: UserStatsData
): Promise<void> {
  try {
    await sql`
      INSERT INTO user_stats (
        address,
        total_transactions, buy_transactions, sell_transactions,
        total_volume_usd, largest_transaction_usd,
        first_transaction_at, last_transaction_at,
        is_liquidity_provider, total_liquidity_provided_usd,
        user_type
      ) VALUES (
        ${stats.address},
        ${stats.total_transactions},
        ${stats.buy_transactions},
        ${stats.sell_transactions},
        ${stats.total_volume_usd}::DECIMAL(18, 2),
        ${stats.largest_transaction_usd ?? null}::DECIMAL(18, 2),
        ${stats.first_transaction_at ?? null},
        ${stats.last_transaction_at ?? null},
        ${stats.is_liquidity_provider},
        ${stats.total_liquidity_provided_usd}::DECIMAL(18, 2),
        ${stats.user_type ?? null}
      )
      ON CONFLICT (address) DO UPDATE SET
        total_transactions = EXCLUDED.total_transactions,
        buy_transactions = EXCLUDED.buy_transactions,
        sell_transactions = EXCLUDED.sell_transactions,
        total_volume_usd = EXCLUDED.total_volume_usd,
        largest_transaction_usd = GREATEST(
          COALESCE(user_stats.largest_transaction_usd, 0),
          COALESCE(EXCLUDED.largest_transaction_usd, 0)
        ),
        first_transaction_at = LEAST(
          COALESCE(user_stats.first_transaction_at, EXCLUDED.first_transaction_at),
          EXCLUDED.first_transaction_at
        ),
        last_transaction_at = GREATEST(
          COALESCE(user_stats.last_transaction_at, EXCLUDED.last_transaction_at),
          EXCLUDED.last_transaction_at
        ),
        is_liquidity_provider = user_stats.is_liquidity_provider OR EXCLUDED.is_liquidity_provider,
        total_liquidity_provided_usd = EXCLUDED.total_liquidity_provided_usd,
        user_type = COALESCE(EXCLUDED.user_type, user_stats.user_type),
        updated_at = NOW();
    `;
  } catch (error) {
    console.error(`保存用户统计数据失败 (${stats.address}):`, error);
    throw error;
  }
}

/**
 * 获取用户统计数据
 */
export async function getUserStats(address: string) {
  const stats = await sql`
    SELECT * FROM user_stats 
    WHERE address = ${address}
    LIMIT 1
  `;
  return stats[0] || null;
}

/**
 * 获取所有用户统计数据（按交易量排序）
 */
export async function getAllUserStats(limit: number = 100) {
  const stats = await sql`
    SELECT * FROM user_stats 
    ORDER BY total_volume_usd DESC 
    LIMIT ${limit}
  `;
  return stats;
}

/**
 * 获取指定类型的用户
 */
export async function getUserStatsByType(
  userType: "RETAIL" | "WHALE" | "BOT" | "LP" | "MEV",
  limit: number = 100
) {
  const stats = await sql`
    SELECT * FROM user_stats 
    WHERE user_type = ${userType}
    ORDER BY total_volume_usd DESC 
    LIMIT ${limit}
  `;
  return stats;
}

