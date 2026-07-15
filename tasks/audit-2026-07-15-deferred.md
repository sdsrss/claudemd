# 2026-07-15 四维审计 — 发版后延后项

来源：0.49.1 审计 follow-up 发版（`4194a51`）时明确延后的三项。审计上下文见记忆
`project_audit_2026-07-15_seams`（重复接缝无单源/parity 门是共同根因）。

**状态更新 2026-07-15**：第 1、2 项已在 v0.50.0（`git tag v0.50.0`）发版完成；
仅第 3 项（共享 tokenizer 重构）仍延后，等单独决策。

## 1. ✅ 后台 install.js 升级失败的会话内 banner（arch HIGH）— shipped v0.50.0

- 现状：SessionStart 后台升级失败只留 `bootstrap.log` 痕迹，会话内无提示，用户以为已升级。
- 非阻断（有日志痕迹），但属静默失败面。
- 实现面：SessionStart hook 检测上次 bootstrap 失败标记 → additionalContext 单行 banner。
- 验收：模拟 install.js 失败 → 下一会话 banner 出现；成功路径无残留 banner。

## 2. ✅ marketplace 通道 tag 触发 CI gate（tests MEDIUM）— shipped v0.50.0

- 现状：CI 只护 push-to-main，tag/release 通道无 gate —— 双通道保护不对称，
  打 tag 发版可绕过测试红灯。
- 实现面：workflow `on: push: tags:` 加 test job（或现有 workflow 补 tag 触发）。
- 注意：CI 配置属 §5 hard-AUTH。
- 验收：打测试 tag → CI 跑测试；红灯 tag 不产 release 资产。

## 3. ✅ 共享 tokenizer 大重构（安全子集）— shipped v0.51.0

- 用户 2026-07-15 选定"只做安全单源 1-3"范围：抽 `s8_split_segments` +
  `s8_strip_wrappers` + `S8_WRAP_ARGLESS/FLAGGED` 数组，rm/npx 共用；curl-sh
  regex 保持字面 + parity 测试断言 ⊆ 共享集。**行为保持**，非 FN 方向变更。
- **刻意排除**：curl-sh sink 检测折进 tokenizer 模型（第 4 层）—— curl-sh 跨管道
  匹配而 segment 按管道切分，需重架整个门，正是审计警告的 Turing-tarpit
  （`project_audit_2026-07-15_seams`）。留作永久 non-goal。
- 证明：`tasks/s8-tokenizer/s8-diff-scan.sh` 差分 corpus（163 deny/120 allow 基线）
  0 verdict 变化；fresh-subagent 复核用 worktree 跑真·pre-refactor hook 差分 64 探针
  全同；hook 套件 365→366（+parity）；FN 对抗矩阵 12 例全 deny。
- 前置：§8 curl-sh parity（0.49.1 已收敛）是此方向的第一步。
