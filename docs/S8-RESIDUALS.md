# §8 rm/npx/curl 闸门的已接受残差族

本表登记 `hooks/pre-bash-safety-check.sh` 已知、已接受、暂不修补的漏报（`xfn`）和误报（`xfp`）族。目的是让评审收敛：每一族在这里裁定一次，不在每一轮评审里重新争论。做法来自 cc-safety-net 仓库的残差风险登记（docs/oss-benchmark-2026-09-28.md §4 R1，本地文档）。

- 每一行语料都在 `tests/fixtures/bash-safety/corpus.tsv` 里带 `xfn` / `xfp` 标签，并被严格断言：判定一旦改变，测试就失败并提示改标签。数量以运行器最后打印的 `Residuals: xfn=N xfp=M` 为准，本文不写总数。
- 下表的"真实命中"指在本机真实命令里自然出现的次数，不是评审者构造的形状。没测过的写"未测"。
- 结构性出路是 R2 的解析器。它的影子评估器（`scripts/offline-eval/s8-shadow.mjs`，shfmt 3.14.1）2026-09-29 在语料上的结果：与 rm/find 相关的 28 条 `xfn` 行里，AST 臂拒绝 25 条；与 rm 相关的 4 条 `xfp` 行，AST 臂全部放行；121 条 `pass` 行一条也不拒绝。它还只是离线评估器，不参与判定。

## 族

| 族 | 类型 | 形状 | 语料行 | 接受理由 | 真实命中 |
|---|---|---|---|---|---|
| F1 PROV | xfn | mktemp 来源认可给了一个在父 shell 里未必执行的赋值：子 shell、`&&` 右侧、后台、`if`/`while`/`case`/`for`/`until`/`select` 体、函数体、rm 之后的赋值、`unset ${x-S}`、DEBUG trap | `S8-PROV1`–`S8-PROV20` | 文本切词判断不了控制流支配关系。D#103 的文本修法两轮评审后被回退，真实回放里判定 0 移动（`b55d611`）。R2 的 AST 支配规则从结构上处理它（影子阶段，`scripts/offline-eval/s8-ast/`） | `a && D=$(mktemp …)`：6,138 条 rm/find 真实命令里 31 条，26 条放行，都是普通的 `mkdir -p x && D=$(mktemp -d …)`（2026-09-25 测）。其余形状只出现在测试闸门本身的文本里 |
| F2 WS | xfn | 目标里的空白把一个路径切成两个词：带空格的目录名、带空格的守卫消息 `${D:?must be set}` | `R16 residual FN: whitespace …` ×2、`F43 RESIDUAL` | 按空白切词是全部臂的共同前提，修它等于换解析器（R2） | 未测 |
| F3 WALK | xfn | 不含字面 `..` 的向上走：`~/..`、`~user/..`、`U=..` 再拼接、`${U:-..}`、`$(dirname "$HOME")` | `R16 residual FN:` tilde ×3、dotdot ×2、substitution ×1 | 需要求值才能看出走向；文本只能看字面 `..` | 反斜杠或花括号里的 `..`：2 条，都在闸门测试文本里（2026-09-25 测） |
| F4 FETCH | xfn | 取回侧序列看不见的形状：反引号里的 `timeout 5 curl … \| sh`、第二个赋值前缀 `x=1 y=$(curl … \| sh)` | `S8-RES1`–`S8-RES3` | 构造形状；修补会扩大取回侧序列的匹配面 | 未测 |
| F5 PRESERVED | xfp | 带 `$` 或反引号的双引号正文被原样保留，其中的散文被当成命令读：`mem_save --lesson "… ; rm -rf $X …"`、`git commit -m "docs: run \`make setup\`; then npx …"` | `S8-EQ1`、`S8-EQ2`、`S8-CS9`、`S8-BQ1`–`S8-BQ3` | 把正文折叠掉的修法在 0.82.0 三轮评审里产生了五个漏报，整块撑回（记忆 feedback_revert_the_component_not_the_next_defect）。保留比解析安全；有逃生办法：单引号、`git commit -F FILE` | 未测 |
| F6 BACKSLASH | xfp | 引号外的反斜杠没有建模：`echo \"x\" 'y; rm -rf $f'` 里的 `\"` 被当成开引号 | `S8-EQO5` | 引号外的转义很少出现在参数位置；建模它属于切词器重写（R2） | 未测 |

## 评审规则（发版前评审与批末评审）

写进 `.claude/agents/release-reviewer.md`，这里是依据：

1. 每条 §8 漏报发现都写 `Provenance:`，取值 `field evidence`（真实命令回放或真实会话里出现过）或 `reviewer-constructed`（评审者构造的形状）。
2. 落在上表某一族内、又是 `reviewer-constructed` 的漏报，记为非阻塞备注，不进修复轮。
3. `field evidence` 的漏报照常阻塞，不管它落不落在已登记族里。2026-09-29 的注释撇号漏报（`S8-CQ*`）就属于这种：真实命令里出现过 3 次。
4. 轮次预算：一轮评审驱动的修复，加一轮确认评审。之后再冒出新的漏报族，就把它归类登记到本表，不再打补丁。

## 维护

- 新增或关闭一族：同一提交里改语料标签和本表。
- 修好一行残差：测试会提示把 `xfn` 改为 `deny`、把 `xfp` 改为 `pass`；同时把它从本表的"语料行"里删掉。
