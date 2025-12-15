// ============================================
// 环境变量加载 - 必须在所有其他导入之前
// ============================================
import serverless from "serverless-http";
import dotenv from "dotenv";
import { resolve } from "path";
import { existsSync } from "fs";

// 明确指定 .env 文件路径
const envPath = resolve(process.cwd(), ".env");

if (!existsSync(envPath)) {
  console.warn("⚠️  未找到 .env 文件，将使用系统环境变量或默认值");
  console.warn(`   尝试路径: ${envPath}`);
} else {
  dotenv.config({ path: envPath });
  console.log("✅ 环境变量已从 .env 文件加载");
}

// 验证必需的环境变量（可选）
const requiredEnvVars = ["RPC_URL", "POOL_ADDRESS"];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

import express, { Request, Response, NextFunction } from "express";
import { getEventListener } from "./collectors/eventListener";

import { SwapProcessor } from "./processors/swapProcessor";
import { saveSwap } from "./storage/swapRepository";
import { LiquidityProcessor } from "./processors/liquidityProcessor";
import { saveLiquidityEvent } from "./storage/liquidityRepository";
import { getUserStatsService } from "./services/userStatsService";
import { savePriceHistory } from "./storage/priceHistoryRepository";
import { ethers } from "ethers";
import { SnapshotService } from "./services/snapshotService";
import { SchedulerService } from "./services/schedulerService";
import { getMetricsService } from "./services/metricsService";
import { getIntegrityService } from "./services/integrityService";

const app: express.Application = express();
const router = express.Router();
const eventListener = getEventListener();

// Express 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Pool 合约 ABI（用于获取 token0, token1）
const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

// ERC20 Token ABI（用于获取 decimals 和 symbol）
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

/**
 * 带重试的 RPC 调用
 */
