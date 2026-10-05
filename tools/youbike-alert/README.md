# YouBike 站點提醒（陽明交大三站）

每天台北時間 **17:00–18:20**，每 5 分鐘檢查：

- 陽明交通大學(大學路)
- 陽明交通大學(研三舍)
- 陽明交通大學(逐風廣場)（女二舍前）

當 **三站合計可借 < 10 台**，或 **逐風廣場 < 7 台** 時推播，內容列出每站「一般 / 電輔」車數。

## 設定

1. 手機安裝 [ntfy](https://ntfy.sh) App，訂閱一個不好猜的 topic（例如 `yb-nycu-xxxxxx`）。
2. Repo → Settings → Secrets and variables → Actions → 新增 secret `NTFY_TOPIC` = 上面的 topic。
   （或改用 Telegram：`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`）
3. 把 `.github/workflows/youbike-alert.yml` 合併進 default branch（排程只在 default branch 觸發）。
   如果 repo 是 fork，需到 Actions 分頁手動啟用 workflows。
4. Actions → YouBike Alert → Run workflow（force 打勾）測試推播。

## 本機測試

```bash
FORCE=true node tools/youbike-alert/check.mjs
```

可調環境變數：`TOTAL_THRESHOLD`（預設 10）、`SINGLE_THRESHOLD`（預設 7）、`WINDOW_START` / `WINDOW_END`。
