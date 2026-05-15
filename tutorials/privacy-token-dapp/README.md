# 构建隐私代币 dApp：Midnight Network 完整指南

> **赏金 Issue**: midnightntwrk/contributor-hub #326
> **难度**: 中级 | **预计时间**: 2-3 小时 | **前置知识**: TypeScript, 基本密码学概念

---

## 概述

本教程将带你从零开始构建一个运行在 **Midnight Network** 上的隐私代币去中心化应用程序（dApp）。Midnight 是一条专注于数据隐私的区块链，它利用零知识证明（ZK Proofs）和简洁非交互式知识论证（zk-SNARKs）来保护交易隐私。与传统区块链不同，Midnight 上的代币余额和转账金额默认对外界不可见，只有交易参与方才能查看相关细节。

通过本教程，你将学会：

- 理解 Midnight Network 的隐私模型和核心概念
- 使用 Compact 语言编写隐私代币智能合约
- 搭建完整的 dApp 前后端架构
- 实现隐私铸造、转账和余额查询功能
- 部署到 Midnight 测试网并进行端到端测试

---

## 第一部分：核心概念

### 1.1 Midnight Network 与隐私区块链

Midnight Network 是 Input Output (IOG) 开发的隐私侧链，与 Cardano 生态紧密集成。它的核心创新在于：

- **零知识证明原生支持**：合约编译时自动生成 ZK 电路
- **选择性披露**：用户可以证明某些属性（如"余额 > 0"）而不暴露具体数值
- **Compact 语言**：专为隐私合约设计的领域特定语言
- **Shielded 交易**：所有代币操作默认处于屏蔽状态

### 1.2 隐私代币模型

在传统区块链上，代币余额是公开的 UTXO 或账户状态。在 Midnight 上，隐私代币采用 **Shielded UTXO** 模型：

```
公开信息：存在一笔交易
隐藏信息：发送方、接收方、转账金额、当前余额
可选披露：代币类型、合规证明
```

这种模型类似于 Zcash 的 shielded pool，但 Midnight 将其扩展为通用的智能合约平台。

### 1.3 技术栈

本教程使用的技术栈：

| 组件 | 技术 |
|------|------|
| 智能合约 | Compact (Midnight DSL) |
| 后端 | TypeScript + @midnight-ntwrk/api |
| 前端 | React + Vite |
| 测试网 | Midnight Testnet |
| 包管理 | npm |
| 构建工具 | Compact compiler |

---

## 第二部分：环境搭建

### 2.1 安装 Compact 编译器

首先安装 Midnight 开发工具链：

```bash
# 安装 Midnight CLI
npm install -g @midnight-ntwrk/cli

# 验证安装
midnight --version

# 创建项目目录
mkdir my-privacy-token && cd my-privacy-token
```

### 2.2 初始化项目

```bash
# 使用官方脚手架
npx @midnight-ntwrk/create-dapp privacy-token --template compact

cd privacy-token

# 安装依赖
npm install
```

项目结构如下：

```
privacy-token/
├── contracts/          # Compact 智能合约
│   └── PrivacyToken.compact
├── src/
│   ├── api/           # 后端 API 层
│   ├── components/    # React 组件
│   └── App.tsx        # 主应用
├── tests/             # 测试文件
├── compact.toml       # 编译配置
└── package.json
```

### 2.3 配置测试网

创建 `.env` 文件：

```env
MIDNIGHT_TESTNET_URL=https://testnet.midnight.network/api/v1
WALLET_SEED=your_mnemonic_phrase_here
NETWORK_ID=testnet
```

> **安全提示**：永远不要将真实助记词提交到版本控制。使用 `.env.example` 作为模板。

---

## 第三部分：编写隐私代币合约

### 3.1 Compact 语言基础

Compact 是 Midnight 的智能合约语言，语法类似于 TypeScript，但增加了隐私原语：

- `secret` 关键字标记隐私数据
- `shielded` 修饰符保护状态
- `proof` 块用于零知识证明生成

