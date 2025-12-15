// 查询性能监控中间件
import sql from "../storage/supabaseClient";
import crypto from "crypto";

/**
 * 记录查询性能
 */
export async function recordQueryPerformance(
  queryType: string,
  queryText: string,
  executionTimeMs: number,
  rowsReturned?: number
): Promise<void> {
  try {
    const queryHash = crypto
      .createHash("sha256")
      .update(queryText)
      .digest("hex")
      .substring(0, 64);

    await sql`
      INSERT INTO query_performance (
        query_type,
        query_hash,
        execution_time_ms,
        rows_returned,
        query_text
      ) VALUES (
        ${queryType},
        ${queryHash},
        ${executionTimeMs},
        ${rowsReturned || null},
        ${queryText.substring(0, 1000)} -- 限制长度
      )
    `;
  } catch (error) {
    // 静默失败，不影响主流程
    console.error("记录查询性能失败:", error);
  }
}

/**
 * 包装数据库查询以监控性能
 */
export function withQueryPerformance<T>(
  queryType: string,
  queryText: string,
  queryFn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  return queryFn()
    .then((result) => {
      const executionTime = Date.now() - startTime;
      const rowsReturned = Array.isArray(result) ? result.length : undefined;
      recordQueryPerformance(queryType, queryText, executionTime, rowsReturned);
      return result;
    })
    .catch((error) => {
      const executionTime = Date.now() - startTime;
      recordQueryPerformance(queryType, queryText, executionTime, 0);
      throw error;
    });
}
