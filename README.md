# 予定時刻ミス検知カレンダー

保存するだけの普通のカレンダーと違い、**保存時に時刻の妥当性を検証する**カレンダーアプリ。
「20:00 のつもりが 2:00 と入力されていた」といった入力ミスや、典型的な時間帯・所要時間から
外れた予定を検知し、保存をブロックせずに黄色い警告で知らせる。詳細は
`CALENDAR_VALIDATION_SPEC_2.md`（実装指示書）を参照。

## スタック

- React 19 + TypeScript + Vite
- Supabase（DB・認証・ストレージ）
- date-fns（日付計算）
- Vitest（バリデーションロジックの単体テスト）

## セットアップ

1. 依存関係のインストール

   ```sh
   npm install
   ```

2. Supabase プロジェクトを作成し、`supabase/migrations/0001_init.sql` を実行する
   （Supabase Dashboard の SQL Editor に貼り付けて実行するか、Supabase CLI の
   `supabase db push` を利用）。`events` / `categories` テーブルと `event-images`
   ストレージバケット、RLS ポリシーが作成される。

3. `.env.example` を `.env.local` にコピーし、Supabase の URL と anon key を設定する

   ```sh
   cp .env.example .env.local
   ```

4. 開発サーバーを起動

   ```sh
   npm run dev
   ```

## スクリプト

- `npm run dev` — 開発サーバー
- `npm run build` — 型チェック + 本番ビルド
- `npm run test` — バリデーションロジックの単体テスト（Vitest）
- `npm run lint` — Oxlint

## バリデーションロジック

`src/lib/validation/` にUIから完全に独立した純粋関数として実装している。

```ts
validateEvent(event: EventInput, userHistory: EventInput[], now?: Date): Warning[]
```

- R1 桁落ち検知（`2:00` → `20:00` の打ち間違い提案）
- R2 深夜帯フラグ（0:00〜4:59）
- R3 カテゴリ別の典型時間帯チェック（過去5件以上の実績があれば10〜90パーセンタイルで算出、なければデフォルト値）
- R4 所要時間の妥当性（標準所要時間の0.5〜3倍から外れる場合）
- R5 根拠なしフラグ（`hasNoEvidence()` — ダイアログは出さず、一覧のフィルタでのみ使用）
- R6 遠い未来（60日以上先）の予定は R1/R3/R4 の閾値を厳しめにし、添付を促すリマインダーを追加

保存はブロックせず、警告は「〇〇に修正する」／「このままで合っています」で解消し、
`events.warnings` に履歴として記録する。一度「合っています」を選ぶと `time_confirmed`
が立ち、時刻を変更しない限り同じ警告は再表示されない。

`memory_checked_at` / `miss_count` カラムは、将来の記憶テスト機能のために予約されている
（今回は未使用）。
