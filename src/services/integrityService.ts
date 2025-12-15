// 数据完整性检查服务
import sql from "../storage/supabaseClient";

export interface IntegrityCheckResult {
  check_type: string;
  timestamp: Date;
  passed: boolean;
  issues: IntegrityIssue[];
  details?: any;
}

export interface IntegrityIssue {
  severity: "error" | "warning" | "info";
  message: string;
  affected_count?: number;
  details?: any;
}

class IntegrityService {
  /**
   * 检查数据完整性
   */
  async checkDataIntegrity(): Promise<IntegrityCheckResult[]> {
    const results: IntegrityCheckResult[] = [];

    // 1. 检查缺失的交易
    results.push(await this.checkMissingTransactions());

    // 2. 检查重复的交易
    results.push(await this.checkDuplicateTransactions());

    // 3. 检查价格历史完整性
    results.push(await this.checkPriceHistoryIntegrity());

    // 4. 检查区块号连续性
    results.push(await this.checkBlockNumberContinuity());

    // 5. 检查数据一致性（swap vs price_history）
    results.push(await this.checkSwapPriceConsistency());

    // 6. 检查用户统计数据完整性
    results.push(await this.checkUserStatsIntegrity());

    return results;
  }

  /**
   * 检查缺失的交易（通过区块号范围）
   */
  private async checkMissingTransactions(): Promise<IntegrityCheckResult> {
    const issues: IntegrityIssue[] = [];

    try {
      // 获取最小和最大区块号
      const range = await sql`
        SELECT 
          MIN(block_number) as min_block,
          MAX(block_number) as max_block,
          COUNT(*) as total_swaps
        FROM swaps
      `;

      if (range.length === 0 || !range[0].min_block) {
        return {
          check_type: "missing_transactions",
          timestamp: new Date(),
          passed: true,
          issues: [],
        };
      }

      const minBlock = Number(range[0].min_block);
      const maxBlock = Number(range[0].max_block);
      const totalSwaps = Number(range[0].total_swaps);

      // 检查是否有明显的区块号间隙（超过10个区块的间隙）
      const gaps = await sql`
        WITH block_gaps AS (
          SELECT 
            block_number,
            LAG(block_number) OVER (ORDER BY block_number) as prev_block,
            block_number - LAG(block_number) OVER (ORDER BY block_number) as gap
          FROM swaps
          ORDER BY block_number
        )
        SELECT COUNT(*) as gap_count, MAX(gap) as max_gap
        FROM block_gaps
        WHERE gap > 10
      `;

      if (gaps.length > 0 && gaps[0].gap_count > 0) {
        issues.push({
          severity: "warning",
          message: `发现 ${gaps[0].gap_count} 个区块号间隙（最大间隙: ${gaps[0].max_gap} 个区块）`,
          affected_count: Number(gaps[0].gap_count),
        });
      }

      return {
        check_type: "missing_transactions",
        timestamp: new Date(),
        passed: issues.length === 0,
        issues,
        details: {
          min_block: minBlock,
          max_block: maxBlock,
          total_swaps: totalSwaps,
        },
      };
    } catch (error: any) {
      return {
        check_type: "missing_transactions",
        timestamp: new Date(),
        passed: false,
        issues: [
          {
            severity: "error",
            message: `检查失败: ${error.message}`,
          },
        ],
      };
    }
  }

  /**
   * 检查重复的交易
   */
  private async checkDuplicateTransactions(): Promise<IntegrityCheckResult> {
    const issues: IntegrityIssue[] = [];

    try {
      const duplicates = await sql`
        SELECT 
          transaction_hash,
          log_index,
          COUNT(*) as count
        FROM swaps
        GROUP BY transaction_hash, log_index
        HAVING COUNT(*) > 1
      `;

      if (duplicates.length > 0) {
        issues.push({
          severity: "error",
          message: `发现 ${duplicates.length} 个重复的交易记录`,
          affected_count: duplicates.length,
          details: duplicates,
        });
      }

      return {
        check_type: "duplicate_transactions",
        timestamp: new Date(),
        passed: issues.length === 0,
        issues,
      };
    } catch (error: any) {
      return {
        check_type: "duplicate_transactions",
        timestamp: new Date(),
        passed: false,
        issues: [
          {
            severity: "error",
            message: `检查失败: ${error.message}`,
          },
        ],
      };
    }
  }

  /**
   * 检查价格历史完整性
   */
  private async checkPriceHistoryIntegrity(): Promise<IntegrityCheckResult> {
    const issues: IntegrityIssue[] = [];

    try {
      // 检查是否有价格记录但对应的swap不存在
      const orphanedPrices = await sql`
        SELECT COUNT(*) as count
        FROM price_history ph
        WHERE NOT EXISTS (
          SELECT 1 FROM swaps s
          WHERE s.block_timestamp = ph.timestamp
        )
      `;

      const orphanedCount = Number(orphanedPrices[0].count);
      if (orphanedCount > 0) {
        issues.push({
          severity: "warning",
          message: `发现 ${orphanedCount} 个孤立的价格记录（没有对应的swap记录）`,
          affected_count: orphanedCount,
        });
      }

      // 检查价格是否为0或负数
      const invalidPrices = await sql`
        SELECT COUNT(*) as count
        FROM price_history
        WHERE price <= 0 OR price IS NULL
      `;

      const invalidCount = Number(invalidPrices[0].count);
      if (invalidCount > 0) {
        issues.push({
          severity: "error",
          message: `发现 ${invalidCount} 个无效的价格记录（<= 0 或 NULL）`,
          affected_count: invalidCount,
        });
      }

      return {
        check_type: "price_history_integrity",
        timestamp: new Date(),
        passed: issues.length === 0,
        issues,
      };
    } catch (error: any) {
      return {
        check_type: "price_history_integrity",
        timestamp: new Date(),
        passed: false,
        issues: [
          {
            severity: "error",
            message: `检查失败: ${error.message}`,
          },
        ],
      };
    }
  }

