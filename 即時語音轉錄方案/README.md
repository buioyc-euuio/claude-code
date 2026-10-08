# 即時語音轉錄方案 — MVP-1

英文演講 / Google Meet / YouTube 的**即時英文字幕 + 繁體中文翻譯**。
網頁版（PWA），手機和筆電都能用，部署在 Vercel。

```
音訊來源 ──► PCM16 16kHz ──► 雲端 STT（WebSocket 直連）──► 字幕事件 ──► Claude 翻譯 ──► 顯示
麥克風 / 分頁       AudioWorklet      Deepgram / AssemblyAI      partial/final      /api/translate     App 內 / 浮動視窗
```

## 功能

| 項目 | 內容 |
|---|---|
| 輸入 | 麥克風（手機、筆電）；Chrome 分頁音訊（Meet、YouTube，筆電限定） |
| 辨識 | Deepgram Nova-3（預設，可設定專有名詞）、AssemblyAI Universal-Streaming |
| 翻譯 | 每句結束後送 Claude，附前 3 句當上下文，串流顯示 |
| 顯示 | App 內中英對照；Chrome 的 Document Picture-in-Picture 浮動字幕視窗 |
| 其他 | 匯出 Markdown 逐字稿、螢幕常亮（Wake Lock）、通關碼保護 API |

## 本機開發

```bash
cd 即時語音轉錄方案
npm install
cp .env.example .env.local   # 填入 API key
npm run dev                  # http://localhost:3000
npm test                     # 單元測試（需要 bun）
npm run typecheck
```

> 麥克風和分頁擷取需要安全環境：`localhost` 可以，區網 IP 不行（手機測試請用部署後的 https 網址）。

## 部署到 Vercel

1. 在 Vercel 匯入這個 GitHub repo。
2. **Root Directory** 設成 `即時語音轉錄方案`。Framework 會自動偵測為 Next.js。
3. 在 Environment Variables 填入 `.env.example` 裡的變數，**一定要設 `APP_PASSCODE`**。
4. 部署完成後，打開網址 →「設定」→ 輸入通關碼。
5. 手機：用瀏覽器打開後「加入主畫面」，就像 App 一樣使用。

### 需要的 API key

| 變數 | 取得方式 | 備註 |
|---|---|---|
| `DEEPGRAM_API_KEY` | Deepgram Console → API Keys | 權限至少要 **Member**，才能呼叫 `/v1/auth/grant` 發短效 token |
| `ASSEMBLYAI_API_KEY` | AssemblyAI Dashboard | 選填，想比較兩家時再設 |
| `ANTHROPIC_API_KEY` | Claude Console | 翻譯用 |
| `TRANSLATE_MODEL` | 選填 | 預設 `claude-opus-5-5`（effort 設 low）。想更快更便宜可改 `claude-haiku-5-5` |

## 使用方式

**實驗室 seminar（推薦）**：筆電用 Chrome 加入 Meet → 打開本頁 → 來源選「分頁 / 系統音訊」→ 開始 → 選 Meet 那個分頁並勾選「同時分享分頁音訊」→ 按「浮動字幕」，把小視窗拖到 Meet 上面。

**現場演講 / 手機**：來源選「麥克風」→ 開始。

**提高專有名詞準確度**：「設定」→ 專有名詞填入 `seq2seq, ground truth, KU Leuven` 之類的詞（僅 Deepgram）。

## 架構與檔案

```
app/
  page.tsx                 進入點
  api/stt-token/route.ts   發 60 秒的 STT 短效 token（API key 不出伺服器）
  api/translate/route.ts   Claude 翻譯，純文字串流回傳
components/
  Transcriber.tsx          主畫面：開始/停止、狀態、設定
  Captions.tsx             字幕列表（App 內與浮動視窗共用）
  PipPortal.tsx            Document Picture-in-Picture 浮動視窗
lib/
  audio/pcm.ts             降頻、float→PCM16、切 100ms chunk（純函式）
  audio/capture.ts         getUserMedia / getDisplayMedia + AudioWorklet
  engines/types.ts         Engine 介面與 TranscriptEvent（之後的 MVP 共用）
  engines/ws-engine.ts     「瀏覽器直連 WebSocket」的共用實作
  engines/deepgram.ts      Deepgram URL 與訊息解析
  engines/assemblyai.ts    AssemblyAI URL 與訊息解析
  transcript.ts            字幕狀態：partial / final / 收尾 / 強制斷行
  client.ts                呼叫自家 API
  settings.ts              設定（存在 localStorage）
public/pcm-worklet.js      AudioWorklet，把樣本攢成區塊送回主執行緒
```

### 為什麼音訊不經過 Vercel

Vercel 的 serverless function 不能長時間維持 WebSocket。所以瀏覽器先向 `/api/stt-token` 拿短效 token，再**直接**連到 Deepgram / AssemblyAI。這樣少了一跳，延遲也更低。

### 新增一個引擎（MVP-2 以後）

實作 `lib/engines/types.ts` 的 `Engine` 介面，在 `lib/client.ts` 的 `createEngine` 加一個 case。
自家伺服器（實驗室 GPU、桌面本地）建議直接回傳 `TranscriptEvent` JSON，就不需要寫 parser。

## 已知限制與疑難排解

- **只能用 webpack 建置**：Next.js 16 的 Turbopack 遇到中文資料夾路徑會崩潰，所以 `dev` / `build` 都加了 `--webpack`。
- **手機不能擷取分頁音訊**：手機瀏覽器不支援 `getDisplayMedia`，只能用麥克風。
- **浮動字幕**只支援桌面版 Chrome / Edge 116 以上，而且不能透明（透明 overlay 是 MVP-3 桌面 App 的範圍）。
- **Deepgram 連線被拒（1006 / 401）**：確認 API key 權限是 Member 以上。瀏覽器是用 WebSocket subprotocol `['bearer', <JWT>]` 傳 token。
- **AssemblyAI** 目前只做英文；語言選項只對 Deepgram 有效。
