# 聊天附件测试数据

[English](README.md)

这些示例中的样本记录和事件均为虚构。测试 23 和 24 使用用户提供的故事书，版权和署名信息见 PDF。PowerPoint 设计模板包含现有的 AICUBER 品牌标识。以下每个示例都列出了需要附加的文件、提示词或操作，以及需要检查的预期结果。

1. 打开 **AI 对话**并开始新对话。
2. 附加测试列出的文件，或选择指定的对话模式。
3. 按测试提示词或操作进行，并检查回答及字段映射。
4. 打开**我的文件**，下载已保存的上传文件和生成结果。使用 AI 的测试可在 **AI 积分用量**中查看处理费用。

批量测试将电子表格的第一行作为列标题，并为后续每条记录生成一个文件。针对单个文件提问时，请只附加一个文件。AI 输出可能有所不同，请依据预期结果核对事实和生成的文件，无需要求措辞完全一致。链接中的提示词和答案文件保留其原有语言；部分测试会专门检查回答语言。

## 测试 1：Excel 填写可填写 PDF

文件：[participants.xlsx](test-1/participants.xlsx) 和 [registration-form.pdf](test-1/registration-form.pdf)

操作：选择**查看字段**，核对建议的映射，然后选择**生成文档**。

预期：生成五份已填写的 PDF。例如，Alice Tan 的表单应包含 `alice.tan@example.com`、`Northstar Labs`、`AI for Business` 和 `2026-11-05`。结果应显示电子表格列与 PDF 字段的映射方式。

## 测试 2：Excel 填写 Word 模板

文件：[participants.xlsx](test-2/participants.xlsx) 和 [registration-confirmation-template.docx](test-2/registration-confirmation-template.docx)

操作：选择**查看字段**，核对建议的映射，然后选择**生成文档**。

预期：生成五份可编辑的 Word 文档，所有匹配的占位符均被替换。Alice Tan 的文档应包含 `alice.tan@example.com`、`Northstar Labs`、`AI for Business` 和 `2026-11-05`。

## 测试 3：图片描述

文件：[kitchen-cat.png](test-3/kitchen-cat.png)

提示词：**请描述这张图片，包括物品、环境和光线。**

预期：阳光照进厨房，一只橘猫在木桌旁；画面中有马克杯、笔记本、铅笔、橙子和植物。

## 测试 4：电子表格分析

文件：[sales-records.xlsx](test-4/sales-records.xlsx)

提示词：**共有多少笔订单，总收入是多少，各地区和各产品的收入分别是多少？**

预期：六笔订单，总收入 6,000 美元。新加坡 3,600 美元；马来西亚 2,400 美元。Basic 3,300 美元；Premium 2,700 美元。

另一条提示词，需附加同一电子表格：**一月、二月和三月的总收入分别是多少？哪个月最高？**

预期：一月 2,000 美元；二月 2,100 美元；三月 1,900 美元。二月最高。

## 测试 5：图片 OCR

文件：[receipt.png](test-5/receipt.png)

提示词：**提取收据文字，并列出商品、小计、税额和总计。**

预期：收据编号 `HB-2048`；小计 `$28.00`；税额 `$2.52`；总计 `$30.52`。三项商品是笔记本、笔套装和帆布包。除回答外，也要检查提取文字的侧边面板。

## 测试 6：扫描 PDF 的 OCR 和摘要

文件：[scanned-meeting-notes.pdf](test-6/scanned-meeting-notes.pdf)

提示词：**提取并总结会议记录，列出决定、预算、行动负责人和截止日期。**

预期：试点于 2026 年 12 月 1 日进行，预算为 8,000 美元。Maya 在 11 月 18 日前完成试点计划，Alex 在 11 月 20 日前准备客户名单，Priya 在 11 月 25 日前测试报告仪表板。下一次会议为 11 月 26 日上午 10:00。此 PDF 仅包含图片，用于模拟扫描件。

## 测试 7：Word 文档问答

