# Observation: generated-dir Edit/Write guard — 探针结果为零，不建

- **Date**: 2026-07-05
- **Status**: closed-unless-reopened（观察项，非执行积压）
- **来源**: agents.md 文档对比分析（`/mnt/data_hdd/project/agents.md/agents完整版.md`）中识别出的唯一 claudemd 插件级候选：`PreToolUse: Edit|Write` 生成目录写保护（`node_modules/` `dist/` `.next/` `src/.umi/` `target/` 等）。当前 hooks.json 的 PreToolUse 只挂 `Bash` + `Read`，无 Edit/Write 路径守卫——缺口属实，但按冻结纪律（[[project_internal_freeze_v02312]]）证据先行。

## 探针结果（2026-07-05）

扫描全部保留 transcripts（`~/.claude/projects/*/[*/]*.jsonl`，有界 glob 非递归遍历）：

- **1,933 个 transcript 文件 / 0.44 GB / 164,448 行**，窗口 **2026-06-08 → 2026-07-05（约 27 天，受 CC transcript retention 限制）**
- 去重后（按 `tool_use id`，防 resume 复制重计）**Edit 5,395 + Write 628 = 6,023 次带路径的写调用**
- **命中生成目录：0**（real 0 / tmp-fixture 0）

可信度校验（防"匹配器静默失效导致假零"，教训见 [[feedback_self_referential_marker_regex]]）：

1. 正则自测 15/15 通过（含 `builds/`、`.github/`、`build.rs`、`distance.py` 阴性用例）。
2. 差分扫描（独立于结构解析，直接抓裸行 `"file_path"` 值）：10,808 个路径值，9 个生成目录命中，**全部是 Read/echo 上下文，0 个在 Edit/Write 行**——读 `oh-my-codex/dist/`（装好的包源码）、读 `.git/hooks/pre-commit`、读 huggingface `.cache` 模型代码，全是合法读取。

## 结论

27 天窗口内该 hook **零真阳性、零误报对象**——今天建它是纯死重（hook + 测试 + §8 家族 FN 矩阵的维护成本，0 测得收益）。冻结不动。

**限制**：(a) 窗口仅约 27 天（retention 裁剪了更早历史）；(b) 未覆盖 Bash 侧写入（`sed -i` / `>` 重定向 / `cp` 进 dist）。

## 重开条件（任一满足才动手）

1. 真实事故 ≥1 例（任何 session 观察到 agent 写生成目录）；或
2. 前端 agent 工作负载明显上升后复跑探针出现 real match > 0。

届时实现为 `PreToolUse: Edit|Write` 纯前缀 deny hook，**必须**先过 FN 矩阵（[[feedback_s8_false_negative_audit]]）。

## 可复跑探针（自包含）

```python
#!/usr/bin/env python3
# probe: any Edit/Write tool_use targeting generated/build dirs?
import glob, json, os, re
from collections import Counter

ROOT = os.path.expanduser("~/.claude/projects")
FILES = sorted(set(glob.glob(os.path.join(ROOT, "*", "*.jsonl"))
                   + glob.glob(os.path.join(ROOT, "*", "*", "*.jsonl"))))
ALWAYS = ("node_modules|\\.next|\\.nuxt|\\.output|\\.umi|\\.umi-production|"
          "\\.svelte-kit|\\.turbo|__pycache__|\\.parcel-cache|\\.angular|"
          "\\.pytest_cache|\\.mypy_cache|\\.ruff_cache|\\.gradle|\\.cache")
SEG = re.compile(r"(^|/)(" + ALWAYS + r"|dist|build|out|target|coverage|\.git)/")
assert SEG.search("/p/dist/a.js") and not SEG.search("/p/builds/x.c")
assert SEG.search("src/.umi/x.ts") and not SEG.search("/p/.github/ci.yml")
TMP = re.compile(r"(^/tmp/|/var/folders/|/\.claude/tmp/|/scratchpad/|/fixtures?/|/tests?/)")
TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
QUICK = ('"Edit"', '"Write"', '"MultiEdit"', '"NotebookEdit"')

seen, denom, hits = set(), Counter(), []
for fp in FILES:
    proj = os.path.relpath(fp, ROOT).split(os.sep)[0]
    with open(fp, errors="replace") as f:
        for line in f:
            if '"tool_use"' not in line or not any(t in line for t in QUICK):
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            content = (obj.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for b in content:
                if not (isinstance(b, dict) and b.get("type") == "tool_use"
                        and b.get("name") in TOOLS):
                    continue
                if b.get("id") in seen:
                    continue
                seen.add(b.get("id"))
                p = (b.get("input") or {}).get("file_path") or \
                    (b.get("input") or {}).get("notebook_path") or ""
                if not p:
                    continue
                denom[b["name"]] += 1
                m = SEG.search(p)
                if m:
                    hits.append(((obj.get("timestamp") or "")[:10], proj,
                                 b["name"], m.group(2), p, bool(TMP.search(p))))

print(f"files={len(FILES)} denom={sum(denom.values())} {dict(denom)}")
real = [h for h in hits if not h[5]]
print(f"hits={len(hits)} real={len(real)}")
for h in hits:
    print(h)
```