### 3.2 合约代码

在 `contracts/PrivacyToken.compact` 中编写：

```compact
// contracts/PrivacyToken.compact
// Privacy Token Smart Contract for Midnight Network

module PrivacyToken {
    // 状态变量 - shielded 表示这些状态对外不可见
    shielded owner: PublicKey;
    shielded totalSupply: Field;
    shielded balances: MerkleMap<PublicKey, Field>;

    // 事件（公开可观察）
    event Transfer(from: PublicKey, to: PublicKey);
    event Mint(to: PublicKey);
    event Burn(from: PublicKey);

    // 构造函数
    constructor(initialOwner: PublicKey, supply: secret Field) {
        owner = initialOwner;
        totalSupply = supply;
        balances.insert(initialOwner, supply);
        emit Mint(initialOwner);
    }

    // 铸造新代币（仅 owner 可调用）
    function mint(to: PublicKey, amount: secret Field): Bool {
        // 使用 ZK 证明验证调用者是 owner
        proof {
            assert(msg.sender == owner, "Only owner can mint");
            assert(amount > 0, "Amount must be positive");
        }

        // 更新 shielded 余额
        let currentBalance = balances.get(to) ?? Field(0);
        balances.insert(to, currentBalance + amount);
        totalSupply = totalSupply + amount;

        emit Mint(to);
        return true;
    }

    // 转账函数 - 完全隐私
    function transfer(
        to: PublicKey,
        amount: secret Field,
        senderBalanceProof: secret MerkleProof
    ): Bool {
        proof {
            // 验证发送者有足够余额（零知识证明）
            let senderBalance = balances.get(msg.sender);
            assert(senderBalance >= amount, "Insufficient balance");
            assert(amount > 0, "Amount must be positive");

            // 验证 Merkle 证明的有效性
            assert(
                senderBalanceProof.verify(
                    balances.root(),
                    msg.sender,
                    senderBalance
                ),
                "Invalid balance proof"
            );
        }

        // 更新双方余额（shielded 操作）
        let sBal = balances.get(msg.sender) ?? Field(0);
        let rBal = balances.get(to) ?? Field(0);

        balances.insert(msg.sender, sBal - amount);
        balances.insert(to, rBal + amount);

        emit Transfer(msg.sender, to);
        return true;
    }

    // 余额查询 - 返回加密证明而非明文
    function getBalanceProof(
        account: PublicKey
    ): secret MerkleProof {
        let balance = balances.get(account);
        return balances.prove(account, balance);
    }

    // 燃烧代币
    function burn(
        amount: secret Field,
        balanceProof: secret MerkleProof
    ): Bool {
        proof {
            let balance = balances.get(msg.sender);
            assert(balance >= amount, "Insufficient balance");
            assert(
                balanceProof.verify(
                    balances.root(),
                    msg.sender,
                    balance
                ),
                "Invalid proof"
            );
        }

        let currentBalance = balances.get(msg.sender) ?? Field(0);
        balances.insert(msg.sender, currentBalance - amount);
        totalSupply = totalSupply - amount;

        emit Burn(msg.sender);
        return true;
    }

    // 获取总供应量（可选公开）
    function getTotalSupply(): Field {
        return totalSupply;
    }
}
```

### 3.3 编译合约

```bash
# 编译 Compact 合约
npx compact compile contracts/PrivacyToken.compact \
  --output build/ \
  --circuit

# 这会生成：
# build/PrivacyToken.contract   - 合约字节码
# build/PrivacyToken.circuit    - ZK 电路
# build/PrivacyToken.d.ts       - TypeScript 类型
```

---

## 第四部分：后端 API 开发

### 4.1 合约交互层

在 `src/api/privacyToken.ts` 中实现：

