/**
 * Claude のチャットから予定・タスクを読み書きするための MCP サーバー(Vercel Function)。
 * Claude の「設定 → コネクタ → カスタムコネクタを追加」に https://<サイト>/api/mcp?key=<APP_TOKEN> を登録して使う。
 *
 * MCP は Claude が外のサービスを道具(ツール)として使うための決まりごと。ここでは Streamable HTTP という方式で、
 * 1回のリクエストごとにサーバーを作って答える(状態を持たない)。データは /api/data と同じ Vercel Blob に保存する。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import {
  addEvent,
  addTask,
  deleteEvent,
  deleteTask,
  listEvents,
  listTasks,
  todayInTokyo,
  updateEvent,
  updateTask,
  type ToolResult,
} from './_lib/calendarTools.js';
import type { CloudDoc } from './_lib/cloudDoc.js';
import {
  addTransaction,
  deleteProfile,
  deleteTransaction,
  listProfiles,
  listTransactions,
  moneySummary,
  setCard,
  setJob,
  updateTransaction,
} from './_lib/moneyTools.js';
import { readDoc, storageReady, tokenMatches, updateDoc } from './_lib/store.js';

const date = z.string().describe('日付 yyyy-MM-dd(日本時間)');
const time = z.string().describe('時刻 HH:mm(24時間表記、日本時間)');
const priority = z.enum(['high', 'normal', 'low']);
const method = z.enum(['cash', 'credit', 'emoney', 'bank']).describe('cash: 現金 / credit: クレジットカード / emoney: 電子マネー・QR決済 / bank: 口座振替・振込');
const day = z.number().int().min(1).max(31);

function text(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

/** 読むだけのツール */
async function read(run: (doc: CloudDoc) => ToolResult) {
  const { doc } = await readDoc();
  return text(run(doc).result);
}