文件：[support-plan.docx](test-7/support-plan.docx)

提示词：**总结这份计划。响应时间目标是什么，谁负责试点，主要风险是什么？**

预期：试点由 Maya Chen 负责，目标是将平均首次响应时间从 24 小时缩短至 8 小时，主要风险是周末覆盖人员不足。

另一条提示词，需附加同一 Word 文件：**试点何时开始、持续多久，团队何时审查人员配置？**

预期：试点于 2026 年 11 月 2 日开始，持续四周，人员配置审查于 2026 年 11 月 16 日进行。

## 测试 8：Excel 填写 PowerPoint 模板

文件：[participants.xlsx](test-8/participants.xlsx) 和 [training-template.pptx](test-8/training-template.pptx)

操作：选择**查看字段**，核对建议的映射，然后选择**生成文档**。

预期：生成五份可编辑的 PPTX，姓名等字段在两张幻灯片上均已填写。对于 Alice Tan，请核对 `Northstar Labs`、`alice.tan@example.com`、`AI for Business` 和 `2026-11-05`。模板使用简单的 `{{Field Name}}` 占位符。下载一个文件并用 PowerPoint 打开，检查幻灯片布局。

## 测试 9：根据提示词生成 PowerPoint

在聊天输入框上方选择 **PowerPoint**，无需附件。

提示词：**创建一份五页演示文稿，说明一个为期四周、旨在改善客户支持响应时间的试点项目，涵盖目标、时间表、团队职责和风险。**

预期：生成包含封面和简洁内容页的可编辑演示文稿，并保存到**我的文件**。下载后检查布局。AI 可自行选择措辞和细节，分享前请核对事实。

## 测试 10：应用新的 PowerPoint 设计

先附加 [source-content.pptx](test-10/source-content.pptx)，再附加 [design-template.pptx](test-10/design-template.pptx)。检查**要复制的内容**和**新设计模板**标签；如有需要，使用**交换内容和模板**，然后确认角色并选择**应用模板**。无需提示词，此转换不消耗 AI 积分。

预期：**我的文件**中保存一份可编辑演示文稿，包含 AICUBER 标志，以及源幻灯片的 “Sales and receipt” 标题、收据图片和柱状图（A = 20，B = 35）。标题、收据、图表和模板标志应相互分离。下载并用 PowerPoint 打开，检查图表数据仍可编辑。转换会选择清晰的模板布局，并将源对象一起缩放或重新定位；演讲者备注、动画和切换效果不会转移。

## 测试 11：映射检查、批量结果和文件复用

文件：[attendees-mapping.csv](test-11/attendees-mapping.csv)、[registration-form.pdf](test-11/registration-form.pdf)、[registration-template.docx](test-11/registration-template.docx) 和 [presentation-template.pptx](test-11/presentation-template.pptx)。所有样本记录均为虚构。

1. **拖放：**将 CSV 和 PDF 拖入聊天输入区域。两个文件都应附加成功并出现在预览面板中。
2. **映射检查：**选择**查看字段**。将 `Full Name` 映射到 `Attendee`，将 `Email` 映射到 `Email Address`，将 `Company` 映射到 `Organization`；检查 `Course` 和 `Session Date` 是否匹配。选择**生成文档**。此映射和批量处理不消耗 AI 积分。
3. **进度和 ZIP：**批量处理应处理三条记录。第 2 行和第 4 行应成功；第 3 行应提示邮箱超过 PDF 字段的 100 字符限制。选择**全部下载为 ZIP**，确认其中包含两份成功生成的 PDF。文件也会保存到**我的文件**。
4. **Word 预览和映射：**在新对话中附加 CSV 和 DOCX 模板。侧边面板应显示包含表格和收据图片的格式化文档。生成前检查并修正相同的三个映射。三份 Word 文件均应生成；Word 模板没有 PDF 的邮箱长度限制。
5. **追问：**在完成的 PDF 批量结果中，对第 2 行的 PDF 选择**询问文件**，提问：**这张表格上的姓名、公司和课程是什么？**预期：Alice Tan、Northstar Labs 和 AI for Business。文件会再次处理，因此会产生正常的 AI 和 PDF OCR 费用。
6. **PowerPoint 预览与提问：**单独附加演示文稿模板，询问：**这些幻灯片上有哪些注册信息？**收到回答后，对该演示文稿选择**询问文件**，再问：**列出了哪些占位符？**使用侧边面板的**下一页**和**上一页**检查两张幻灯片。回答使用幻灯片文字，图片和图表不会发送用于分析。视觉预览为近似效果，请下载原文件进行准确的布局检查。如需图表和图片示例，也可预览[测试 10 的源演示文稿](test-10/source-content.pptx)。