```typescript
// src/api/privacyToken.ts
import {
  CompactRuntime,
  ContractAddress,
  WalletAPI
} from '@midnight-ntwrk/api';
import { PrivacyToken } from '../build/PrivacyToken';

export interface TokenInfo {
  totalSupply: string;
  contractAddress: ContractAddress;
}

export class PrivacyTokenAPI {
  private contract: typeof PrivacyToken;
  private wallet: WalletAPI;
  private runtime: CompactRuntime;

  constructor(wallet: WalletAPI) {
    this.wallet = wallet;
    this.runtime = new CompactRuntime(wallet);
  }

  // 部署合约
  async deploy(initialSupply: bigint): Promise<ContractAddress> {
    const { contract, address } = await this.runtime.deploy(
      PrivacyToken,
      [this.wallet.publicKey, initialSupply]
    );
    this.contract = contract;
    return address;
  }

  // 连接已部署的合约
  async connect(address: ContractAddress): Promise<void> {
    this.contract = await this.runtime.connect(
      PrivacyToken,
      address
    );
  }

  // 铸造代币
  async mint(to: string, amount: bigint): Promise<string> {
    const tx = await this.contract.mint(to, amount);
    const receipt = await this.wallet.submitTx(tx);
    return receipt.txHash;
  }

  // 隐私转账
  async transfer(
    to: string,
    amount: bigint
  ): Promise<string> {
    // 生成余额的 ZK 证明
    const balanceProof = await this.generateBalanceProof();

    const tx = await this.contract.transfer(
      to,
      amount,
      balanceProof
    );
    const receipt = await this.wallet.submitTx(tx);
    return receipt.txHash;
  }

  // 获取余额（返回加密证明）
  async getBalanceProof(
    account?: string
  ): Promise<string> {
    const target = account || this.wallet.publicKey;
    const proof = await this.contract.getBalanceProof(target);
    return proof.serialize();
  }

  // 辅助：生成余额证明
  private async generateBalanceProof() {
    return await this.wallet.generateProof(
      this.contract,
      'balance'
    );
  }

  // 查询总供应量
  async getTotalSupply(): Promise<bigint> {
    return await this.contract.getTotalSupply();
  }

  // 燃烧代币
  async burn(amount: bigint): Promise<string> {
    const balanceProof = await this.generateBalanceProof();
    const tx = await this.contract.burn(amount, balanceProof);
    const receipt = await this.wallet.submitTx(tx);
    return receipt.txHash;
  }
}
```

### 4.2 服务器入口

在 `src/api/server.ts` 中：

```typescript
// src/api/server.ts
import express from 'express';
import { PrivacyTokenAPI } from './privacyToken';
import { createWallet } from '@midnight-ntwrk/wallet';

const app = express();
app.use(express.json());

let api: PrivacyTokenAPI;

// 初始化钱包
async function initWallet() {
  const wallet = await createWallet({
    seed: process.env.WALLET_SEED!,
    networkId: process.env.NETWORK_ID as any,
  });
  api = new PrivacyTokenAPI(wallet);
  console.log('Wallet initialized:', wallet.publicKey);
}

// 部署合约
app.post('/deploy', async (req, res) => {
  try {
    const { supply } = req.body;
    const address = await api.deploy(BigInt(supply));
    res.json({ success: true, address });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 铸造
app.post('/mint', async (req, res) => {
  try {
    const { to, amount } = req.body;
    const txHash = await api.mint(to, BigInt(amount));
    res.json({ success: true, txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 转账
app.post('/transfer', async (req, res) => {
  try {
    const { to, amount } = req.body;
    const txHash = await api.transfer(to, BigInt(amount));
    res.json({ success: true, txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 余额查询
app.get('/balance/:address?', async (req, res) => {
  try {
    const proof = await api.getBalanceProof(req.params.address);
    res.json({ success: true, proof });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 启动
initWallet().then(() => {
  app.listen(3001, () => {
    console.log('Privacy Token API running on port 3001');
  });
});
```

---

## 第五部分：前端开发

### 5.1 React 组件

在 `src/components/PrivacyTokenApp.tsx` 中：

