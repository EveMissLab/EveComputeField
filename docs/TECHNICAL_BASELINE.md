# 虛擬計算場（Virtual Compute Field）——初版技術基線 v0.1

- 日期：2026-10-30（Asia/Taipei）
- 定位：本地優先、區域網路優先、跨節點擴展、計算場持續身份
- 階段：Reference Prototype / 公開前技術基線
- 最重要原則：**語義契約長期穩定；實作技術可逐步替換。**

## 1. 研究意圖與技術邊界

使用者可宣告多個不同的「場」（Field），每個場具有：

1. 穩定 Field ID 與版本化生命週期；
2. 可配置數量的虛擬邏輯單元，以及隨運行階段改變的能力；
3. 可宣告的記憶體域與持久化策略；
4. 可替換的運行策略（依賴圖、排程、計算方法）；
5. 可在不同本地節點或未來雲端節點之間分配工作；
6. 可觀察、可測試、可重播、可驗證的計算狀態。

場不等於 VM、容器、Go goroutine、物理核心、或單一程序。本版本尚未建立可以執行任意第三方程式的通用執行環境。

### 語義必須區分

| 名稱 | 意義 | v0.1 狀態 |
|---|---|---|
| Field identity | 跨多次執行可保持同一計算場身份 | Field ID + state file |
| Virtual logical unit | 場內可辨識的邏輯槽位或運算身份 | 穩定 UnitID；尚未為每個單元配置執行緒 |
| Physical execution slot | CPU/GPU 實際可用的資源 | 交由 Go／OS；未控制硬體排程 |
| Memory domain | 有名稱、有配額及存續策略的邏輯存取域 | 以字串 KV 示範；非 mmap／NUMA／共享物理地址 |
| Field epoch | 一次成功計算提交後的連續態序號 | 已實作 |
| DAG barrier | 一層依賴完整完成後才提交結果 | 已實作 |
| Continuous runtime | 停用／重啟後保留身份與重要狀態 | Snapshot-based continuity，**不是永遠在執行** |
| Cross-node field | 本地權威調度遠端工作 | mTLS stateless worker demo |
| Cloud persistence | 本地中斷後雲端繼續保存／執行 | 未實作 |
| Pulse differential | 單核／多核極致計算差分 | 僅保留觀測與後端替換的研究入口 |

## 2. 時序性與權威

計算場的語義權威由本地控制節點承擔。每個場的初始規格被驗證後產生 spec digest。運行流程：

1. `Spec.Validate()`：身份、容量、依賴與可執行操作的基本驗證。
2. `Spec.Layers()`：決定無循環且可重現的依賴層序列。
3. 每層工作交給有限數量後端執行；不同任務可以完成於不同時間。
4. 全層成功後才在本地結果表提交，並開啟下一層。
5. 全部任務成功後 Field epoch 加一；任何錯誤均不提交本次結果／epoch。
6. 使用者指定 `-state` 才寫入新快照；狀態檔案未加密、並非分散式共識日誌。

因此 `field/v0.1` 的重播性是**相同純計算輸入下的結果與依賴關係**，不保證每次物理完成時間完全一樣，也不宣稱跨語言 byte-for-byte 雜湊一致性。

## 3. 可替換技術矩陣

| 功能 | 初版基線 | 後續適配方向 | 替換 Gate |
|---|---|---|---|
| Runtime | Go + stdlib | 原生語言／NOVA 等 | 完整語義相容、效能比對 |
| Logical unit | Field ID + UnitID + bounded worker pool | EML-SF、結構性邏輯單元 | 單元身份、失效恢復、擴縮語義 |
| Dependency | 有向無環圖、分層提交 | ODTS、因果流與動態有序提交 | 保證依賴不被前瞻執行破壞 |
| Memory | Volatile KV + Snapshot KV | MACR、mmap/out-of-core、映射域 | 配額、快照、一致性、失效處置 |
| Compute graph | JSON DAG | NOVA 原生 typed structural graph | typed validation、effects、semantic hash 對照 |
| Math/algorithm | `sum` / `mul` | GMA、TCGCT／TCGQT、其他演算法 | 明確 domain、誤差與數值證書 |
| Network | TLS 1.3 mTLS HTTPS | 可替換傳輸、雲端節點 | 認證、授權、節點隔離、重試 |
| Scheduling | bounded layer-parallel | 相位、全域激發、邏輯差分排程 | 對照基線、成本／收益量測 |
| Output | JSON reference report | HDSRC/PNCW 原生投影等 | 非文字輸出語義與可驗證映射 |
| OS | 一般使用者空間執行 | Linux sched_ext、其他 OS hooks | Kernel 能力檢查、回退、安全測試 |

這些是**對接候選**而非已完成的依賴。保留每個原生專案的獨立權威及語義；不可將它們偷換為現成的「同一套 Runtime」。

## 4. 跨節點／雲端責任

本地節點持有 Field Spec、權威狀態與工作配置。遠端節點僅執行已授權任務並傳回結果。

跨節點時必須考慮：

- 不把「虛擬單元數量」誤報成增加的實體算力；
- 不把遠端記憶體當成沒有延遲的本地 RAM；
- 不依賴外部雲端擁有無條件永久執行權；
- 任務允許重試的前提是**純函數／冪等副作用契約**；
- 遠端資源撤回、網路分割、逾時、狀態落後都要有明確失敗或降級路徑；
- 雲端需要獨立的費用上限、授權與關閉機制。

未來的多節點共用狀態需要選擇 consistency model（強一致、最終一致或應用明確的因果一致），不允許把 JSON 快照當作跨節點共識。

## 5. 區塊邏輯差分與脈衝研究（未來方向）

長期要研究的是，在相同物理預算下，哪些計算必須執行、可略過、可重用、可合併或重新排序。建議日後保留以下可比較證據：

- 定量輸入、規則、依賴與版本；
- wall-clock、CPU time、記憶體高水位、網路傳輸位元組；
- 完成任務數、失敗率、重試次數、能耗（硬體可取得時）；
- cache / branch / IPC 等硬體效能計數器（視平台與權限）；
- 同等輸入的 baseline、差分策略、AI 推薦策略三組比較；
- 反例、精度差異、最佳化成本與可回退性。

「脈衝」在此是未定義的研究操作單位，不先當成硬體時脈。任何單核／多核速度或效率改善，須透過真實硬體測試，並處理排程噪聲、cache 暖機、頻率調整與工作負載差異。

## 6. 非目標（避免開源第一版誤導）

- 不是通用虛擬機、Docker 替代品或透明遠端 RAM；
- 不是能直接運行任意應用的沙盒（需另建安全隔離工作負載後端）；
- 不是已經落實原生 NOVA／EML-SF／TCGCT 執行；
- 不是「360／720 個虛擬單元等於 360／720 核心」；
- 不是硬體時鐘週期層級的脈衝控制器；
- 不是具備持久雲端運算的正式產品。

## 7. 架構決策與變更規範

1. 每個替換後端都需獨立標記版本、測試與可回滾；
2. 任何新的資料／計算權威不得暗中覆寫本地場的 Epoch；
3. 守住「計算圖／效果／記憶體／排程」等語義分離；
4. 未驗證一律標記 `UNPROVEN` 或 `NOT_RUN`；
5. 先 tests → reference implementation → fresh replay → audit 再提交；
6. 開源公開不必同時公開私人研究核心；以公共合約及獨立 Adapter 接口銜接。