async function retryRpcCall<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 2000,
  operation: string = "RPC 调用"
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error("请求超时")), 30000)
        ),
      ]);
    } catch (error: any) {
      lastError = error;
      if (i < maxRetries - 1) {
        console.warn(
          `${operation} 失败 (尝试 ${i + 1}/${maxRetries}):`,
          error.message || error
        );
        console.log(`⏳ ${delay / 1000} 秒后重试...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// 初始化 Token 信息
async function initializeTokenInfo(
  provider: ethers.JsonRpcProvider,
  poolAddress: string,
  swapProcessor: SwapProcessor,
  liquidityProcessor: LiquidityProcessor
): Promise<{
  token0Address: string;
  token1Address: string;
  token0Decimals: number;
  token1Decimals: number;
  token0Symbol: string;
  token1Symbol: string;
}> {
  try {
    console.log("🔄 开始初始化 Token 信息...");

    // 使用重试机制获取 token 地址
    const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
    const [token0Address, token1Address] = await retryRpcCall(
      () => Promise.all([poolContract.token0(), poolContract.token1()]),
      3,
      2000,
      "获取 Token 地址"
    );

    console.log(`   Token0 地址: ${token0Address}`);
    console.log(`   Token1 地址: ${token1Address}`);

    const token0Contract = new ethers.Contract(
      token0Address,
      ERC20_ABI,
      provider
    );
    const token1Contract = new ethers.Contract(
      token1Address,
      ERC20_ABI,
      provider
    );

    // 使用重试机制获取 token 信息
    const [token0Decimals, token1Decimals, token0Symbol, token1Symbol] =
      await retryRpcCall(
        () =>
          Promise.all([
            token0Contract.decimals(),
            token1Contract.decimals(),
            token0Contract.symbol().catch(() => ""),
            token1Contract.symbol().catch(() => ""),
          ]),
        3,
        2000,
        "获取 Token 信息"
      );

    swapProcessor.setTokenInfo(
      Number(token0Decimals),
      Number(token1Decimals),
      token0Symbol,
      token1Symbol,
      token0Address,
      token1Address
    );
    liquidityProcessor.setTokenInfo(
      Number(token0Decimals),
      Number(token1Decimals),
      token0Symbol,
      token1Symbol,
      token0Address,
      token1Address
    );

    console.log(
      `✅ Token 信息初始化完成: token0(${
        token0Symbol || token0Address
      }, ${token0Decimals}) / token1(${
        token1Symbol || token1Address
      }, ${token1Decimals})`
    );

    // 返回 token 信息
    return {
      token0Address,
      token1Address,
      token0Decimals: Number(token0Decimals),
      token1Decimals: Number(token1Decimals),
      token0Symbol: token0Symbol || "",
      token1Symbol: token1Symbol || "",
    };
  } catch (error: any) {
    console.error("❌ 初始化 Token 信息失败:", error.message || error);
    console.error("   请检查 RPC_URL 是否正确，或网络连接是否正常");
    throw error;
  }
}

// 健康检查
router.get("/health", async (req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
  });
});

// 获取监听状态
router.get("/api/uniswap-v3/status", async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: eventListener.getListeningStatus(),
  });
});

// 获取用户统计
router.get("/api/user-stats/:address", async (req: Request, res: Response) => {
  const { address } = req.params;
  const { getUserStats } = await import("./storage/userStatsRepository");
  try {
    const stats = await getUserStats(address);
    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "获取用户统计失败",
    });
  }
});

// 获取所有用户统计（按交易量排序）
router.get("/api/user-stats", async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const { getAllUserStats } = await import("./storage/userStatsRepository");
  try {
    const stats = await getAllUserStats(limit);
    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "获取用户统计失败",
    });
  }
});

// 手动同步所有用户统计数据
router.post("/api/user-stats/sync", async (req: Request, res: Response) => {
  const userStatsService = getUserStatsService();
  try {
    res.json({
      success: true,
      message: "开始同步用户统计数据...",
    });
    // 异步执行同步，不阻塞响应
    userStatsService.syncAllUserStats().catch((error: any) => {
      console.error("同步用户统计数据失败:", error);
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "启动同步失败",
    });
  }
});

// 获取价格历史记录
router.get("/api/price-history", async (req: Request, res: Response) => {
  const { getPriceHistory, getLatestPrice } = await import(
    "./storage/priceHistoryRepository"
  );
  try {
    const startTime = req.query.start_time
      ? new Date(req.query.start_time as string)
      : undefined;
    const endTime = req.query.end_time
      ? new Date(req.query.end_time as string)
      : undefined;
    const limit = parseInt(req.query.limit as string) || 1000;

    // 如果没有指定时间范围，返回最新价格
    if (!startTime && !endTime && !req.query.limit) {
      const latest = await getLatestPrice();
      res.json({
        success: true,
        data: latest,
      });
      return;
    }

    const history = await getPriceHistory(startTime, endTime, limit);
    res.json({
      success: true,
      data: history,
      count: history.length,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "获取价格历史失败",
    });
  }
});

// 获取系统性能指标
router.get("/api/metrics", async (req: Request, res: Response) => {
  const { getMetricsService } = await import("./services/metricsService");
  const metricsService = getMetricsService();

  try {
    const startTime = req.query.start_time
      ? new Date(req.query.start_time as string)
      : undefined;
    const endTime = req.query.end_time
      ? new Date(req.query.end_time as string)
      : undefined;
    const limit = parseInt(req.query.limit as string) || 100;

    // 如果指定了时间范围，从数据库获取聚合指标
    if (startTime && endTime) {
      const aggregated = await metricsService.getAggregatedMetrics(
        startTime,
        endTime
      );
      res.json({
        success: true,
        data: aggregated,
      });
    } else {
      // 否则返回内存中的实时指标
      const realtime = metricsService.getSystemMetrics(limit);
      res.json({
        success: true,
        data: realtime,
        source: "realtime",
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "获取性能指标失败",
    });
  }
});

// 执行数据完整性检查
router.post("/api/integrity/check", async (req: Request, res: Response) => {
  const { getIntegrityService } = await import("./services/integrityService");
  const integrityService = getIntegrityService();

  try {
    const results = await integrityService.checkDataIntegrity();

    // 保存检查结果
    for (const result of results) {
      await integrityService.saveIntegrityCheckResult(result);
    }

    res.json({
      success: true,
      data: results,
      summary: {
        total_checks: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        total_issues: results.reduce((sum, r) => sum + r.issues.length, 0),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "执行完整性检查失败",
    });
  }
});

// 获取最近的完整性检查结果
router.get("/api/integrity/results", async (req: Request, res: Response) => {
  const sql = (await import("./storage/supabaseClient")).default;

  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const results = await sql`
      SELECT * FROM integrity_checks
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;

    res.json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "获取完整性检查结果失败",
    });
  }
});

