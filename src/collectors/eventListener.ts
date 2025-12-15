import { Contract, ethers } from "ethers";
import { PriceCalculator } from "./priceCalculator";

// Uniswap V3 Pool 合约事件 ABI
const UNISWAP_V3_SWAP_ABI = [
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
];

const UNISWAP_V3_LIQUIDITY_ABI = [
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)",
];

export interface SwapEventV3 {
  sender: string;
  recipient: string;
  amount0: bigint;
  amount1: bigint;
  sqrt_price_x96: bigint;
  liquidity: bigint;
  tick: number;
  transaction_hash: string;
  log_index: number;
  block_number: number;
}

export interface MintEventV3 {
  sender: string;
  owner: string;
  tick_lower: number;
  tick_upper: number;
  amount: bigint; // liquidity delta
  amount0: bigint;
  amount1: bigint;
  transaction_hash: string;
  log_index: number;
  block_number: number;
}

export interface BurnEventV3 {
  owner: string;
  tick_lower: number;
  tick_upper: number;
  amount: bigint; // liquidity delta
  amount0: bigint;
  amount1: bigint;
  transaction_hash: string;
  log_index: number;
  block_number: number;
}

export interface CollectEventV3 {
  owner: string;
  recipient: string;
  tick_lower: number;
  tick_upper: number;
  amount0: bigint;
  amount1: bigint;
  transaction_hash: string;
  log_index: number;
  block_number: number;
}

// 合并所有事件 ABI
const ALL_EVENTS_ABI = [...UNISWAP_V3_SWAP_ABI, ...UNISWAP_V3_LIQUIDITY_ABI];

// 事件日志信息接口
interface EventLogInfo {
  transaction_hash: string;
  block_number: number;
  log_index: number;
}

export class UniswapV3EventListener {
  private provider: ethers.JsonRpcProvider;
  private listeners: Map<string, ethers.Contract> = new Map();
  private isListening: boolean = false;

  constructor(rpcUrl?: string) {
    const url = rpcUrl || process.env.RPC_URL || "https://eth.llamarpc.com";
    // 配置 Provider 选项，增加超时时间和重试
    this.provider = new ethers.JsonRpcProvider(url, undefined, {
      staticNetwork: null, // 自动检测网络
      batchMaxCount: 1, // 禁用批处理，避免超时
      polling: false, // 禁用轮询
    });
    console.log(`🔗 连接到 RPC 节点: ${url}`);
  }

  /**
   * 验证地址格式
   */
  private validateAddress(poolAddress: string): void {
    if (!ethers.isAddress(poolAddress)) {
      throw new Error(`无效的地址格式: ${poolAddress}`);
    }
  }

  /**
   * 验证合约是否存在
   */
  private async validateContract(poolAddress: string): Promise<void> {
    const code = await this.provider.getCode(poolAddress);
    if (code === "0x") {
      throw new Error(`地址 ${poolAddress} 不是有效的合约地址`);
    }
  }

  /**
   * 获取或创建合约实例
   */
  private async getOrCreateContract(
    poolAddress: string,
    removeExisting: boolean = false
  ): Promise<ethers.Contract> {
    // 如果已经存在且需要移除旧的监听器
    if (removeExisting && this.listeners.has(poolAddress)) {
      const oldContract = this.listeners.get(poolAddress);
      oldContract?.removeAllListeners();
      this.listeners.delete(poolAddress);
    }

    // 如果已存在，直接返回
    let contract = this.listeners.get(poolAddress);
    if (contract) {
      return contract;
    }

    // 创建新合约实例
    contract = new ethers.Contract(poolAddress, ALL_EVENTS_ABI, this.provider);
    this.listeners.set(poolAddress, contract);
    return contract;
  }

  /**
   * 从事件对象中提取日志信息
   */
  private extractEventLogInfo(event: any): EventLogInfo | null {
    const transaction_hash = event.log?.transactionHash;
    const block_number = event.log?.blockNumber;
    const log_index = event.log?.index ?? event.log?.logIndex ?? 0;

    if (!transaction_hash || !block_number) {
      return null;
    }

    return {
      transaction_hash,
      block_number: Number(block_number),
      log_index: Number(log_index),
    };
  }

  /**
   * 验证并提取事件日志信息
   * @returns 日志信息，如果验证失败则返回 null
   */
  private validateAndExtractLogInfo(
    event: any,
    eventType: string
  ): EventLogInfo | null {
    const logInfo = this.extractEventLogInfo(event);
    if (!logInfo) {
      console.warn(`${eventType} 事件日志缺少必要信息:`, {
        transaction_hash: event.log?.transactionHash,
        block_number: event.log?.blockNumber,
        log_index: event.log?.index ?? event.log?.logIndex,
      });
      return null;
    }
    return logInfo;
  }

