// 性能监控服务 - 跟踪数据延迟、错误率等指标
import sql from "../storage/supabaseClient";

export interface EventMetrics {
  event_type: "swap" | "mint" | "burn" | "collect";
  event_timestamp: Date;
  processing_start: Date;
  processing_end: Date;
  storage_start: Date;
  storage_end: Date;
  success: boolean;
  error_message?: string;
  transaction_hash: string;
  block_number: number;
}

export interface SystemMetrics {
  timestamp: Date;
  total_events: number;
  successful_events: number;
  failed_events: number;
  avg_processing_latency_ms: number;
  avg_storage_latency_ms: number;
  avg_total_latency_ms: number;
  error_rate: number;
  events_per_second: number;
}

class MetricsService {
  private metrics: EventMetrics[] = [];
  private readonly maxInMemoryMetrics = 1000; // 内存中最多保存的指标数量
  private flushInterval: NodeJS.Timeout | null = null;

  constructor() {
    // 每30秒将指标刷新到数据库
    this.flushInterval = setInterval(() => {
      this.flushMetrics().catch((error) => {
        console.error("刷新指标到数据库失败:", error);
      });
    }, 30000);
  }

  /**
   * 记录事件处理指标
   */
  recordEvent(metric: EventMetrics): void {
    this.metrics.push(metric);

    // 如果内存中的指标过多，立即刷新
    if (this.metrics.length >= this.maxInMemoryMetrics) {
      this.flushMetrics().catch((error) => {
        console.error("刷新指标到数据库失败:", error);
      });
    }
  }

  /**
   * 计算处理延迟（毫秒）
   */
  calculateProcessingLatency(metric: EventMetrics): number {
    return metric.processing_end.getTime() - metric.processing_start.getTime();
  }

  /**
   * 计算存储延迟（毫秒）
   */
  calculateStorageLatency(metric: EventMetrics): number {
    return metric.storage_end.getTime() - metric.storage_start.getTime();
  }

  /**
   * 计算总延迟（毫秒）
   */
  calculateTotalLatency(metric: EventMetrics): number {
    return metric.storage_end.getTime() - metric.event_timestamp.getTime();
  }

  /**
   * 获取系统指标（最近N条记录）
   */
  getSystemMetrics(limit: number = 100): SystemMetrics | null {
    if (this.metrics.length === 0) {
      return null;
    }

    const recentMetrics = this.metrics.slice(-limit);
    const total = recentMetrics.length;
    const successful = recentMetrics.filter((m) => m.success).length;
    const failed = total - successful;

    const processingLatencies = recentMetrics.map((m) =>
      this.calculateProcessingLatency(m)
    );
    const storageLatencies = recentMetrics.map((m) =>
      this.calculateStorageLatency(m)
    );
    const totalLatencies = recentMetrics.map((m) =>
      this.calculateTotalLatency(m)
    );

    const avgProcessingLatency =
      processingLatencies.reduce((a, b) => a + b, 0) / total;
    const avgStorageLatency =
      storageLatencies.reduce((a, b) => a + b, 0) / total;
    const avgTotalLatency = totalLatencies.reduce((a, b) => a + b, 0) / total;

    // 计算每秒事件数（基于时间窗口）
    const timeWindow =
      recentMetrics[recentMetrics.length - 1].event_timestamp.getTime() -
      recentMetrics[0].event_timestamp.getTime();
    const eventsPerSecond =
      timeWindow > 0 ? (total / timeWindow) * 1000 : 0;

    return {
      timestamp: new Date(),
      total_events: total,
      successful_events: successful,
      failed_events: failed,
      avg_processing_latency_ms: Math.round(avgProcessingLatency),
      avg_storage_latency_ms: Math.round(avgStorageLatency),
      avg_total_latency_ms: Math.round(avgTotalLatency),
      error_rate: total > 0 ? failed / total : 0,
      events_per_second: eventsPerSecond,
    };
  }

