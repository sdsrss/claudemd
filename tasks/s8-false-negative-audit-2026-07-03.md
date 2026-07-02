# §8 假阴性/绕过审计 — 2026-07-03

**动机**: 整个 §8 测试史与 FP 补丁流都在打**假阳性**(过度拦截,烦但安全);假**阴性**(真危险命令溜过)几乎没系统测过,而假阴性有真实前例(`env rm` 曾绕过全部 4 钩子直到 v0.23.11,见 `feedback_readonly_whitelist_exec_wrappers`)。§8 是本工具唯一不可妥协的价值核心,这里漏一个 = 最核心承诺失效。

**方法**: 构造对抗矩阵,把候选危险命令喂给检测器 hook(`pre-bash-safety-check.sh`)看是否 deny——**只测探测器、绝不执行 payload**(hook 只 grep/sed 命令串,天然安全);`DISABLE_RULE_HITS_LOG=1` + `session_id=probe` 防遥测污染。发现探针是一次性 scratchpad 脚本(已按 §8.V4 处置);FN-1 的回归保护已固化进 committed `tests/hooks/pre-bash-safety.test.sh`,复现只需按上述方法把候选命令喂给 hook 看 `permissionDecision`。

**检测器工作正常的**: rm-rf-var 基线(裸/引号/`${}`)、npx 基线、间接调用(`bash -c`/`dash -c`/`eval` 引号+无引号,v0.21.8 覆盖有效)、FP 控制 4/4(`rm -rf /tmp/build`、`$HOME/.cache/foo` 子路径、pinned npx、ls)。

## 发现的假阴性(分级)

### ✅ FN-1 npx 兄弟 runner(pnpm dlx / yarn dlx / bunx)—— 已修复本会话（未发版，攒批）
- **危险**: 与 `npx` 完全同类的 fetch-execute 未知包,仅因拼写不同绕过 §8 NPX gate。**未文档化**。2026 年 pnpm/bun 极常见。
- **在 §8 意图内**: §8「execute scripts of unknown origin」直接覆盖;`npx_pkg_locally_resolved` 本就读 pnpm-lock.yaml/yarn.lock,gate 天然跨生态对称。
- **修复**: 把 `NPX_REGEX` 从 npx-only 拓宽到 `(npx|bunx|pnpm dlx|yarn dlx)`,复用全部现有 pinned/local/lockfile 解析;捕获 matched runner 让 deny 消息诚实(`pnpm dlx <pkg>` 而非误报 npx)。方向更严(安全侧)。`pnpm install`/`yarn add` 靠 `dlx` 子命令要求排除(FP 控制已验证)。
- **证据**: RED→GREEN,`tests/hooks/pre-bash-safety.test.sh` +11 用例(4 deny + 7 FP 控制),157→161→全套件 523 pass。对抗矩阵复跑三 sibling 现 DENY、npx 基线+FP 不变。
- **可选后续(spec)**: core §8 的 "NPX: lockfile→local→pinned" 一行可改为点名 runner 家族——但不必需(通用「execute unknown origin」规则已覆盖),且是 core L3 改动(近 headroom 顶),留给下个 spec 批次。

### FN-2 `curl … | sh` / `wget … | bash`(execute unknown origin)—— 未修,建议审慎新增检测器
- **危险**: §8「execute scripts of unknown origin」明令禁止,却**零检测器**。经典供应链攻击首选向量,真实危险最高。
- **为何未在本会话修**: 这是**全新检测器**(不是拓宽已有),FP 面更大(`curl x | sh` 危险,但 `curl x | grep`、`curl x > f` 安全;pipe-to-shell 的信号识别要仔细)。往不可变 §8 核心一次塞多个新检测器会累积 FP 风险。值得**单独一个会话**用 TDD 审慎设计(pipe 右端是 `sh`/`bash`/`zsh` 等 shell → deny;右端非 shell → 放行)。

### FN-3 flag-bearing wrapper + xargs(`sudo`/`timeout`/`nice`/`stdbuf` rm -rf $X)—— 未修,已文档化的已知 gap
- **危险**: hook 头注释自己列为 "NOT covered";`sudo rm -rf $EMPTY/`(提权+空变量=root 删根)尤其值得。
- **现有覆盖**: 无参 wrapper(`env`/`command`/`nohup`/`setsid`/`time`)已 strip;有参的(`timeout 5 rm`/`nice -n10 rm`)因 wrapper 与 rm 之间夹参数,strip 循环停在参数 token。
- **建议**: `sudo`(无参、首个非 flag 即命令)是干净微修——加进 line 353-356 的 strip 列表即可(strip 非 rm 命令的 wrapper 无副作用)。有参 wrapper 需识别"跳过 N 个参数"逻辑,FP 风险略高,与 xargs(stdin 模型)一起攒。`[allow-rm-rf-var]` 是现有逃生舱。

### FN-4 `find $DIR -delete` / `find -exec rm`(非 rm 工具的等效删除)—— 未修
- **危险**: `find / -name x -delete`、`find $DIR -exec rm -rf {} +` 等效于递归删除,检测器只认 `rm` 段起始。
- **建议**: 新增 `find … -delete`/`-exec rm` 检测,与 FN-2 同属"新检测器"批,审慎 TDD。中危(需显式 `find` + 危险 action,不像 curl|sh 那样一行成灾)。

### FN-5 command-sub 目标 / 变量间接（`rm -rf $(cat)`、`X=rm;$X -rf $Y`）—— 未修,低优先
- **危险**: 目标是 `$(...)`/backtick 而非 `$VAR`,或命令名经变量间接。较冷门。
- **建议**: 拓宽 target 正则到 `$(...)` 会显著增加 FP(大量合法 `rm -rf $(some-safe-path)`)。低收益,记录待真实命中再评估。
- **注**: 矩阵里 `r''m` 那条测试**无效**——探测脚本自身的 shell 把 `'r''m'` 拼回 `rm` 才喂进去,没真正测到分裂 token 绕过;若要测需从 JSON 层构造。

## 建议的下一步优先级
1. **FN-2 (curl|sh)** 真实危险最高——单独会话新增 pipe-to-shell 检测器,TDD。
2. **FN-3 的 `sudo` 子项**——干净微修可随下个 §8 批次带上。
3. **FN-4 (find) + FN-3 有参 wrapper + FN-5**——攒成一个"新检测器/拓宽"批,一次审慎设计,别逐条塞进 §8 核心。
4. 全部按 internal-freeze 攒批发版(§8 是 live enforcement,但这些是加固不是回归,除 FN-2 真实危险外无紧急性)。