```tsx
// src/components/PrivacyTokenApp.tsx
import React, { useState, useEffect } from 'react';
import { useMidnightWallet } from '@midnight-ntwrk/react-hooks';

export const PrivacyTokenApp: React.FC = () => {
  const { address, connect, isConnected } = useMidnightWallet();
  const [contractAddress, setContractAddress] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');
  const [balanceProof, setBalanceProof] = useState('');

  // 连接钱包
  const handleConnect = async () => {
    try {
      await connect();
      setStatus('钱包已连接');
    } catch (err) {
      setStatus('连接失败: ' + (err as Error).message);
    }
  };

  // 部署合约
  const handleDeploy = async () => {
    setStatus('部署中...');
    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supply: '1000000000000' }),
      });
      const data = await res.json();
      setContractAddress(data.address);
      setStatus('合约已部署: ' + data.address);
    } catch (err) {
      setStatus('部署失败');
    }
  };

  // 隐私转账
  const handleTransfer = async () => {
    setStatus('正在生成零知识证明并转账...');
    try {
      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipientAddress,
          amount: amount,
        }),
      });
      const data = await res.json();
      setStatus('转账成功! TX: ' + data.txHash);
    } catch (err) {
      setStatus('转账失败');
    }
  };

  // 查询余额证明
  const handleQueryBalance = async () => {
    try {
      const res = await fetch(`/api/balance/${address}`);
      const data = await res.json();
      setBalanceProof(data.proof);
      setStatus('余额证明已生成（余额对外不可见）');
    } catch (err) {
      setStatus('查询失败');
    }
  };

  return (
    <div className="privacy-token-app">
      <h1>🔒 Midnight 隐私代币</h1>

      {/* 钱包连接 */}
      <section>
        <h2>钱包</h2>
        {!isConnected ? (
          <button onClick={handleConnect}>连接钱包</button>
        ) : (
          <p>已连接: {address?.slice(0, 20)}...</p>
        )}
      </section>

      {/* 合约操作 */}
      <section>
        <h2>合约操作</h2>
        <button onClick={handleDeploy}>部署隐私代币合约</button>
        {contractAddress && (
          <p>合约地址: {contractAddress}</p>
        )}
      </section>

      {/* 转账 */}
      <section>
        <h2>隐私转账</h2>
        <input
          placeholder="接收方地址"
          value={recipientAddress}
          onChange={(e) => setRecipientAddress(e.target.value)}
        />
        <input
          placeholder="金额"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button onClick={handleTransfer}>
          发送（零知识证明保护）
        </button>
      </section>

      {/* 余额 */}
      <section>
        <h2>余额查询</h2>
        <button onClick={handleQueryBalance}>
          生成余额证明
        </button>
        {balanceProof && (
          <pre>证明: {balanceProof.slice(0, 50)}...</pre>
        )}
      </section>

      {/* 状态 */}
      {status && <div className="status">{status}</div>}
    </div>
  );
};
```

### 5.2 应用入口

```tsx
// src/App.tsx
import React from 'react';
import { MidnightProvider } from '@midnight-ntwrk/react-hooks';
import { PrivacyTokenApp } from './components/PrivacyTokenApp';

const App: React.FC = () => (
  <MidnightProvider network="testnet">
    <PrivacyTokenApp />
  </MidnightProvider>
);

export default App;
```

---

## 第六部分：测试与部署

### 6.1 单元测试

```typescript
// tests/privacyToken.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrivacyTokenAPI } from '../src/api/privacyToken';
import { createMockWallet } from '@midnight-ntwrk/testing';

describe('PrivacyToken', () => {
  let api: PrivacyTokenAPI;
  let contractAddress: string;

  beforeAll(async () => {
    const wallet = await createMockWallet();
    api = new PrivacyTokenAPI(wallet);
  });

  it('should deploy with initial supply', async () => {
    contractAddress = await api.deploy(BigInt(1000000));
    expect(contractAddress).toBeDefined();
  });

  it('should mint tokens', async () => {
    const txHash = await api.mint('recipient_pubkey', BigInt(500));
    expect(txHash).toBeDefined();
  });

  it('should transfer privately', async () => {
    const txHash = await api.transfer(
      'recipient_pubkey',
      BigInt(100)
    );
    expect(txHash).toBeDefined();
  });

  it('should generate balance proof without revealing balance', async () => {
    const proof = await api.getBalanceProof();
    expect(proof).toBeDefined();
    // 证明不包含明文余额
    expect(proof).not.toContain('1000000');
  });
});
```