  /**
   * 将指标刷新到数据库
   */
  async flushMetrics(): Promise<void> {
    if (this.metrics.length === 0) {
      return;
    }

    const metricsToFlush = [...this.metrics];
    this.metrics = [];

    try {
      for (const metric of metricsToFlush) {
        const processingLatency = this.calculateProcessingLatency(metric);
        const storageLatency = this.calculateStorageLatency(metric);
        const totalLatency = this.calculateTotalLatency(metric);

        await sql`
          INSERT INTO event_metrics (
            event_type,
            event_timestamp,
            processing_start,
            processing_end,
            storage_start,
            storage_end,
            processing_latency_ms,
            storage_latency_ms,
            total_latency_ms,
            success,
            error_message,
            transaction_hash,
            block_number
          ) VALUES (
            ${metric.event_type},
            ${metric.event_timestamp},
            ${metric.processing_start},
            ${metric.processing_end},
            ${metric.storage_start},
            ${metric.storage_end},
            ${processingLatency},
            ${storageLatency},
            ${totalLatency},
            ${metric.success},
            ${metric.error_message || null},
            ${metric.transaction_hash},
            ${metric.block_number}
          )
          ON CONFLICT DO NOTHING
        `;
      }
    } catch (error) {
      // 如果刷新失败，将指标重新放回队列
      this.metrics.unshift(...metricsToFlush);
      throw error;
    }
  }

  /**
   * 获取数据库中的系统指标（聚合）
   */
  async getAggregatedMetrics(
    startTime?: Date,
    endTime?: Date
  ): Promise<SystemMetrics | null> {
    try {
      let query;
      if (startTime && endTime) {
        query = sql`
          SELECT
            COUNT(*) as total_events,
            COUNT(*) FILTER (WHERE success = true) as successful_events,
            COUNT(*) FILTER (WHERE success = false) as failed_events,
            AVG(processing_latency_ms) as avg_processing_latency_ms,
            AVG(storage_latency_ms) as avg_storage_latency_ms,
            AVG(total_latency_ms) as avg_total_latency_ms,
            COUNT(*) FILTER (WHERE success = false)::float / COUNT(*)::float as error_rate,
            COUNT(*)::float / EXTRACT(EPOCH FROM (MAX(event_timestamp) - MIN(event_timestamp))) as events_per_second
          FROM event_metrics
          WHERE event_timestamp >= ${startTime} AND event_timestamp <= ${endTime}
        `;
      } else {
        // 最近1小时的数据
        query = sql`
          SELECT
            COUNT(*) as total_events,
            COUNT(*) FILTER (WHERE success = true) as successful_events,
            COUNT(*) FILTER (WHERE success = false) as failed_events,
            AVG(processing_latency_ms) as avg_processing_latency_ms,
            AVG(storage_latency_ms) as avg_storage_latency_ms,
            AVG(total_latency_ms) as avg_total_latency_ms,
            COUNT(*) FILTER (WHERE success = false)::float / COUNT(*)::float as error_rate,
            COUNT(*)::float / EXTRACT(EPOCH FROM (MAX(event_timestamp) - MIN(event_timestamp))) as events_per_second
          FROM event_metrics
          WHERE event_timestamp >= NOW() - INTERVAL '1 hour'
        `;
      }

      const result = await query;
      if (result.length === 0 || !result[0].total_events) {
        return null;
      }

      const row = result[0];
      return {
        timestamp: new Date(),
        total_events: Number(row.total_events),
        successful_events: Number(row.successful_events),
        failed_events: Number(row.failed_events),
        avg_processing_latency_ms: Math.round(
          Number(row.avg_processing_latency_ms) || 0
        ),
        avg_storage_latency_ms: Math.round(
          Number(row.avg_storage_latency_ms) || 0
        ),
        avg_total_latency_ms: Math.round(Number(row.avg_total_latency_ms) || 0),
        error_rate: Number(row.error_rate) || 0,
        events_per_second: Number(row.events_per_second) || 0,
      };
    } catch (error) {
      console.error("获取聚合指标失败:", error);
      return null;
    }
  }

  /**
   * 清理资源
   */
  async destroy(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    // 最后刷新一次
    await this.flushMetrics();
  }
}

// 单例模式
let metricsServiceInstance: MetricsService | null = null;

export function getMetricsService(): MetricsService {
  if (!metricsServiceInstance) {
    metricsServiceInstance = new MetricsService();
  }
  return metricsServiceInstance;
}

