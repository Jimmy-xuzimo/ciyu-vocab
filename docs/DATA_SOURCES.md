# 词库来源与许可

应用词库由公开词表和旧版项目词表生成。构建程序在 [scripts/build_vocabulary.py](../scripts/build_vocabulary.py)，生成文件 `public/data/lexicon.json` 为压缩 JSON；每个词条记录来源 ID，词库元数据仅列出本次实际收录的来源。

## 来源

| 来源 | 收录内容 | 已知许可或状态 |
| --- | --- | --- |
| [pluto0x0/word3500](https://github.com/pluto0x0/word3500) | 高考词汇 | MIT；重分发时保留上游版权与许可声明 |
| [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary) | 初中、高中、四级、六级、雅思、考研、托福、SAT | BSD-3-Clause；重分发时保留版权、许可和免责声明 |
| [本项目旧版词表](https://github.com/Jimmy-xuzimo/gaokao-vocab) | 高考词汇及旧学习 ID 对照 | 项目所有者提供的旧词表；第三方词条许可与代码许可分别看待 |
| 用户提供的四级 PDF | 四级词汇、音标与释义 | 权利状态未确认；仅用于本地构建，公开发布词条前须确认许可 |
| 用户提供的六级 PDF | 六级词汇与释义 | 权利状态未确认；仅用于本地构建，公开发布词条前须确认许可 |

MIT 与 BSD-3-Clause 完整许可证副本随应用打包，位于 `public/licenses/`，并可从学习报告中的“词书来源与许可”打开。

公开发行的默认构建不包含两份用户 PDF 的提取词条。构建脚本接受可选 `--cet4-pdf` 和 `--cet6-pdf` 参数供已确认权利的本地构建使用；在确认再分发权利之前，不要启用这两个参数后将词库推送到公开仓库或作为公开应用资源发布。

## 合并规则与限制

高中词书包含原高中与高考 3500 词表的并集，按英文拼写去重，目前共 3,900 词；其他词书共享全局词条 ID。

- 词条按 Unicode 规范化后的完整拼写合并，统一大小写、撇号和连字符形式；相同拼写跨词书只保留一个学习 ID，并合并词书、来源和去重后的释义。
- 变形、派生词和近似拼写仍是不同词条；词表中的别名用于搜索，不会自动把所有词形视为同一个单词。
- 用户 PDF 的文字通过表格提取生成。四级表保留提取到的音标；六级资料未提供独立音标。六级中少数可由上下文和其他词表佐证的明显截断拼写在脚本内做了显式修正，仍建议抽样校对。
- 词库为学习用途整理，不构成考试大纲或出版词典的完整性保证。新增、更新上游数据后应重新生成并抽查词条。

## 本地重建

在仓库根目录运行：

```powershell
python -m pip install -r requirements-vocabulary.txt
python scripts/build_vocabulary.py `
  --kyle-root ../english-vocabulary `
  --gaokao-root ../word3500 `
  --cet4-pdf "C:/path/to/大学英语四级词汇带音标-乱序版.pdf" `
  --cet6-pdf "C:/path/to/大学英语六级词汇乱序版.pdf" `
  --out public/data/lexicon.json `
  --report ../lexicon-import-report.json
```