  /**
   * 监听 Uniswap V3 Pool 合约的 Swap 事件
   * @param poolAddress Pool 合约地址
   * @param onSwap 回调函数
   */
  async listenSwap(
    poolAddress: string,
    onSwap: (event: SwapEventV3) => void
  ): Promise<void> {
    try {
      this.validateAddress(poolAddress);
      const contract = await this.getOrCreateContract(poolAddress, true);
      await this.validateContract(poolAddress);

      // 监听 Swap 事件
      contract.on(
        "Swap",
        async (
          sender: string,
          recipient: string,
          amount0: bigint,
          amount1: bigint,
          sqrt_price_x96: bigint,
          liquidity: bigint,
          tick: number,
          event: any
        ) => {
          try {
            const logInfo = this.validateAndExtractLogInfo(event, "Swap");
            if (!logInfo) return;

            const swapEvent: SwapEventV3 = {
              sender,
              recipient,
              amount0,
              amount1,
              sqrt_price_x96,
              liquidity,
              tick,
              transaction_hash: logInfo.transaction_hash,
              log_index: logInfo.log_index,
              block_number: logInfo.block_number,
            };

            onSwap(swapEvent);
          } catch (error) {
            console.error("处理 Swap 事件时出错:", error);
          }
        }
      );

      console.log(`✅ 开始监听 Uniswap V3 Pool Swap 事件: ${poolAddress}`);
      this.isListening = true;
    } catch (error: any) {
      console.error(`❌ 监听 Swap 事件失败:`, error);
      throw error;
    }
  }

  /**
   * 通用的流动性事件监听方法
   * @param poolAddress Pool 合约地址
   * @param eventName 事件名称 ("Mint" | "Burn" | "Collect")
   * @param eventHandler 事件处理函数
   * @param logFormatter 日志格式化函数
   */
  private async listenLiquidityEvent<T>(
    poolAddress: string,
    eventName: "Mint" | "Burn" | "Collect",
    eventHandler: (event: T) => void,
    eventBuilder: (args: any[], logInfo: EventLogInfo) => T,
    logFormatter: (event: T) => void
  ): Promise<void> {
    try {
      this.validateAddress(poolAddress);
      const contract = await this.getOrCreateContract(poolAddress);
      await this.validateContract(poolAddress);

      contract.on(eventName, async (...args: any[]) => {
        try {
          const event = args[args.length - 1]; // 最后一个参数是事件对象
          const logInfo = this.validateAndExtractLogInfo(event, eventName);
          if (!logInfo) return;

          // 移除事件对象，只保留事件参数
          const eventArgs = args.slice(0, -1);
          const eventData = eventBuilder(eventArgs, logInfo);

          logFormatter(eventData);
          eventHandler(eventData);
        } catch (error) {
          console.error(`处理 ${eventName} 事件时出错:`, error);
        }
      });

      const emoji =
        eventName === "Mint" ? "➕" : eventName === "Burn" ? "➖" : "💰";
      console.log(
        `${emoji} 开始监听 Uniswap V3 Pool ${eventName} 事件: ${poolAddress}`
      );
    } catch (error: any) {
      console.error(`❌ 监听 ${eventName} 事件失败:`, error);
      throw error;
    }
  }

  /**
   * 监听 Uniswap V3 Pool 合约的 Mint 事件
   * @param poolAddress Pool 合约地址
   * @param onMint 回调函数
   */
  async listenMint(
    poolAddress: string,
    onMint: (event: MintEventV3) => void
  ): Promise<void> {
    return this.listenLiquidityEvent<MintEventV3>(
      poolAddress,
      "Mint",
      onMint,
      (
        [sender, owner, tickLower, tickUpper, amount, amount0, amount1],
        logInfo
      ) => ({
        sender,
        owner,
        tick_lower: tickLower,
        tick_upper: tickUpper,
        amount,
        amount0,
        amount1,
        transaction_hash: logInfo.transaction_hash,
        log_index: logInfo.log_index,
        block_number: logInfo.block_number,
      }),
      (event) => {
        console.log(`\n➕ Uniswap V3 Mint 事件检测到:`);
        console.log(`   交易哈希: ${event.transaction_hash}`);
        console.log(`   区块号: ${event.block_number}`);
        console.log(`   所有者: ${event.owner}`);
        console.log(`   Tick 范围: [${event.tick_lower}, ${event.tick_upper}]`);
        console.log(`   流动性变化: ${event.amount.toString()}`);
        console.log(`   Amount0: ${event.amount0.toString()}`);
        console.log(`   Amount1: ${event.amount1.toString()}`);
      }
    );
  }