## 测试 12：图片和视频模式控件

1. 不附加文件，在输入框上方选择**图片**。将 [image-prompt.txt](test-12/image-prompt.txt) 的内容复制到输入框，选择**创建图片**。确认返回图片并保存到**我的文件**。
2. 选择**视频 · 15秒**，复制 [video-prompt.txt](test-12/video-prompt.txt) 的内容，选择**创建视频**。任务完成后检查进度消息及保存的 15 秒视频。
3. 选择**对话**返回普通问答。附加文件后，确认移除附件前无法切换模式。

图片和视频生成消耗 AI 积分。请查看显示的估算值和 AI 积分用量；服务商可用性和最终费用可能不同。

## 测试 13：PowerPoint 生成与恢复

[提示词](test-13/prompt.txt)是测试 9 中的五页客户支持试点示例。[sample-slide-content.json](test-13/sample-slide-content.json) 是虚构的离线 AI 响应测试数据，包含额外及较长的项目符号。

运行 `node --test tests/chat-pptx.test.cjs tests/chat-pptx-recovery.test.cjs tests/chat-api.test.cjs`。测试会将数据渲染为可编辑 PowerPoint，把多余内容续到另一张幻灯片，并模拟存储失败和不额外收费的保存重试。测试不会调用 OpenRouter，也不会扣除 AI 积分。在聊天中手动运行提示词时，AI 请求会产生费用。

## 测试 14：防止 PowerPoint 对象重叠

将 [overlapping-source.pptx](test-14/overlapping-source.pptx) 附加为**要复制的内容**，将 [design-template.pptx](test-10/design-template.pptx) 附加为**新设计模板**。确认角色并选择**应用模板**。

预期：应用提示源对象重叠或距离过近，并且不保存误导性的结果。此测试故意将图片放在标题上方。使用 [source-content.pptx](test-10/source-content.pptx) 重复测试，以验证测试 10 的正常转换。交换两个文件的角色后继续操作，如果无法安全检查模板，也应被拒绝。这两种转换均不消耗 AI 积分。

[expected-restyled.pptx](test-14/expected-restyled.pptx) 是修正后的测试 10 转换结果，可用于比较。检查标题、收据、图表和 AICUBER 标志没有重叠，图表仍可编辑。

## 测试 15：流式长回复与停止

不附加文件，选择**对话**。使用[长回复提示词](test-15/prompt.txt)，然后选择**发送**。文字应在生成时逐步显示，**发送**应变为**停止**。在回复过程中选择**停止**；已生成的部分应保留在对话中，并且可以发送下一条消息。再次测试但不要停止，检查完整回复是否出现。输出上限较高，但文章的确切长度取决于模型。

手动请求会消耗 AI 积分；停止并不保证服务商停止计费。请在**AI 积分用量**中查看状态。[provider-stream.sse](test-15/provider-stream.sse) 仅包含用于离线测试的虚构用量。运行 `node --test tests/chat-stream.test.cjs tests/chat-api.test.cjs`，无需调用 OpenRouter 即可测试流式回复和计费。

## 测试 16：回复统计与复制

