---
description: "dsh Web 客户端的「本地模型」设置分区：本地端点的状态、它所服务的模型，以及存储在本机上的模型文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-local-models

[English](README.md) | 中文

## 概述

使用**本地模型**设置分区查看本机在本地提供什么：本地端点是否运行、地址是什么，它服务哪些模型及其加载状态，以及本地模型文件夹中有哪些模型文件。文件在磁盘上并不意味着正在被服务，因此文件夹中的文件单独列出并如此标注。已加载模型的运行时上下文分配与其最大上下文，分别标注为两个不同的事实。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在设置里打开**本地模型**。该分区在挂载时通过宿主的 `localModels` Remote 命名空间读取状态，并提供刷新控件以重新读取。端点未运行时，分区会如实说明且不显示任何服务控件；状态读取本身失败时，分区显示错误提示而不是模型列表。本机没有本地模型文件夹或文件夹为空时，显示文件夹的空提示。在两种服务模式下，每个模型都带有其生命周期控件——按加载状态显示启动或停止，以及需要行内确认的删除——操作完成后会重新读取它所改变的状态；操作失败时，失败信息显示在该行中。在通过 Ollama 提供服务的主机上，每个被服务的模型还带有下载（运行期间显示拉取自身的进度）。在 llama 模式的主机上，模型行即注册表本身，已加载行即端点当前所服务的模型，且有一个 Hugging Face 下载表单——仓库输入，其“列出文件”操作会列出仓库的文件及大小——以拉取任务自身的进度把操作者所选的文件下载到本地模型文件夹，完成后刷新出的列表会显示它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该分区通过 `ctx.slots.inject` 以 id `local-models`、顺序 12 注册进 `settings.section`，因此无论设置外壳的声明何时到达都能安装。本包的 `apply` 只做一次 Remote 结果解包：分区被注入普通 promise——`loadStatus` 负责状态读取，生命周期操作为 `startModel`、`stopModel`、`deleteModel`、`startPull`、`pullStatus`、`listRepoFiles`——每个都解析为其负载，Remote 调用失败时拒绝；组件据此渲染等待、错误和就绪三种状态。组件接受可选的单模型操作渲染器作为 props——这是单模型操作的接入点——且本包的注册确实提供它们：注册的包装组件（`LocalModelsSectionWithActions`）在两种模式下都为模型行渲染生命周期控件（单行下载仅在 Ollama 模式下），仅在 llama 模式下通过分区的下载接入点渲染 Hugging Face 下载表单，文件夹行不带任何控件（llama 模式下模型行即注册表；Ollama 模式下对磁盘上的注册表 GGUF 没有诚实可用的操作），并在操作完成后重新挂载分区以重新读取状态。不带渲染器时，裸组件不渲染任何操作控件。宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行，客户端模块系统据此送出浏览器半侧。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-settings-models](../ui-settings-models/README.zh.md)——与本分区相邻的「模型」设置分区。
- [ui-settings](../ui-settings/README.zh.md)——声明 `settings.section` 的领域基座。
- [ui-settings-plugins](../ui-settings-plugins/README.zh.md)——「内置插件」分区，本包的注册方式与之相同。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。它列出的模型由本机的本地端点服务，其模型体验归该端点自己的包所有。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **所选文件以单个字符串传递给拉取**——Remote 拉取（`startPull`）只接受一个 `modelId`，因此操作者从列表中选择文件后，表单发送 Hugging Face 仓库名并以 `/` 追加该文件；宿主的 llama 模式拉取负责把该字符串读作仓库加文件。操作者从不输入文件名：表单的 `listRepoFiles` 操作返回仓库的文件，选择即命名文件。磁盘上的文件夹行在两种模式下都不带自己的操作：llama 模式下模型行就是同样的注册表条目并带有控件；Ollama 模式下对注册表 GGUF 没有诚实可用的操作。
- **状态只在挂载和刷新时读取**——分区不订阅推送变化，因此在别处加载的模型要在刷新后才会出现。
- **运行时不变量：**不发布伴生。分区除了所渲染的 Remote 状态读取之外不拥有任何关系。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
