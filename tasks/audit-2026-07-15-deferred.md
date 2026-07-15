# 2026-07-15 四维审计 — 发版后延后项

来源：0.49.1 审计 follow-up 发版（`4194a51`）时明确延后的三项。审计上下文见记忆
`project_audit_2026-07-15_seams`（重复接缝无单源/parity 门是共同根因）。

## 1. 后台 install.js 升级失败的会话内 banner（arch HIGH）

- 现状：SessionStart 后台升级失败只留 `bootstrap.log` 痕迹，会话内无提示，用户以为已升级。
- 非阻断（有日志痕迹），但属静默失败面。
- 实现面：SessionStart hook 检测上次 bootstrap 失败标记 → additionalContext 单行 banner。
- 验收：模拟 install.js 失败 → 下一会话 banner 出现；成功路径无残留 banner。

## 2. marketplace 通道 tag 触发 CI gate（tests MEDIUM）

- 现状：CI 只护 push-to-main，tag/release 通道无 gate —— 双通道保护不对称，
  打 tag 发版可绕过测试红灯。
- 实现面：workflow `on: push: tags:` 加 test job（或现有 workflow 补 tag 触发）。
- 注意：CI 配置属 §5 hard-AUTH。
- 验收：打测试 tag → CI 跑测试；红灯 tag 不产 release 资产。

## 3. 共享 tokenizer 大重构（理想终态，需单独决策）

- hooks 侧建议的收敛终态：bash 预检测 sanitize/tokenize 逻辑归一到单一共享实现，
  消除"打地鼠式"逐 gate 补 parity。
- 风险/收益需单独决策，不在一个 turn 里做；动手前先列 FN 矩阵
  （`feedback_s8_false_negative_audit`）。
- 前置：§8 curl-sh parity（0.49.1 已收敛）是此方向的第一步，已完成。
