/**
 * 「1タップ取り込みリンク」: .ics の中身を URL の # 以降に入れて渡す。
 * # 以降(フラグメント)はブラウザからサーバーに送られないので、予定の内容がサーバーに残らない。
 *
 * 形式: #import=x.<hex(deflate-raw(ics))>         (圧縮あり・英数字のみ。既定)
 *       #import=z.<base64url(deflate-raw(ics))>   (圧縮あり)
 *       #import=b.<base64url(ics)>                (圧縮なし)
 *
 * 既定を 16進(英数字のみ)にしているのは、チャットのMarkdown表示で base64url の "_" が
 * 斜体記号として解釈され、リンクが途中で壊れることがあるため。
 */

const PREFIX = '#import=';

function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) throw new Error('取り込みリンクが途中で切れているようです。');
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function inflateRaw(bytes: Uint8Array): Promise<string> {
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

async function deflateRaw(text: string): Promise<Uint8Array> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** URL の # から .ics テキストを取り出す。取り込みリンクでなければ null。 */
export async function readImportLink(hash: string): Promise<string | null> {
  if (!hash.startsWith(PREFIX)) return null;
  const payload = hash.slice(PREFIX.length);
  const [kind, data] = [payload.slice(0, 1), payload.slice(2)];
  if (payload[1] !== '.' || !data) throw new Error('取り込みリンクの形式が正しくありません。');
  try {
    if (kind === 'x') return await inflateRaw(hexToBytes(data));
    if (kind === 'z') return await inflateRaw(base64UrlToBytes(data));
    if (kind === 'b') return new TextDecoder().decode(base64UrlToBytes(data));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('取り込みリンク')) throw err;
    throw new Error('取り込みリンクが途中で切れているか、壊れています。');
  }
  throw new Error('取り込みリンクの形式が正しくありません。');
}

export async function createImportLink(baseUrl: string, icsText: string): Promise<string> {
  return `${baseUrl}${PREFIX}x.${bytesToHex(await deflateRaw(icsText))}`;
}

/** 貼り付けられた文字列(リンク全体でも # 以降だけでも可)から .ics テキストを取り出す。 */
export async function readPastedImportLink(pasted: string): Promise<string | null> {
  const compact = pasted.replace(/\s+/g, '');
  const idx = compact.indexOf(PREFIX);
  if (idx >= 0) return readImportLink(compact.slice(idx));
  if (compact.startsWith('import=')) return readImportLink(`#${compact}`);
  return null;
}

/** 取り込み後にアドレスバーから # 以降を消す(リロードで二重に取り込まないように)。 */
export function clearImportLink(): void {
  history.replaceState(null, '', location.pathname + location.search);
}
