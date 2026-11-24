# AI承诺星图｜阶段B独立竞赛增强模块

**机器状态：`B_SUBMITTED_FOR_CONTROLLER_REVIEW`；仅提交审核，不代表 `B_GATE=ACCEPTED`。**

> **完全合成数据演示，非真实AI分析结果。** 本代码未读取、连接或集成冻结的《项目沟通与承诺审计智能体APP》V2.0。演示中的人物、承诺、来源、证据、复核、日期、风险均是虚构的。没有调用DeepSeek、SQLite、Vault、真实账号或云服务。

## 1. 交付内容与入口

- `index.html`：**阶段B正式演示入口**。默认执行**合成报告 → 字段适配 → 报告Schema校验 → GraphContract校验及CrossRefValidator → Cytoscape.js图谱展示**，而不是直接加载旧Graph JSON。
- `src/report-input.schema.json`：阶段B自行约定的合成报告输入契约，**不是已核实的V2.0真实报告格式**。
- `src/report-adapter.js`：零新增依赖的可执行映射器。对未知字段、悬挂引用、隐私风险及复核错绑采取安全拒绝策略；拒绝时不生成可用图。
- `src/competition-flow.js`：浏览器端编排桥接，继续复用A-R既有`src/validator.js`、`src/app.js`和中文交互侧栏。
- `fixtures/competition-synthetic-report.json`：与A-R原始虚构案例语义一致、但采用**报告字段**的合成输入；`competition-graph-output.json`：真实运行适配器生成的对应GraphContract示例。
- `fixtures/b_invalid_reports/`：7份可审计的错误报告输入；`fixtures/invalid-*.json`：A-R原有30份GraphContract负例，均原样保留。
- `vendor/`：继承并保持A-R字节一致的Cytoscape.js **3.33.1** 与MIT许可原文；首选3.34.4的版本偏差仍未解决。

## 2. 演示流程

1. 在支持本地静态文件加载的**隔离浏览器环境**尝试打开 `index.html`；完整保留ZIP相对目录结构。当前沙箱 `file://` 导航返回 `ERR_BLOCKED_BY_ADMINISTRATOR`，因此离线双击和Windows运行均为 **`NOT_VERIFIED`**。
2. 页面默认进入“完全合成”项目案例，标题下方显示“合成报告输入 → 严格适配 → 跨引用与复核校验 → 图谱展示：已完成”。这仅表示合成输入验证、展示流程在已执行的Chromium内存环境中成立，不代表V2.0接入。
3. 点击“承诺A”，右侧能查看两项引用证据、可定位的来源及绑定到承诺`C_A`的**完全合成**复核记录；点击证据与关系检查相应引用。
4. 操作中文节点/关系筛选、搜索、缩放、拖动及重置。实线为来源直接陈述，虚线为模拟推断、仍待人工复核；“未知”关系不连线。
5. 使用“导入合成报告JSON”选择本ZIP内`fixtures/competition-synthetic-report.json`；错误格式、无来源或复核错绑报告被拒绝后**清空旧图**。点击“恢复合成案例”重新展示。

如浏览器不允许`file://`，可在**获得后续本机操作授权**的隔离目录中，由环境持有人使用静态HTTP服务测试，例如有Python时在解压目录下执行 `python -m http.server 8765 --bind 127.0.0.1`。本轮**没有真实验证该回环服务导航**，此说明不是部署声明。绝不导入用户真实资料或声称当前输入契约具备真实数据脱敏能力。

## 3. 自动化复测

在本ZIP根目录、已经具备对应执行环境时：

```bash
node tests/validator.test.js
node tests/adapter.test.js
python tests/schema_independent.test.py
python tests/browser.test.py
python tests/b_integration_browser.test.py
python tests/ui_string_audit.py
```

- B阶段适配器 Node：**42/42 PASS**。
- A-R原有 Node：**37/37 PASS**。
- A-R原有 Chromium：**27/27 PASS**。
- 新增B阶段 Chromium：**20/20 PASS**。
- Python标准Draft2020-12 JSON Schema核验：**5/5 PASS**。
- A-R原有界面字符串审计：**52个界面状态，0项规则违例**；B阶段中文主要流程/错误消息通过新增实际浏览器测试。

详情见`evidence/`真实日志、`docs/B_TEST_AND_FAILURE_LOG.md`。Chromium在本沙箱中通过**内存加载页面与源文件**执行，属于真实浏览器Canvas、JS和鼠标测试，但**不是`file://`/HTTP/CSP/Windows端到端证明**。页面不会从公网获取依赖。

## 4. 实际可接线边界

唯一公开接口：`ReportGraphAdapter.adaptReport(report, reportInputSchema, graphSchema)`，成功返回`{ok:true,graph,validation}`；失败返回`{ok:false,phase,errors,graph:null}`。浏览器调用`ConstellationIntegration.loadReport(report)`，会执行二次GraphContract校验与安全渲染；不接受未知V2.0报告字段。输入字段见`docs/B_INPUT_CONTRACT_AND_DATA_FLOW.md`。真实工程的待核验清单与隔离复制方案见`docs/B_INTEGRATION_HANDOFF.md`。

**不得**直接将V2.0真实报告、数据库、Vault或隐私原文送入本模块；必须在后续获得正式授权、真实工程接口完成核验、隐私/许可证审查合格后另行研发正式适配边界。

## 5. 非验收项与停止条件

Cytoscape.js仍为3.33.1；Windows离线双击、真实V2.0前端接线、真实报告字段、CSP本地导航、DeepSeek、云端部署、正式打包、公众分发均为`NOT_VERIFIED`/`NOT_RUN`。**原V2.0冻结工程没有被访问或修改**；新独立《文件脱敏与AI改写恢复APP》完全不在本项目范围内。当前仅提交B阶段Controller审核，未开始C/D阶段。