  /**
   * 检查区块号连续性
   */
  private async checkBlockNumberContinuity(): Promise<IntegrityCheckResult> {
    const issues: IntegrityIssue[] = [];

    try {
      // 检查区块号是否按时间顺序递增
      const outOfOrder = await sql`
        WITH ordered_blocks AS (
          SELECT 
            block_number,
            block_timestamp,
            LAG(block_timestamp) OVER (ORDER BY block_number) as prev_timestamp
          FROM swaps
          ORDER BY block_number
        )
        SELECT COUNT(*) as count
        FROM ordered_blocks
        WHERE prev_timestamp IS NOT NULL 
          AND block_timestamp < prev_timestamp
      `;

      const outOfOrderCount = Number(outOfOrder[0].count);
      if (outOfOrderCount > 0) {
        issues.push({
          severity: "warning",
          message: `发现 ${outOfOrderCount} 个区块号顺序异常（时间戳不匹配）`,
          affected_count: outOfOrderCount,
        });
      }

      return {
        check_type: "block_number_continuity",
        timestamp: new Date(),
        passed: issues.length === 0,
        issues,
      };
    } catch (error: any) {
      return {
        check_type: "block_number_continuity",
        timestamp: new Date(),
        passed: false,
        issues: [
          {
            severity: "error",
            message: `检查失败: ${error.message}`,
          },
        ],
      };
    }
  }

  /**
   * 检查swap和price_history的一致性
   */
  private async checkSwapPriceConsistency(): Promise<IntegrityCheckResult> {
    const issues: IntegrityIssue[] = [];

    try {
      // 检查有swap但没有价格记录的情况
      const swapsWithoutPrice = await sql`
        SELECT COUNT(*) as count
        FROM swaps s
        WHERE s.price_token0 IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM price_history ph
            WHERE ph.timestamp = s.block_timestamp
          )
      `;

      const missingPriceCount = Number(swapsWithoutPrice[0].count);
      if (missingPriceCount > 0) {
        issues.push({
          severity: "warning",
          message: `发现 ${missingPriceCount} 个swap记录没有对应的价格历史记录`,
          affected_count: missingPriceCount,
        });
      }

      return {
        check_type: "swap_price_consistency",
        timestamp: new Date(),
        passed: issues.length === 0,
        issues,
      };
    } catch (error: any) {
      return {
        check_type: "swap_price_consistency",
        timestamp: new Date(),
        passed: false,
        issues: [
          {
            severity: "error",
            message: `检查失败: ${error.message}`,
          },
        ],
      };
    }
  }

  /**
   * 检查用户统计数据完整性
   */
  private async checkUserStatsIntegrity(): Promise<IntegrityCheckResult> {
    const issues: IntegrityIssue[] = [];

    try {
      // 检查用户统计中的交易数量是否与实际swap记录匹配
      const mismatched = await sql`
        WITH user_swap_counts AS (
          SELECT 
            sender as address,
            COUNT(*) as actual_count
          FROM swaps
          GROUP BY sender
        )
        SELECT 
          us.address,
          us.total_transactions,
          COALESCE(usc.actual_count, 0) as actual_count
        FROM user_stats us
        LEFT JOIN user_swap_counts usc ON us.address = usc.address
        WHERE us.total_transactions != COALESCE(usc.actual_count, 0)
        LIMIT 10
      `;

      if (mismatched.length > 0) {
        issues.push({
          severity: "warning",
          message: `发现 ${mismatched.length} 个用户统计与实际交易数量不匹配`,
          affected_count: mismatched.length,
          details: mismatched,
        });
      }

      return {
        check_type: "user_stats_integrity",
        timestamp: new Date(),
        passed: issues.length === 0,
        issues,
      };
    } catch (error: any) {
      return {
        check_type: "user_stats_integrity",
        timestamp: new Date(),
        passed: false,
        issues: [
          {
            severity: "error",
            message: `检查失败: ${error.message}`,
          },
        ],
      };
    }
  }

  /**
   * 保存完整性检查结果
   */
  async saveIntegrityCheckResult(
    result: IntegrityCheckResult
  ): Promise<void> {
    try {
      await sql`
        INSERT INTO integrity_checks (
          check_type,
          timestamp,
          passed,
          issues_count,
          details
        ) VALUES (
          ${result.check_type},
          ${result.timestamp},
          ${result.passed},
          ${result.issues.length},
          ${JSON.stringify(result)}
        )
      `;
    } catch (error) {
      console.error("保存完整性检查结果失败:", error);
    }
  }
}

// 单例模式
let integrityServiceInstance: IntegrityService | null = null;

export function getIntegrityService(): IntegrityService {
  if (!integrityServiceInstance) {
    integrityServiceInstance = new IntegrityService();
  }
  return integrityServiceInstance;
}

