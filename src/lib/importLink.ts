/**
 * 「1タップ取り込みリンク」: .ics の中身を URL の # 以降に入れて渡す。
 * # 以降(フラグメント)はブラウザからサーバーに送られないので、予定の内容がサーバーに残らない。
 *
 * 形式: #import=z.<base64url(deflate-raw(ics))>   (圧縮あり)
 *       #import=b.<base64url(ics)>                (圧縮なし)
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

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
  const bytes = base64UrlToBytes(data);
  if (kind === 'z') return inflateRaw(bytes);
  if (kind === 'b') return new TextDecoder().decode(bytes);
  throw new Error('取り込みリンクの形式が正しくありません。');
}

export async function createImportLink(baseUrl: string, icsText: string): Promise<string> {
  return `${baseUrl}${PREFIX}z.${bytesToBase64Url(await deflateRaw(icsText))}`;
}

/** 取り込み後にアドレスバーから # 以降を消す(リロードで二重に取り込まないように)。 */
export function clearImportLink(): void {
  history.replaceState(null, '', location.pathname + location.search);
}