// 获取查询性能统计
router.get("/api/query-performance", async (req: Request, res: Response) => {
  const sql = (await import("./storage/supabaseClient")).default;

  try {
    const startTime = req.query.start_time
      ? new Date(req.query.start_time as string)
      : undefined;
    const endTime = req.query.end_time
      ? new Date(req.query.end_time as string)
      : undefined;
    const limit = parseInt(req.query.limit as string) || 100;

    let query;
    if (startTime && endTime) {
      query = sql`
        SELECT 
          query_type,
          COUNT(*) as execution_count,
          AVG(execution_time_ms) as avg_time_ms,
          MIN(execution_time_ms) as min_time_ms,
          MAX(execution_time_ms) as max_time_ms,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms) as p95_time_ms,
          SUM(rows_returned) as total_rows
        FROM query_performance
        WHERE timestamp >= ${startTime} AND timestamp <= ${endTime}
        GROUP BY query_type
        ORDER BY avg_time_ms DESC
        LIMIT ${limit}
      `;
    } else {
      query = sql`
        SELECT 
          query_type,
          COUNT(*) as execution_count,
          AVG(execution_time_ms) as avg_time_ms,
          MIN(execution_time_ms) as min_time_ms,
          MAX(execution_time_ms) as max_time_ms,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms) as p95_time_ms,
          SUM(rows_returned) as total_rows
        FROM query_performance
        WHERE timestamp >= NOW() - INTERVAL '1 hour'
        GROUP BY query_type
        ORDER BY avg_time_ms DESC
        LIMIT ${limit}
      `;
    }

    const stats = await query;
    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "获取查询性能统计失败",
    });
  }
});

// 使用路由
app.use(router);

// 错误处理中间件（必须放在所有路由之后）
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message || "Internal Server Error",
  });
  console.error("Error:", err);
});

// 启动服务器
const PORT = process.env.PORT || 3000;
const poolAddress = (process.env.POOL_ADDRESS ||
  "0xc6962004f452be9203591991d15f6b388e09e8d0") as `0x${string}`;