使用[基准测试数据](test-16/benchmark-response.json)进行离线测试：`node --test tests/chat-response-metrics.test.cjs tests/chat-stream.test.cjs tests/chat-api.test.cjs`。该数据包含九个单词、2.5 秒响应时间、服务商报告的 30 个输出 token，以及 2 秒 AI 请求时间，因此速度为 15 token/秒。

手动检查时，在对话中发送[长回复提示词](test-15/prompt.txt)。回复完成后检查字数、响应时间、输出 token 数和 token/秒。选择复制图标并粘贴到文本编辑器中，检查复制内容。重新打开对话，确认统计数据仍然保留。旧回复或服务商未报告 token 数的请求会用短横线表示不可用的指标。显示的响应时间包含应用处理时间；token/秒等于服务商输出 token 数除以 AI 请求时间，其中包括服务商延迟。停止请求可能不会返回 token 数。批量或媒体工作流可能不报告文字 token 统计。手动 AI 请求会消耗积分。

## 测试 17：知识图谱工作区大小

[knowledge-graph.json](test-17/knowledge-graph.json) 是用于布局预览的小型虚构图谱，包含客户、会议记录、决定和主题。在宽屏桌面设备上打开现有的 Nth Brain 图谱。节点图应使用侧边栏旁的可用宽度，并适应可见高度。折叠和展开侧边栏，在 **3D 星系**和 **2D 地图**之间切换，并使用**适合画面**或全屏。图谱调整大小时不应遮挡控件。在手机上，图谱和控件应可用，页面可滚动。图谱不消耗 AI 积分。

## 测试 18：将 PDF 导入 Nth Brain 并构建知识图谱

文件：[nth-brain-support-pilot.pdf](test-18/nth-brain-support-pilot.pdf) 和 [ingestion-prompt.txt](test-18/ingestion-prompt.txt)。这是一份可搜索的三页虚构项目简报，包含人物、公司、团队、工具、目标、决定、风险和反馈。双中括号中的名称表示相互关联的概念。

1. 打开已就绪的 **Nth Brain** 项目。为保持测试清晰，建议使用单独的测试项目，避免虚构页面与真实项目知识混在一起。
2. 在**上传到此 Nth Brain**下，选择**添加文档**并选择 PDF。将下面的提示词粘贴到 **AI 导入指令**，然后选择**上传到 Nth Brain**。
3. 等待后台导入完成、页面树刷新。检查生成的页面及其中的 `[[wiki links]]`。如缺少页面，重新粘贴指令并选择**重试已保存的上传**。如来源未保存，请重新附加 PDF。继续前先解决显示的错误。
4. 选择**生成知识图谱**，等待索引完成，然后打开同一项目的**知识图谱**。搜索 **Support Pilot**、**Maya Chen**、**Ticket Routing** 和 **Knowledge Base**。选择节点，检查其连接并打开来源页面。
5. 至少核对以下关系：Maya 负责 Support Pilot；Alex 负责 Ticket Routing；Ticket Routing 依赖 Knowledge Base；Priya 负责 Response Time Dashboard；Weekend Coverage 是 Eight-Hour Target 的一项风险。AI 导入产生的确切数量、标签、类型和边可能不同。图谱链接来自已索引的 wiki 链接及支持的关系字段；一条连线本身不能证明关系正确。图中也可能出现项目范围的可视连接。

**AI 导入指令：**

```text
将附带的虚构 Northstar Labs 客户支持试点简报导入此 Nth Brain。以 PDF 为事实依据，保留其中的姓名、日期、负责人、决定、风险和所述关系。不要编造事实。

为 Northstar Labs、Customer Support Team、Support Pilot、Maya Chen、Alex Tan、Priya Rao、Sam Lee、Ticket Routing、Knowledge Base、Response Time Dashboard、Eight-Hour Target、Pilot Approval、Weekend Coverage 和 Customer Feedback 分别创建或更新标题清晰的 wiki 页面。使用 [[Support Pilot]]、[[Maya Chen]] 和 [[Ticket Routing]] 等准确的 wiki 链接连接相关页面，以便知识图谱索引关系。在 Nth Brain 索引和日志中加入来源文档及有用链接。

对于文档支持的关系，在适当的页面 frontmatter 中使用图谱支持的关系名称：owned_by、depends_on、related_to、decision_from 或 source_for。例如，在 Support Pilot 页面使用 owned_by: Maya Chen；在 Ticket Routing 页面使用 owned_by: Alex Tan 和 depends_on: Knowledge Base。也请在每个页面中说明依据。不要把风险、目标或拟议结果写成已经发生的事实。
```

