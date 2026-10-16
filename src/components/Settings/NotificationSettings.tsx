import { useEffect, useState } from 'react';
import { currentSubscription, disablePush, enablePush, pushSupport, sendTestPush } from '../../lib/push';

/** 通知の設定(毎晩21時に明日の予定、日曜21時に来週の予定) */
export function NotificationSettings({ token }: { token: string }) {
  const support = pushSupport();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void currentSubscription().then((s) => setOn(Boolean(s)));
  }, []);

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(done);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '通知の設定に失敗しました。');
    } finally {
      setBusy(false);
      setOn(Boolean(await currentSubscription()));
    }
  };

  return (
    <fieldset>
      <legend>通知</legend>
      <p className="todo-hint">毎晩21時ごろに「明日の予定」、日曜の21時ごろに「来週の予定」をこのスマホに通知します。</p>
      {!token ? (
        <p className="todo-hint">先に上の「合言葉」を入れて保存してください(通知はネット保存のデータから送ります)。</p>
      ) : support === 'needs-home-screen' ? (
        <p className="todo-hint">
          iPhoneでは、Safariの共有ボタン(□↑)→「ホーム画面に追加」をして、ホーム画面のアイコンから開いたときだけ通知をオンにできます。
        </p>
      ) : support === 'unsupported' ? (
        <p className="todo-hint">このブラウザは通知に対応していません。</p>
      ) : (
        <div className="todo-dialog-actions">
          {on ? (
            <>
              <button type="button" className="todo-secondary" disabled={busy} onClick={() => void run(() => sendTestPush(token), '試しに「明日の予定」を送りました。')}>
                試しに送る
              </button>
              <button type="button" className="todo-secondary" disabled={busy} onClick={() => void run(() => disablePush(token), '通知をオフにしました。')}>
                通知をオフ
              </button>
            </>
          ) : (
            <button type="button" disabled={busy || on === null} onClick={() => void run(() => enablePush(token), '通知をオンにしました。')}>
              通知をオンにする
            </button>
          )}
        </div>
      )}
      {message && <p className="todo-hint">{message}</p>}
    </fieldset>
  );
}
