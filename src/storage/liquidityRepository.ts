// 将流动性事件数据写入 liquidity_events 表
import sql from "./supabaseClient";
import {
  MintEventV3,
  BurnEventV3,
  CollectEventV3,
} from "../collectors/eventListener";

export interface LiquidityEventData {
  // 区块链基础信息
  transaction_hash: string;
  block_number: bigint | number;
  block_timestamp: Date;
  log_index: number;

  // 事件类型
  event_type: "MINT" | "BURN" | "COLLECT";

  // 用户信息
  owner: string;
  sender?: string | null;

  // 流动性信息
  liquidity_delta: string | bigint;
  tick_lower: number;
  tick_upper: number;

  // Token 数量
  amount0: string | bigint;
  amount1: string | bigint;
  amount0_readable?: number | string | null;
  amount1_readable?: number | string | null;
  usd_value?: number | string | null;
}

export async function saveLiquidityEvent(
  event: LiquidityEventData
): Promise<void> {
  try {
    // 确保所有值都转换为正确的类型
    const blockNumber =
      typeof event.block_number === "bigint"
        ? Number(event.block_number)
        : event.block_number;

    await sql`
      INSERT INTO liquidity_events (
        transaction_hash, block_number, block_timestamp, log_index,
        event_type, owner, sender,
        liquidity_delta, tick_lower, tick_upper,
        amount0, amount1, amount0_readable, amount1_readable, usd_value
      ) VALUES (
        ${event.transaction_hash}, 
        ${blockNumber}, 
        ${event.block_timestamp}, 
        ${event.log_index},
        ${event.event_type}, 
        ${event.owner}, 
        ${event.sender ?? null},
        ${String(event.liquidity_delta)}::DECIMAL(78, 0), 
        ${event.tick_lower}, 
        ${event.tick_upper},
        ${String(event.amount0)}::DECIMAL(78, 0), 
        ${String(event.amount1)}::DECIMAL(78, 0), 
        ${event.amount0_readable ?? null}::DECIMAL(28, 18), 
        ${event.amount1_readable ?? null}::DECIMAL(28, 18), 
        ${event.usd_value ?? null}::DECIMAL(18, 2)
      )
      ON CONFLICT (transaction_hash, log_index) DO NOTHING;
    `;
    console.log(
      `✅ 流动性事件已保存: ${event.event_type} - ${
        event.transaction_hash
      }, USD 值: ${event.usd_value ?? "N/A"}`
    );
  } catch (error) {
    console.error("保存流动性事件数据失败:", error);
    throw error;
  }
}

export async function getLiquidityEvents() {
  const events =
    await sql`SELECT * FROM liquidity_events ORDER BY block_timestamp DESC`;
  return events;
}