  /**
   * 监听 Uniswap V3 Pool 合约的 Burn 事件
   * @param poolAddress Pool 合约地址
   * @param onBurn 回调函数
   */
  async listenBurn(
    poolAddress: string,
    onBurn: (event: BurnEventV3) => void
  ): Promise<void> {
    return this.listenLiquidityEvent<BurnEventV3>(
      poolAddress,
      "Burn",
      onBurn,
      ([owner, tickLower, tickUpper, amount, amount0, amount1], logInfo) => ({
        owner,
        tick_lower: tickLower,
        tick_upper: tickUpper,
        amount,
        amount0,
        amount1,
        transaction_hash: logInfo.transaction_hash,
        log_index: logInfo.log_index,
        block_number: logInfo.block_number,
      }),
      (event) => {
        console.log(`\n➖ Uniswap V3 Burn 事件检测到:`);
        console.log(`   交易哈希: ${event.transaction_hash}`);
        console.log(`   区块号: ${event.block_number}`);
        console.log(`   所有者: ${event.owner}`);
        console.log(`   Tick 范围: [${event.tick_lower}, ${event.tick_upper}]`);
        console.log(`   流动性变化: ${event.amount.toString()}`);
        console.log(`   Amount0: ${event.amount0.toString()}`);
        console.log(`   Amount1: ${event.amount1.toString()}`);
      }
    );
  }

  /**
   * 监听 Uniswap V3 Pool 合约的 Collect 事件
   * @param poolAddress Pool 合约地址
   * @param onCollect 回调函数
   */
  async listenCollect(
    poolAddress: string,
    onCollect: (event: CollectEventV3) => void
  ): Promise<void> {
    return this.listenLiquidityEvent<CollectEventV3>(
      poolAddress,
      "Collect",
      onCollect,
      (
        [owner, recipient, tickLower, tickUpper, amount0, amount1],
        logInfo
      ) => ({
        owner,
        recipient,
        tick_lower: tickLower,
        tick_upper: tickUpper,
        amount0,
        amount1,
        transaction_hash: logInfo.transaction_hash,
        log_index: logInfo.log_index,
        block_number: logInfo.block_number,
      }),
      (event) => {
        console.log(`\n💰 Uniswap V3 Collect 事件检测到:`);
        console.log(`   交易哈希: ${event.transaction_hash}`);
        console.log(`   区块号: ${event.block_number}`);
        console.log(`   所有者: ${event.owner}`);
        console.log(`   接收者: ${event.recipient}`);
        console.log(`   Tick 范围: [${event.tick_lower}, ${event.tick_upper}]`);
        console.log(`   Amount0: ${event.amount0.toString()}`);
        console.log(`   Amount1: ${event.amount1.toString()}`);
      }
    );
  }

  /**
   * 停止监听指定 Pool 的 Swap 事件
   * @param poolAddress Pool 合约地址，如果不提供则停止所有监听
   */
  stopListening(poolAddress?: string): void {
    if (poolAddress) {
      const contract = this.listeners.get(poolAddress);
      if (contract) {
        contract.removeAllListeners();
        this.listeners.delete(poolAddress);
        console.log(`🛑 停止监听 Pool: ${poolAddress}`);
      }
    } else {
      // 停止所有监听
      this.listeners.forEach((contract, address) => {
        contract.removeAllListeners();
        console.log(`🛑 停止监听 Pool: ${address}`);
      });
      this.listeners.clear();
      this.isListening = false;
      console.log(`✅ 已停止所有监听`);
    }
  }

  /**
   * 获取当前监听状态
   */
  getListeningStatus(): {
    isListening: boolean;
    pools: string[];
    count: number;
  } {
    return {
      isListening: this.isListening,
      pools: Array.from(this.listeners.keys()),
      count: this.listeners.size,
    };
  }

  /**
   * 获取 Provider 实例
   */
  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }
}

// 导出单例实例
let eventListenerInstance: UniswapV3EventListener | null = null;

export function getEventListener(rpcUrl?: string): UniswapV3EventListener {
  if (!eventListenerInstance) {
    eventListenerInstance = new UniswapV3EventListener(rpcUrl);
  }
  return eventListenerInstance;
}
