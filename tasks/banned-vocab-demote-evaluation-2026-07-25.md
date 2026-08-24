# banned-vocab deny-gate 降档评估 — 2026-07-25

结论:**不降档**。§10-V extended 枚举块压缩为指针(spec v6.21.2);deny 门、`hooks/banned-vocab.patterns`、hook 行为零改动。bypass-rate 议题移交下一次 §13.2 batch review。

## 数据(30d 窗口,2026-06-24 → 2026-07-25)

- 总 fires:31 = deny-family 15(deny-prose 12 + deny 3)+ bypass-escape-hatch 16。
- **bypass 率 51.6%(16/31)**,分布 8 个项目(daagu 5、sgc 3、gsd 2、loop-testing 2、其余各 1)——非单仓噪声,也非 2026-06-03 时代的 94% 自仓 dogfood 形态(本仓本窗口仅 2 事件)。
- 命中词分布(deny 侧):robust ×8、comprehensive ×6(含大小写变体)、significantly ×1 —— **15/15 全部是 core §10 quick-check 成员**;extended 长表零增量命中 → 压缩依据。
- 全局采样(`sampling-audit --global`,152 transcripts / 14136 turns):§10-V 外部层违规 44/13190 turns = 0.33%(检测器 uncalibrated,方向参考)。

## 为什么不降档

1. **官方口径无候选**:`hard-rules-audit.js` demoteCandidates = `["§8-curl-sh"]`,无 §10-V —— demote 判据是"hook-enforced 且窗口零命中",§10-V 有 31 hits 不满足。依 `feedback_demote_needs_data_not_intuition`:demote 只认工具输出,不认直觉。
2. **bypass 率是另一根轴**:§13.3 的 <10% bypass 门是**晋升**判据,不是既有 deny 的降档判据;spec 目前没有 demote-by-bypass-rate 规则。要新增判据 = §13 META 规则变更,属 batch review 职权,不塞进 patch。
3. **样本薄**:n=31,单月;15 次未 bypass 的 deny 可能确实改善了 prose(无反事实)。

## 移交事项(下一次 §13.2 batch review)

- [x] banned-vocab bypass-escape-hatch 16/31(51.6%)跨 8 项目 —— 评估:(a) 维持 deny;(b) deny→advisory;(c) 新增 demote-by-bypass-rate 判据后再裁。数据入口:`node scripts/audit.js` byHook.banned-vocab + 本文件。
- [x] §8-curl-sh 零命中 demote 候选:安全类规则命中稀疏属预期(攻击面本来罕见),建议 batch review 时按 confidence 而非裸命中数裁,或在 hard-rules-audit 加 safety-class 豁免标注。**不要**只因 0-hit 就拆 §8 门(参 `project_audit_2026-07-15_seams` do-NOT 列表)。

## 裁决 — 2026-08-24(收敛复核同批)

两项均**按 (a) 维持现状**,依据是当轮 `hard-rules-audit.js` 输出而非直觉
(`feedback_demote_needs_data_not_intuition`):

| 规则 | 30d hits | 与上次评估相比 |
|---|---|---|
| `§10-specificity`(banned-vocab) | total 20 = deny 14 + bypass 6 → **bypass 率 30%** | 51.6%(16/31) → **30%**,方向改善,样本 31 → 20 |
| `§8-curl-sh` | total 2 = deny 2 + bypass 0 | 零命中 → **有命中**,demote 候选自动消解 |

全局:`demoteCandidates=0`、`staleReviews=0`、`cadenceWarning=null`、`safetyClassExempt=0`,
logSpan 124d、`insufficientData=false`。官方口径无候选,两项的前提都不再成立。

不新增 demote-by-bypass-rate 判据(原选项 c),理由不止于「无候选」:新增判据是 §13 META 规则变更,
而 core 当前 23,322 / 25,000 字节(余量 6.7%),§0.1 要求净删配对。为一条当前无候选可裁的判据
动 spec 预算,是把 §0.1 的稀缺额度花在零收益上。若 bypass 率回升至 >50% 且持续两个窗口,
再按 §13.2 重开——那时它有候选,判据也就有了裁决对象。

## 同批执行的压缩(已 ship)

spec v6.21.2:§EXT §10-V 五行 `**Banned …**` 枚举外置 → `hooks/banned-vocab.patterns`(机械门,未动)+ `reference_banned_vocab_examples.md`(prose 查表);core §10 quick-check 未动,指针改指 patterns 文件;`banned-vocab-canonical.json` 同步(pattern 行翻 in_spec=false,10 条 spec-only/pattern-null 行退役,drift-1..7 全绿)。