导入使用项目的 AI agent，可能产生正常费用。生成图谱会索引生成的 wiki 内容。该 PDF 为文本格式，不需要 OCR。

## 测试 19：发送按钮方向

打开 **AI 对话**并输入[示例提示词](test-19/prompt.txt)。**发送**旁的箭头应指向右侧，按钮应可用。也检查 Nth Brain 页面上的需求输入框：其发送箭头应指向右侧。发送 AI 请求可能产生正常费用；仅检查图标不会收费。

## 测试 20：在“我的文件”中播放生成的 MP4

手动测试时，在 AI 对话中选择**视频 · 15秒**并使用 [video-prompt.txt](test-20/video-prompt.txt)。视频任务完成后，打开**我的文件**，在生成的 MP4 旁选择**播放**。视频应在浏览器中显示播放控件；暂停视频、跳转到其他位置、关闭播放器，确认**我的文件**仍保持打开。使用**下载**保存原视频。在桌面和手机上重复测试。创建视频消耗 AI 积分；播放已有视频不消耗积分。

[playback-sample.mp4](test-20/playback-sample.mp4) 是用于离线播放测试的三秒虚构测试画面；它不是 AI 生成的视频，也不能作为聊天附件上传。运行 `node --test tests/chat-files.test.cjs`，无需生成视频即可验证经过身份验证的视频预览和字节范围响应。

## 测试 21：生成 15 秒视频并查看费用

在 AI 对话中选择**视频 · 15秒**并使用 [video-prompt.txt](test-21/video-prompt.txt)。提交前，确认应用显示当前预计预留积分。选择**创建视频**，等待任务完成，然后打开**我的文件**播放并下载保存的 MP4。在播放器中检查时长，并在**AI 积分用量**中查看明细费用。预估费用与最终费用可能不同。AI 视频请求会计费，生成结果受 20 MiB 存储限制。

离线检查可运行 `node --test tests/chat-video-generation.test.cjs`。该测试无需生成视频，即可验证向服务商发送的 15 秒请求、模型能力检查、积分预留、最终费用结算和任务恢复。

## 测试 22：导入社区花园 PDF 并构建知识图谱

文件：[nth-brain-community-garden.pdf](test-22/nth-brain-community-garden.pdf) 和 [ingestion-prompt.txt](test-22/ingestion-prompt.txt)。这份可搜索的三页虚构简报为测试 18 的导入和图谱流程提供了另一个主题。

1. 打开已就绪的 **Nth Brain** 项目，最好使用单独的测试项目，避免虚构页面与真实知识混在一起。
2. 在**上传到此 Nth Brain**下附加 PDF，将提示词文件内容粘贴到 **AI 导入指令**，然后选择**上传到 Nth Brain**。
3. 等待导入完成。检查生成的页面及其 `[[wiki links]]`，然后选择**生成知识图谱**，并打开同一项目的**知识图谱**。
4. 搜索 **Rainwater Harvesting Project**、**Nadia Lim**、**Rain Barrel System** 和 **Water Usage Log**。打开节点及其来源页面，检查依据。
5. 核对：Nadia 负责该项目；Omar 负责 Rain Barrel System；系统安装依赖 Gutter Inspection；Lena 负责 Water Usage Log；Dry Weather Risk 可能威胁 Water Savings Target。该目标是拟议目标，尚未达成。AI 导入可能产生不同的图谱标签、类型和边数，因此应同时检查页面和图谱。

