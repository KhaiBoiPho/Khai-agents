# Khai-Agents

Khai 是一个 AI agent 工作空间，可直接处理项目代码：读取和修改文件、运行命令、检查结果、搜索资料并生成文档。产品提供 Web、桌面和共享 Gateway 界面。

## 功能

- 在独立项目工作空间中处理代码，并查看变更。
- 连接 AI 服务商和模型，设置费用限制并查看 agent 活动。
- 搜索网页、阅读代码并整理带来源的答案。
- 创建和预览文档、表格、PDF 与演示文稿。
- 在同一工作空间使用计划、日历、笔记和 KhaiDocs。
- Gateway 提供账户注册、登录和用户管理。

## 本地页面

- `/`：产品介绍页。
- `/app`：登录或创建账户。

在新数据库中注册的第一个账户会成为管理员；之后注册的账户需要管理员批准。

## 本地开发

需要 Python 3.12+、Node.js 22+ 和 Docker。macOS 上可使用 Colima。

```sh
./docker/stack/up.sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm --prefix desktop ci
npm --prefix desktop run build:web
```

然后按照 [`README.md`](README.md) 中的步骤加载 `docker/stack/.env` 并启动 Gateway。打开 `http://127.0.0.1:8090/` 查看介绍页，或访问 `http://127.0.0.1:8090/app` 登录。

## 许可证

请参阅 [`LICENSE`](LICENSE)、[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 以及各组件目录中的许可证和来源说明。分发时请保留版权与许可证声明。
