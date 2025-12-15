/**
 * 定时任务服务
 */
import { SnapshotService } from "./snapshotService";
import { savePoolSnapshot } from "../storage/poolSnapshotRepository";
import { HourlyStatsService } from "./hourlyStatsService";
import { saveHourlyStats } from "../storage/hourlyStatsRepository";
import { DailyStatsService } from "./dailyStatsService";
import { saveDailyStats } from "../storage/dailyStatsRepository";
import { getIntegrityService } from "./integrityService";
import { ethers } from "ethers";

export class SchedulerService {
  private snapshotService: SnapshotService;
  private hourlyStatsService: HourlyStatsService;
  private dailyStatsService: DailyStatsService;
  private intervalId: NodeJS.Timeout | null = null;
  private timeoutId: NodeJS.Timeout | null = null;
  private dailyIntervalId: NodeJS.Timeout | null = null;
  private dailyTimeoutId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(snapshotService: SnapshotService) {
    this.snapshotService = snapshotService;
    this.hourlyStatsService = new HourlyStatsService();
    this.dailyStatsService = new DailyStatsService();
  }

  /**
   * 计算到下一个整点的毫秒数
   */
  private getMillisecondsUntilNextHour(): number {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0); // 下一个整点
    return nextHour.getTime() - now.getTime();
  }

  /**
   * 计算到下一个0点的毫秒数
   */
  private getMillisecondsUntilMidnight(): number {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0); // 下一个0点
    return nextMidnight.getTime() - now.getTime();
  }

  /**
   * 启动所有定时任务（每小时和每天）
   */
  startAllTasks(): void {
    if (this.isRunning) {
      console.warn("⚠️  定时任务已在运行中");
      return;
    }

    // 启动每小时任务
    this.startHourlyTasks();

    // 启动每天任务
    this.startDailyTasks();

    this.isRunning = true;
  }

  /**
   * 启动每小时快照任务（每个整点执行）
   */
  private startHourlyTasks(): void {
    console.log("⏰ 启动每小时定时任务（每个整点执行）...");

    // 计算到下一个整点的时间
    const msUntilNextHour = this.getMillisecondsUntilNextHour();
    const minutesUntilNextHour = Math.floor(msUntilNextHour / 60000);
    const secondsUntilNextHour = Math.floor((msUntilNextHour % 60000) / 1000);

    console.log(
      `   ⏳ 将在 ${minutesUntilNextHour} 分 ${secondsUntilNextHour} 秒后（下一个整点）执行第一次小时任务`
    );

    // 在下一个整点执行第一次
    this.timeoutId = setTimeout(() => {
      this.executeHourlyTasks();
      // 然后每小时执行一次
      this.intervalId = setInterval(() => {
        this.executeHourlyTasks();
      }, 60 * 60 * 1000); // 1 小时 = 60 * 60 * 1000 毫秒
    }, msUntilNextHour);

    console.log("✅ 每小时定时任务已启动");
  }

  /**
   * 启动每天统计任务（每天0点执行）
   */
  private startDailyTasks(): void {
    console.log("📅 启动每日定时任务（每天0点执行）...");

    // 计算到下一个0点的时间
    const msUntilMidnight = this.getMillisecondsUntilMidnight();
    const hoursUntilMidnight = Math.floor(msUntilMidnight / 3600000);
    const minutesUntilMidnight = Math.floor(
      (msUntilMidnight % 3600000) / 60000
    );

    console.log(
      `   ⏳ 将在 ${hoursUntilMidnight} 小时 ${minutesUntilMidnight} 分钟后（下一个0点）执行第一次每日任务`
    );

    // 在下一个0点执行第一次
    this.dailyTimeoutId = setTimeout(() => {
      this.executeDailyTasks();
      // 然后每天执行一次
      this.dailyIntervalId = setInterval(() => {
        this.executeDailyTasks();
      }, 24 * 60 * 60 * 1000); // 24 小时
    }, msUntilMidnight);

    console.log("✅ 每日定时任务已启动");
  }

  /**
   * 执行每小时任务（快照 + 小时统计）
   */
  private async executeHourlyTasks(): Promise<void> {
    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0); // 当前小时的整点

    console.log(`\n⏰ 开始执行整点任务 (${hourStart.toISOString()})...`);

    // 1. 执行快照任务
    try {
      console.log("📸 执行 Pool 快照任务...");
      const snapshot = await this.snapshotService.createSnapshot();
      await savePoolSnapshot(snapshot);
      console.log("✅ Pool 快照任务完成");
    } catch (error: any) {
      console.error("❌ Pool 快照任务失败:", error.message || error);
    }

    // 2. 执行小时统计任务（统计上一个小时的数据）
    try {
      console.log("📊 执行小时统计任务...");
      const previousHourStart = new Date(hourStart);
      previousHourStart.setHours(previousHourStart.getHours() - 1);

      // 获取上一个小时的收盘价作为当前小时的开盘价
      const previousClosePrice =
        await this.hourlyStatsService.getPreviousHourClosePrice(hourStart);

      const stats = await this.hourlyStatsService.generateHourlyStats(
        previousHourStart
      );

      // 如果当前小时的开盘价未设置，使用上一个小时的收盘价
      if (stats.open_price === 0 && previousClosePrice !== null) {
        stats.open_price = previousClosePrice;
        stats.low_price = previousClosePrice;
        stats.high_price = previousClosePrice;
        stats.close_price = previousClosePrice;
      }

      await saveHourlyStats(stats);
      console.log("✅ 小时统计任务完成");
    } catch (error: any) {
      console.error("❌ 小时统计任务失败:", error.message || error);
    }

    console.log("✅ 所有整点任务完成\n");
  }

  /**
   * 执行每日任务（统计前一天的数据）
   */
  private async executeDailyTasks(): Promise<void> {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // 统计前一天的数据
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    console.log(
      `\n📅 开始执行每日任务 (${yesterday.toISOString().split("T")[0]})...`
    );

    try {
      // 获取前一天的收盘价作为当天的开盘价
      const previousClosePrice =
        await this.dailyStatsService.getPreviousDayClosePrice(today);

      const stats = await this.dailyStatsService.generateDailyStats(yesterday);

      // 如果开盘价未设置，使用前一天的收盘价
      if (stats.open_price === 0 && previousClosePrice !== null) {
        stats.open_price = previousClosePrice;
        if (stats.low_price === 0) stats.low_price = previousClosePrice;
        if (stats.high_price === 0) stats.high_price = previousClosePrice;
        if (stats.close_price === 0) stats.close_price = previousClosePrice;
      }

      await saveDailyStats(stats);
      console.log("✅ 每日统计任务完成");
    } catch (error: any) {
      console.error("❌ 每日统计任务失败:", error.message || error);
    }

    // 3. 执行数据完整性检查（每天一次）
    try {
      console.log("🔍 执行数据完整性检查...");
      const integrityService = getIntegrityService();
      const results = await integrityService.checkDataIntegrity();
      
      // 保存检查结果
      for (const result of results) {
        await integrityService.saveIntegrityCheckResult(result);
      }
      
      const passed = results.filter((r) => r.passed).length;
      const failed = results.filter((r) => !r.passed).length;
      const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
      
      console.log(
        `✅ 数据完整性检查完成: ${passed}/${results.length} 通过, ${failed} 失败, ${totalIssues} 个问题`
      );
      
      if (totalIssues > 0) {
        console.warn("⚠️  发现数据完整性问题，请查看完整性检查结果");
      }
    } catch (error: any) {
      console.error("❌ 数据完整性检查失败:", error.message || error);
    }
    
    console.log("");
  }

  /**
   * 停止定时任务
   */
  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.dailyTimeoutId) {
      clearTimeout(this.dailyTimeoutId);
      this.dailyTimeoutId = null;
    }
    if (this.dailyIntervalId) {
      clearInterval(this.dailyIntervalId);
      this.dailyIntervalId = null;
    }
    this.isRunning = false;
    console.log("🛑 所有定时任务已停止");
  }

  /**
   * 获取运行状态
   */
  getStatus(): { isRunning: boolean } {
    return { isRunning: this.isRunning };
  }
}