app.listen(PORT, async () => {
  console.log(`🚀 Express server is running on http://localhost:${PORT}`);
  console.log(`📝 Health check: http://localhost:${PORT}/health`);
  console.log(`📡 Status API: http://localhost:${PORT}/api/uniswap-v3/status`);

  // 初始化 Processor 和 Token 信息
  const swapProcessor = new SwapProcessor(eventListener.getProvider());
  const liquidityProcessor = new LiquidityProcessor(
    eventListener.getProvider()
  );

  try {
    // 等待 Provider 就绪并检测网络
    console.log("⏳ 等待 RPC 节点连接...");
    try {
      const network = await Promise.race([
        eventListener.getProvider().getNetwork(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("网络检测超时")), 15000)
        ),
      ]);
    } catch (error: any) {
      console.warn("⚠️  无法检测网络，但将继续尝试初始化:", error.message);
      console.warn("   如果后续操作失败，请检查 RPC_URL 是否正确");
    }

    // 初始化 Token 信息（带重试机制）
    const tokenInfo = await initializeTokenInfo(
      eventListener.getProvider(),
      poolAddress,
      swapProcessor,
      liquidityProcessor
    );

    // 初始化快照服务并启动定时任务
    const snapshotService = new SnapshotService(
      eventListener.getProvider(),
      poolAddress
    );
    snapshotService.setTokenInfo(
      tokenInfo.token0Address,
      tokenInfo.token1Address,
      tokenInfo.token0Decimals,
      tokenInfo.token1Decimals
    );

    const schedulerService = new SchedulerService(snapshotService);
    // 保存引用以便优雅关闭（在文件底部定义）
    if (typeof schedulerServiceInstance === "undefined") {
      (global as any).schedulerServiceInstance = schedulerService;
    } else {
      schedulerServiceInstance = schedulerService;
    }
    schedulerService.startAllTasks();
    console.log("✅ 所有定时任务已启动（每小时和每天）");

    // 初始化用户统计服务
    const userStatsService = getUserStatsService();

    // 初始化监控服务
    const metricsService = getMetricsService();
    const integrityService = getIntegrityService();

    // 启动 Swap 事件监听（带性能监控）
    await eventListener.listenSwap(poolAddress, (event) => {
      const eventTimestamp = new Date();
      const processingStart = new Date();
      let processingEnd: Date;
      let storageStart: Date;
      let storageEnd: Date;
      let success = false;
      let errorMessage: string | undefined;

      console.log("处理 Swap 事件:", event);
      swapProcessor
        .processSwap(event)
        .then(async (result) => {
          processingEnd = new Date();
          storageStart = new Date();

          console.log("Swap 事件处理结果:", result);

          try {
            await saveSwap(result);

            // 保存价格历史记录
            if (
              result.price_token0 !== null &&
              result.price_token0 !== undefined
            ) {
              try {
                await savePriceHistory({
                  timestamp: result.block_timestamp,
                  block_number: result.block_number,
                  price: Number(result.price_token0),
                });
              } catch (error: any) {
                console.error("保存价格历史记录失败:", error.message || error);
              }
            }

            // 更新用户统计
            await userStatsService.updateUserStatsFromSwap(result);

            storageEnd = new Date();
            success = true;

            // 记录性能指标
            metricsService.recordEvent({
              event_type: "swap",
              event_timestamp: eventTimestamp,
              processing_start: processingStart,
              processing_end: processingEnd,
              storage_start: storageStart,
              storage_end: storageEnd,
              success: true,
              transaction_hash: result.transaction_hash,
              block_number:
                typeof result.block_number === "bigint"
                  ? Number(result.block_number)
                  : result.block_number,
            });
          } catch (error: any) {
            storageEnd = new Date();
            success = false;
            errorMessage = error.message || String(error);

            // 记录失败指标
            metricsService.recordEvent({
              event_type: "swap",
              event_timestamp: eventTimestamp,
              processing_start: processingStart,
              processing_end: processingEnd,
              storage_start: storageStart,
              storage_end: storageEnd,
              success: false,
              error_message: errorMessage,
              transaction_hash: result.transaction_hash,
              block_number:
                typeof result.block_number === "bigint"
                  ? Number(result.block_number)
                  : result.block_number,
            });

            throw error;
          }
        })
        .catch((error: any) => {
          processingEnd = new Date();
          storageStart = new Date();
          storageEnd = new Date();
          success = false;
          errorMessage = error.message || String(error);

          console.error("Swap 事件处理失败:", error);

          // 记录失败指标
          metricsService.recordEvent({
            event_type: "swap",
            event_timestamp: eventTimestamp,
            processing_start: processingStart,
            processing_end: processingEnd,
            storage_start: storageStart,
            storage_end: storageEnd,
            success: false,
            error_message: errorMessage,
            transaction_hash: event.transaction_hash,
            block_number: event.block_number,
          });
        });
    });

    // 启动 Mint 事件监听（带性能监控）
    await eventListener.listenMint(poolAddress, (event) => {
      const eventTimestamp = new Date();
      const processingStart = new Date();

      console.log("处理 Mint 事件:", event);
      liquidityProcessor
        .processMint(event)
        .then(async (result) => {
          const processingEnd = new Date();
          const storageStart = new Date();

          console.log("Mint 事件处理结果:", result);

          try {
            await saveLiquidityEvent(result);
            // 更新用户统计
            await userStatsService.updateUserStatsFromLiquidityEvent(result);

            const storageEnd = new Date();

            // 记录性能指标
            metricsService.recordEvent({
              event_type: "mint",
              event_timestamp: eventTimestamp,
              processing_start: processingStart,
              processing_end: processingEnd,
              storage_start: storageStart,
              storage_end: storageEnd,
              success: true,
              transaction_hash: result.transaction_hash,
              block_number:
                typeof result.block_number === "bigint"
                  ? Number(result.block_number)
                  : result.block_number,
            });
          } catch (error: any) {
            const storageEnd = new Date();
            metricsService.recordEvent({
              event_type: "mint",
              event_timestamp: eventTimestamp,
              processing_start: processingStart,
              processing_end: processingEnd,
              storage_start: storageStart,
              storage_end: storageEnd,
              success: false,
              error_message: error.message || String(error),
              transaction_hash: result.transaction_hash,
              block_number:
                typeof result.block_number === "bigint"
                  ? Number(result.block_number)
                  : result.block_number,
            });
            throw error;
          }
        })
        .catch((error: any) => {
          const processingEnd = new Date();
          const storageStart = new Date();
          const storageEnd = new Date();

          console.error("Mint 事件处理失败:", error);

          metricsService.recordEvent({
            event_type: "mint",
            event_timestamp: eventTimestamp,
            processing_start: processingStart,
            processing_end: processingEnd,
            storage_start: storageStart,
            storage_end: storageEnd,
            success: false,
            error_message: error.message || String(error),
            transaction_hash: event.transaction_hash,
            block_number: event.block_number,
          });
        });
    });

    // 启动 Burn 事件监听（带性能监控）
    await eventListener.listenBurn(poolAddress, (event) => {
      const eventTimestamp = new Date();
      const processingStart = new Date();

      console.log("处理 Burn 事件:", event);
      liquidityProcessor
        .processBurn(event)
        .then(async (result) => {
          const processingEnd = new Date();
          const storageStart = new Date();

          console.log("Burn 事件处理结果:", result);

          try {
            await saveLiquidityEvent(result);
            // 更新用户统计
            await userStatsService.updateUserStatsFromLiquidityEvent(result);

            const storageEnd = new Date();

            metricsService.recordEvent({
              event_type: "burn",
              event_timestamp: eventTimestamp,
              processing_start: processingStart,
              processing_end: processingEnd,
              storage_start: storageStart,
              storage_end: storageEnd,
              success: true,
              transaction_hash: result.transaction_hash,
              block_number:
                typeof result.block_number === "bigint"
                  ? Number(result.block_number)
                  : result.block_number,
            });
          } catch (error: any) {
            const storageEnd = new Date();
            metricsService.recordEvent({
              event_type: "burn",
              event_timestamp: eventTimestamp,
              processing_start: processingStart,
              processing_end: processingEnd,
              storage_start: storageStart,
              storage_end: storageEnd,
              success: false,
              error_message: error.message || String(error),
              transaction_hash: result.transaction_hash,
              block_number:
                typeof result.block_number === "bigint"
                  ? Number(result.block_number)
                  : result.block_number,
            });
            throw error;
          }
        })
        .catch((error: any) => {
          const processingEnd = new Date();
          const storageStart = new Date();
          const storageEnd = new Date();

          console.error("Burn 事件处理失败:", error);

          metricsService.recordEvent({
            event_type: "burn",
            event_timestamp: eventTimestamp,
            processing_start: processingStart,
            processing_end: processingEnd,
            storage_start: storageStart,
            storage_end: storageEnd,
            success: false,
            error_message: error.message || String(error),
            transaction_hash: event.transaction_hash,
            block_number: event.block_number,
          });
        });
    });

    // 启动 Collect 事件监听（带性能监控）
    await eventListener.listenCollect(poolAddress, (event) => {
      const eventTimestamp = new Date();
      const processingStart = new Date();

      console.log("处理 Collect 事件:", event);
      liquidityProcessor
        .processCollect(event)
        .then(async (result) => {
          const processingEnd = new Date();
          const storageStart = new Date();

          console.log("Collect 事件处理结果:", result);

          try {
            await saveLiquidityEvent(result);
            // 更新用户统计
            await userStatsService.updateUserStatsFromLiquidityEvent(result);

            const storageEnd = new Date();

            metricsService.recordEvent({
              event_type: "collect",
              event_timestamp: eventTimestamp,
              processing_start: processingStart,
              processing_end: processingEnd,
              storage_start: storageStart,
              storage_end: storageEnd,
              success: true,
              transaction_hash: result.transaction_hash,
              block_number:
                typeof result.block_number === "bigint"
                  ? Number(result.block_number)
                  : result.block_number,
            });
          } catch (error: any) {
            const storageEnd = new Date();
            metricsService.recordEvent({
              event_type: "collect",
              event_timestamp: eventTimestamp,
              processing_start: processingStart,
              processing_end: processingEnd,
              storage_start: storageStart,
              storage_end: storageEnd,
              success: false,
              error_message: error.message || String(error),
              transaction_hash: result.transaction_hash,
              block_number:
                typeof result.block_number === "bigint"
                  ? Number(result.block_number)
                  : result.block_number,
            });
            throw error;
          }
        })
        .catch((error: any) => {
          const processingEnd = new Date();
          const storageStart = new Date();
          const storageEnd = new Date();

          console.error("Collect 事件处理失败:", error);

          metricsService.recordEvent({
            event_type: "collect",
            event_timestamp: eventTimestamp,
            processing_start: processingStart,
            processing_end: processingEnd,
            storage_start: storageStart,
            storage_end: storageEnd,
            success: false,
            error_message: error.message || String(error),
            transaction_hash: event.transaction_hash,
            block_number: event.block_number,
          });
        });
    });
  } catch (error: any) {
    console.error("启动事件监听失败:", error.message);
  }
});

// 优雅关闭：停止所有事件监听和定时任务
let schedulerServiceInstance: SchedulerService | null = null;

process.on("SIGINT", () => {
  console.log("\n🛑 正在关闭服务器...");
  eventListener.stopListening();
  schedulerServiceInstance?.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 正在关闭服务器...");
  eventListener.stopListening();
  schedulerServiceInstance?.stop();
  process.exit(0);
});

module.exports = serverless(app);
