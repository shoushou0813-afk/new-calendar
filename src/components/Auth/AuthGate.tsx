import { type FormEvent, type ReactNode, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import './AuthGate.css';

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, signInWithPassword, signUpWithPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return <div className="auth-loading">読み込み中...</div>;
  }

  if (user) {
    return <>{children}</>;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: authError } =
      mode === 'signIn' ? await signInWithPassword(email, password) : await signUpWithPassword(email, password);
    setSubmitting(false);
    if (authError) setError(authError.message);
  };

  return (
    <div className="auth-gate">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>予定時刻ミス検知カレンダー</h1>
        <p className="auth-subtitle">保存した予定の時刻がおかしくないか、自動でチェックします。</p>
        <label>
          メールアドレス
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          パスワード
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {mode === 'signIn' ? 'ログイン' : '新規登録'}
        </button>
        <button type="button" className="auth-switch" onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
          {mode === 'signIn' ? 'アカウントを作成する' : 'ログインに戻る'}
        </button>
      </form>
    </div>
  );
}