### 6.2 部署到测试网

```bash
# 编译前端
npm run build

# 部署到 Midnight 测试网
MIDNIGHT_ENV=testnet npm run deploy

# 输出类似：
# ✓ 合约已部署: contract1abc...xyz
# ✓ 前端已上传: https://your-app.midnight.network
# ✓ 交易哈义: tx_hash_123...
```

### 6.3 端到端测试流程

```bash
# 1. 部署合约
curl -X POST http://localhost:3001/deploy \
  -H "Content-Type: application/json" \
  -d '{"supply": "1000000000000"}'

# 2. 铸造代币
curl -X POST http://localhost:3001/mint \
  -H "Content-Type: application/json" \
  -d '{"to": "recipient_pubkey", "amount": "50000"}'

# 3. 隐私转账
curl -X POST http://localhost:3001/transfer \
  -H "Content-Type: application/json" \
  -d '{"to": "recipient2_pubkey", "amount": "10000"}'

# 4. 查询余额证明（不含明文余额）
curl http://localhost:3001/balance/my_pubkey
```

---

## 第七部分：高级主题

### 7.1 隐私保护的最佳实践

1. **最小化链上公开数据**：所有敏感信息使用 `secret` 或 `shielded`
2. **使用 Nullifier 防重放**：每笔消费生成唯一的 nullifier
3. **批量证明优化**：多个操作合并为单一 ZK 证明以降低 gas
4. **定期更换地址**：建议用户定期生成新地址增强隐私

### 7.2 与其他 DeFi 协议集成

隐私代币可以无缝集成到 Midnight 生态的其他协议：

- **隐私 DEX**：在去中心化交易所进行匿名交易
- **隐私借贷**：质押隐私代币获取贷款，不暴露持仓
- **匿名投票**：使用代币余额作为投票权重，但不暴露具体持有量

### 7.3 安全审计清单

- [ ] ZK 电路约束是否完整覆盖所有边界条件
- [ ] Nullifier 是否正确实现以防止双花
- [ ] Merkle 树更新是否原子化
- [ ] 合约升级路径是否安全
- [ ] 事件日志是否泄露隐私信息

---

## 第八部分：故障排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 编译报错 | Compact 版本不匹配 | `npm update @midnight-ntwrk/compact` |
| 证明生成失败 | Merkle 树未同步 | 等待同步完成或重启节点 |
| 交易被拒 | 余额不足或证明无效 | 检查输入参数和证明完整性 |
| 连接超时 | 测试网拥堵 | 增加重试逻辑和超时时间 |

---

## 总结

恭喜你完成了 Midnight Network 隐私代币 dApp 的构建！你现在掌握了：

✅ Compact 隐私智能合约编写
✅ 零知识证明在代币系统中的应用
✅ 完整的 dApp 前后端架构
✅ 测试网部署和端到端验证

隐私是区块链大规模应用的关键缺失环节。Midnight Network 通过将隐私作为默认特性，而不是可选附加功能，为 Web3 的未来提供了一条可行路径。

---

## 参考资源

- [Midnight 官方文档](https://docs.midnight.network)
- [Compact 语言规范](https://docs.midnight.network/compact)
- [Midnight GitHub](https://github.com/midnightntwrk)
- [Zero Knowledge Proofs 入门](https://zkintro.com)
- [Midnight Discord 社区](https://discord.gg/midnight)

---

*本教程为 midnightntwrk/contributor-hub #326 赏金任务编写。*
*作者: billbtbillb-ui | 许可: Apache 2.0*