导入使用项目的 AI agent，可能产生正常费用。生成图谱会索引生成的 wiki 内容。该 PDF 为文本格式，不需要 OCR。

## 测试 23：在 AI 对话中查询马来语电子书 PDF

文件：[Rahsia_Pisang_Nenek_Edisi_Sinematik_Melayu_V2.pdf](test-23/Rahsia_Pisang_Nenek_Edisi_Sinematik_Melayu_V2.pdf)。这本用户提供的马来语插图改编本共 14 页，约 9.6 MB。书中的署名说明指出，它对原作的人物和事件进行了扩展。

1. 在 **AI 对话**中开始新对话，选择**添加文件**并选择 PDF。请单独附加这本电子书；不支持同时将两个 PDF 作为一对附件。
2. 发送 [prompt.txt](test-23/prompt.txt) 的英文问题。根据[答案及页码](test-23/expected-answers.md)核对每个回答和页码。聊天中应显示上传文件及其 PDF 预览；处理后检查页面及提取文字的侧边面板。
3. 对已保存的电子书选择**询问文件**，发送 [follow-up-prompt.txt](test-23/follow-up-prompt.txt) 中的马来语追问。回答应使用马来语，并以此版本的事件为依据。
4. 打开**我的文件**，确认 PDF 已保存。在**AI 积分用量**中检查 PDF 处理费用；每次 AI 提问都可能产生费用。

预期：女孩名叫 Amina。奶奶让她去取拐杖时，她闻到甜味，并在房间里发现盖着旧毯子的篮子，里面有黄色香蕉（PDF 第 5 页）。她先拿一根，后来又拿四根（第 6–7 页）。奶奶询问时，她否认拿了香蕉（第 8 页）。后来她承认说谎和拿走五根香蕉，道歉并提出帮助奶奶（第 11 页）。第二天早上，她们一起干活；她拿香蕉前先征得奶奶同意（第 13 页）。追问可以结合这些事件讨论诚实与重建信任；应区分个人解读和书中明确记载的事实。

## 测试 24：在 AI 对话中查询中文电子书 PDF

文件：[奶奶的香蕉.pdf](test-24/奶奶的香蕉.pdf)。这本用户提供的中文故事书共 12 页，约 0.6 MB。最后一页列出 Ursula Nafula、Catherine Groenewald 和 Vicky Liu 的署名，并注明源作品采用 CC BY 3.0 许可。

1. 开始另一个 **AI 对话**，单独附加中文 PDF，发送 [prompt.txt](test-24/prompt.txt) 中的中文问题。根据[答案及页码](test-24/expected-answers.md)核对每个回答和页码，并检查 PDF 预览与提取文字的侧边面板。
2. 对已保存的电子书选择**询问文件**，发送 [follow-up-prompt.txt](test-24/follow-up-prompt.txt) 中的英文追问。确认回答使用英语并引用 PDF 页码。
3. 检查**我的文件**和**AI 积分用量**。PDF 处理和后续 AI 问答可能产生费用。

预期：叙述者帮奶奶取拐杖时闻到熟香蕉的味道，在奶奶卧室发现盖着旧毯子的篮子（PDF 第 6 页）。叙述者先拿一根香蕉，后来又拿四根（第 8–9 页）；书中明确写出吃掉了第一根，但没有明确说明四根香蕉是否被吃掉。奶奶把熟香蕉和木薯带到集市出售（第 10 页）。爸爸、妈妈和奶奶叫叙述者过去；叙述者决定以后不再偷东西（第 11 页）。中文原作没有写出叙述者姓名、明确描述其道歉，或完整解释催熟香蕉的方法。不要将马来语改编本中的 Amina、坦白、道歉或市场摊位情节带入中文原作的回答。

两份 PDF 均符合当前 AI 对话单个文件不超过 20 页和 20 MB 的限制。AI 回答和 OCR 结果可能不同，请对照相应 PDF 核实页码和事实，无需要求措辞完全一致。
