// 将数据写入swaps表
import sql from "./supabaseClient";
import { SwapEventV3 } from "../collectors/eventListener";

export interface SwapData {
  // 区块链基础信息
  transaction_hash: string;
  block_number: bigint | number;
  block_timestamp: Date;
  log_index: number;

  // 交易参与方
  sender: string;
  recipient: string;

  // 交易数据
  amount0: string | bigint;
  amount1: string | bigint;
  sqrt_price_x96: string | bigint;
  liquidity: string | bigint;
  tick: number;

  // 计算字段（可选）
  amount0_readable?: number | string | null;
  amount1_readable?: number | string | null;
  price_token0?: number | string | null;
  price_token1?: number | string | null;
  swap_type: "BUY" | "SELL";
  usd_value?: number | string | null;

  // Gas 信息（可选）
  gas_used?: bigint | number | null;
  gas_price?: string | bigint | null;
  transaction_fee?: number | string | null;
}
export async function saveSwap(swap: SwapData): Promise<void> {
  try {
    // 确保所有值都转换为正确的类型
    const blockNumber =
      typeof swap.block_number === "bigint"
        ? Number(swap.block_number)
        : swap.block_number;

    const gasUsed = swap.gas_used
      ? typeof swap.gas_used === "bigint"
        ? Number(swap.gas_used)
        : swap.gas_used
      : null;

    await sql`
      INSERT INTO swaps (
        transaction_hash, block_number, block_timestamp, log_index,
        sender, recipient, amount0, amount1, sqrt_price_x96, liquidity, tick,
        amount0_readable, amount1_readable, price_token0, price_token1, swap_type, usd_value,
        gas_used, gas_price, transaction_fee
      ) VALUES (
        ${swap.transaction_hash}, 
        ${blockNumber}, 
        ${swap.block_timestamp}, 
        ${swap.log_index},
        ${swap.sender}, 
        ${swap.recipient}, 
        ${String(swap.amount0)}::DECIMAL(78, 0), 
        ${String(swap.amount1)}::DECIMAL(78, 0), 
        ${String(swap.sqrt_price_x96)}::DECIMAL(78, 0), 
        ${String(swap.liquidity)}::DECIMAL(78, 0), 
        ${swap.tick},
        ${swap.amount0_readable ?? null}::DECIMAL(28, 18), 
        ${swap.amount1_readable ?? null}::DECIMAL(28, 18), 
        ${swap.price_token0 ?? null}::DECIMAL(28, 18), 
        ${swap.price_token1 ?? null}::DECIMAL(28, 18), 
        ${swap.swap_type}, 
        ${swap.usd_value ?? null}::DECIMAL(18, 2),
        ${gasUsed}::BIGINT, 
        ${swap.gas_price ? String(swap.gas_price) : null}::DECIMAL(28, 0), 
        ${swap.transaction_fee ?? null}::DECIMAL(28, 18)
      )
      ON CONFLICT (transaction_hash, log_index) DO NOTHING;
    `;
    console.log(
      `✅ Swap 数据已保存: ${swap.transaction_hash}, USD 值: ${
        swap.usd_value ?? "N/A"
      }`
    );
  } catch (error) {
    console.error("保存 Swap 数据失败:", error);
    throw error;
  }
}

export async function getSwaps() {
  const swaps = await sql`SELECT * FROM swaps`;
  return swaps;
}