/** 書き込むツール(同時に書き込まれたら最新を読み直してやり直す) */
async function write(run: (doc: CloudDoc) => ToolResult) {
  const { result } = await updateDoc((doc) => run(doc));
  return text(result);
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'new-calendar', version: '1.0.0' },
    {
      instructions: [
        'ユーザー個人のカレンダーアプリ(予定時刻ミス検知カレンダー)の予定とタスクを読み書きする。',
        `日付・時刻はすべて日本時間。今日は ${todayInTokyo()}。`,
        '予定(events)はカレンダーに入る時間の決まったもの。タスク(tasks)は締切と作業時間の見積もりがあるやること で、',
        'アプリの「今日のTodo」が空き時間に自動で割り振る。',
        '更新・削除の前には list_events / list_tasks で id を確かめる。消す前には何を消すかユーザーに確認する。',
        '家計簿: 支出・収入は transactions。金額は円の整数。クレカ利用はメールから取り込むときは source: gmail と',
        'source_id に Gmail のメッセージIDを入れる(同じ ID は自動で重複スキップ)。バイト代は、タイトルにバイト先の',
        'キーワードを含む予定(開始・終了時刻つき)から自動で計算される。money_summary で月のまとめを見られる。',
      ].join('\n'),
    },
  );

  server.registerTool(
    'list_events',
    {
      title: '予定を見る',
      description: '期間内の予定を一覧する。from/to を省略すると今日から2週間。query でタイトル・メモを絞り込める。',
      inputSchema: { from: date.optional(), to: date.optional(), query: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => read((doc) => listEvents(doc, args)),
  );

  server.registerTool(
    'add_event',
    {
      title: '予定を追加',
      description: '予定を1件追加する。start を省略するか all_day: true で終日の予定になる。日をまたぐ予定は end_date に終わる日を入れる。',
      inputSchema: {
        title: z.string(),
        date,
        start: time.optional(),
        end: time.optional(),
        end_date: date.optional().describe('日をまたぐ予定の終わる日(例: 17:00〜翌0:04 なら翌日の日付と end: 00:04)'),
        all_day: z.boolean().optional(),
        category: z.string().optional().describe('カテゴリ(例: 仕事 / 学校 / ライブ / その他)。省略時は「その他」'),
        note: z.string().optional(),
      },
    },
    async (args) => write((doc) => addEvent(doc, args)),
  );

  server.registerTool(
    'update_event',
    {
      title: '予定を変更',
      description: '予定の一部を変更する。変えない項目は省略する。',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        date: date.optional(),
        start: time.optional(),
        end: time.nullable().optional().describe('終了時刻。null で「終了時刻なし」'),
        end_date: date.nullable().optional().describe('終わる日。null で開始と同じ日に終わる'),
        category: z.string().optional(),
        note: z.string().nullable().optional(),
      },
    },
    async (args) => write((doc) => updateEvent(doc, args)),
  );

  server.registerTool(
    'delete_event',
    {
      title: '予定を削除',
      description: '予定を1件削除する。消す前にユーザーに確認すること。',
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    async (args) => write((doc) => deleteEvent(doc, args)),
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'タスクを見る',
      description: '締切のあるタスクを締切順に一覧する。include_done: true で完了済みも含める。',
      inputSchema: { include_done: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => read((doc) => listTasks(doc, args)),
  );

  server.registerTool(
    'add_task',
    {
      title: 'タスクを追加',
      description: '締切と見積もり作業時間のあるタスクを追加する。アプリが締切までの空き時間に自動で割り振る。',
      inputSchema: {
        title: z.string(),
        deadline: date,
        deadline_time: time.optional().describe('締切時刻。省略すると締切日の終わりまで'),
        estimated_minutes: z.number().describe('全体の作業時間の見積もり(分)'),
        priority: priority.optional(),
        note: z.string().optional(),
      },
    },
    async (args) => write((doc) => addTask(doc, args)),
  );

  server.registerTool(
    'update_task',
    {
      title: 'タスクを変更',
      description: 'タスクの一部を変更する。spent_minutes は終わった作業時間(分)、done: true で完了。',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        deadline: date.optional(),
        deadline_time: time.nullable().optional(),
        estimated_minutes: z.number().optional(),
        spent_minutes: z.number().optional(),
        priority: priority.optional(),
        note: z.string().nullable().optional(),
        done: z.boolean().optional(),
      },
    },
    async (args) => write((doc) => updateTask(doc, args)),
  );

  server.registerTool(
    'delete_task',
    {
      title: 'タスクを削除',
      description: 'タスクを1件削除する。消す前にユーザーに確認すること。',
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    async (args) => write((doc) => deleteTask(doc, args)),
  );

  server.registerTool(
    'list_transactions',
    {
      title: '家計簿を見る',
      description: '期間内の支出・収入の記録を一覧する。省略すると今月1日〜今日。',
      inputSchema: { from: date.optional(), to: date.optional(), method: method.optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => read((doc) => listTransactions(doc, args)),
  );

  server.registerTool(
    'add_transaction',
    {
      title: '支出・収入を記録',
      description: '家計簿に1件記録する。source_id が同じ記録がすでにあれば追加しない。',
      inputSchema: {
        date: date.describe('使った日(クレカは利用日)'),
        amount: z.number().describe('金額(円、正の数)'),
        kind: z.enum(['expense', 'income']).optional().describe('expense: 支出(省略時) / income: 収入・返金'),
        method,
        card: z.string().optional().describe('method: credit のときのカード名(list_money_settings の cards の name)'),
        category: z.string().optional().describe('食費 / 交通 / 日用品 / 趣味・娯楽 / 交際 / 服・美容 / 学び / 通信 / サブスク / その他'),
        memo: z.string().optional().describe('店名など'),
        source: z.enum(['manual', 'gmail', 'claude']).optional(),
        source_id: z.string().optional().describe('重複防止用の元データID(GmailのメッセージIDなど)'),
      },
    },
    async (args) => write((doc) => addTransaction(doc, args)),
  );

  server.registerTool(
    'update_transaction',
    {
      title: '家計簿の記録を変更',
      description: '記録の一部を変更する。変えない項目は省略する。',
      inputSchema: {
        id: z.string(),
        date: date.optional(),
        amount: z.number().optional(),
        kind: z.enum(['expense', 'income']).optional(),
        method: method.optional(),
        card: z.string().nullable().optional(),
        category: z.string().optional(),
        memo: z.string().nullable().optional(),
      },
    },
    async (args) => write((doc) => updateTransaction(doc, args)),
  );

  server.registerTool(
    'delete_transaction',
    {
      title: '家計簿の記録を削除',
      description: '記録を1件削除する。消す前にユーザーに確認すること。',
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    async (args) => write((doc) => deleteTransaction(doc, args)),
  );

  server.registerTool(
    'money_summary',
    {
      title: '月のお金のまとめ',
      description: 'その月に使った額(支払い方法別・カテゴリ別)、その月のカード引き落とし予定、バイト代の見込みと給料日を返す。',
      inputSchema: { month: z.string().optional().describe('yyyy-MM。省略すると今月') },
      annotations: { readOnlyHint: true },
    },
    async (args) => read((doc) => moneySummary(doc, args)),
  );

  server.registerTool(
    'list_money_settings',
    {
      title: 'バイト先・カードの設定を見る',
      description: '登録されているバイト先(時給など)とクレジットカード(締め日・引き落とし日)を返す。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => read((doc) => listProfiles(doc)),
  );

  server.registerTool(
    'set_job',
    {
      title: 'バイト先を設定',
      description: 'バイト先を名前で追加・上書きする。予定のタイトルに keyword を含むものがシフトとして計算される。',
      inputSchema: {
        name: z.string(),
        keyword: z.string().optional().describe('シフトの予定タイトルに含まれる言葉。省略すると name'),
        hourly_wage: z.number().optional().describe('時給(円)'),
        transport: z.number().optional().describe('1回の交通費(円)'),
        night_rate: z.number().optional().describe('22時〜5時の割増率。省略時 1.25'),
        closing_day: day.optional().describe('締め日。31 = 月末'),
        pay_day: day.optional().describe('給料日(締めの翌月)。31 = 月末'),
      },
    },
    async (args) => write((doc) => setJob(doc, args)),
  );

  server.registerTool(
    'set_card',
    {
      title: 'クレジットカードを設定',
      description: 'カードを名前で追加・上書きする。締め日と引き落とし日から、使った額がいつ引き落とされるかを計算する。',
      inputSchema: {
        name: z.string(),
        closing_day: day.optional().describe('締め日。31 = 月末'),
        payment_day: day.optional().describe('引き落とし日'),
        payment_month_offset: z.number().int().min(1).max(2).optional().describe('締めの翌月払い=1、翌々月払い=2'),
      },
    },
    async (args) => write((doc) => setCard(doc, args)),
  );

  server.registerTool(
    'delete_money_setting',
    {
      title: 'バイト先・カードの設定を削除',
      description: 'list_money_settings の id を指定して削除する。',
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    async (args) => write((doc) => deleteProfile(doc, args)),
  );

  return server;
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const header = request.headers.get('authorization') ?? '';
  const key = url.searchParams.get('key') ?? (header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!tokenMatches(key)) return new Response('unauthorized', { status: 401 });
  if (!storageReady()) return new Response('storage not configured', { status: 503 });

  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
