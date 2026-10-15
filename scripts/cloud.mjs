#!/usr/bin/env node
/**
 * ネット保存(/api/data)を手元から読み書きするための小さな道具。Claude が予定やタスクを入れるときに使う。
 *
 *   CLOUD_TOKEN=... node scripts/cloud.mjs get                 # 全データを表示
 *   CLOUD_TOKEN=... node scripts/cloud.mjs post ops.json       # ops.json の変更を適用
 *
 * CLOUD_URL を省略すると https://new-calendar-tau.vercel.app/api/data を使う。
 */
import { readFileSync } from 'node:fs';

const url = process.env.CLOUD_URL ?? 'https://new-calendar-tau.vercel.app/api/data';
const token = process.env.CLOUD_TOKEN;
if (!token) {
  console.error('CLOUD_TOKEN(合言葉)を指定してください');
  process.exit(1);
}
const [cmd, file] = process.argv.slice(2);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
let res;
if (cmd === 'get') res = await fetch(url, { headers });
else if (cmd === 'post' && file) res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ops: JSON.parse(readFileSync(file, 'utf8')) }) });
else {
  console.error('使い方: node scripts/cloud.mjs get | post <ops.json>');
  process.exit(1);
}
const body = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${body}`);
  process.exit(1);
}
console.log(body);
