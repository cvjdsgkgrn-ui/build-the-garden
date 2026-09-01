# Build the Garden

一个局域网优先的多人 3D 园林营造实验：观众进入同一座园林，铺路、布景、造桥、题字，并实时看到彼此的成果。

## 包含什么

- React、Three.js 与 React Three Fiber 的 3D 园林界面。
- Node + WebSocket 同步服务，服务端校验构件所有权与放置规则。
- 铺路、布景、水景、建筑、书画、游览，以及撤回、复制、旋转和移动。
- 可选 AI 对话：密钥只由服务端环境变量读取，浏览器不会保存密钥。

## 公开源码边界

本仓库只保留可复现的源码、测试与程序化几何占位物。

- 原始 GLB 模型未被包含；它们需要逐项确认来源与再分发授权后，才能加入自己的部署版本。
- `.env`、运行时 `server/state*.json`、日志、依赖和构建产物均被忽略。
- 不配置 `DEEPSEEK_API_KEY` 也可以使用营造和多人同步；仅 AI 对话不可用。

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm ci

# 终端 1：同步服务，默认 http://127.0.0.1:8088
npm run dev:server

# 终端 2：前端，默认 http://127.0.0.1:5174
npm run dev
```

若要启用 AI 对话，在启动同步服务时临时提供环境变量：

```bash
DEEPSEEK_API_KEY=your-key npm run dev:server
```

## 验证

```bash
npm test
npm run build
```

## 发布前仍需决定

请在创建公开远端前选择并加入许可证；没有 `LICENSE` 时，代码虽可见但不构成可复用的开源项目。
