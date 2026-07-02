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

### ✅ FN-2 `curl … | sh` / `wget … | bash`(execute unknown origin)—— 已修复本会话(未发版,攒批)
- **危险**: §8「execute scripts of unknown origin」明令禁止,却曾**零检测器**。经典供应链攻击首选向量,剩余项里真实危险最高。
- **修复(Pattern 3)**: 新增检测器,判据 = 左侧网络 fetch(curl/wget)在**命令位置** + 右侧 shell 解释器(sh/bash/zsh/dash/ksh/ash,可经 sudo),覆盖 pipe 形(`curl … | sh`,含无空格 `curl x|sh`、`| sudo bash`、`sh -s -- args`)+ 进程替换形(`bash <(curl …)`)。按 pipeline 段(newline/`;`/`&&`/`||`)匹配避免跨段误配;匹配 SANITIZED_CMD 所以引号内 prose 不触发;`unwrap_indirect` 已暴露 `sh -c "curl x|sh"` 内层。新 `§8-curl-sh` 遥测桶 + `[allow-curl-sh]` 逃生舱。
- **FP 边界(明确放行)**: 本地/字面源 `cat local.sh|sh`/`echo cmd|bash`、非 shell sink `|jq`/`|grep`/`|tar`、纯下载 `curl -o file`/`curl>file`/`wget URL`、curl 在参数位 `echo curl|sh`、引号内 prose。**命令位置锚定**是关键——curl 必须在段首或 `|;&(` 后才与 `echo curl` 区分。
- **证据(RED→GREEN)**: `tests/hooks/pre-bash-safety.test.sh` +18 用例(8 deny + 10 FP 控制)+ 遥测断言扩展(§8-curl-sh 落自己桶、generic §8 仍为空)。161→179→全套件 523 pass。
- **文档化残留(未覆盖,低频)**: 命令替换形 `eval "$(curl x)"` / `sh -c "$(curl x)"`(与 unwrap 交互复杂);`curl|python`/`|node`/`|perl`(非 shell 但同样执行远端,为控 FP 面不纳入);full-path `/usr/bin/curl|sh`(命令位置锚定只认裸 curl/wget)。待真实命中再评估。

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

## 建议的下一步优先级（FN-1 + FN-2 已修，剩余）
1. **FN-3 的 `sudo` 子项**——干净微修(`sudo` 无参、首个非 flag 即命令),加进 rm wrapper strip 列表即可,可随下个 §8 批次带上。
2. **FN-4 (find -delete) + FN-3 有参 wrapper (`timeout`/`nice`/`stdbuf`/`xargs`) + FN-5 (command-sub 目标)**——攒成一个"新检测器/拓宽"批,一次审慎 TDD,别逐条塞进 §8 核心。
3. **FN-2 残留**(`eval "$(curl)"` 命令替换形)——若要闭合,需处理与 unwrap_indirect 的交互,单独小心。
4. 全部按 internal-freeze 攒批发版(§8 是 live enforcement,但这些是加固不是回归,无紧急性)。已修的 FN-1/FN-2 是非 release commit,随 07-10 §10-V 批次发。
