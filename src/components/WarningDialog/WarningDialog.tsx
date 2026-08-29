import type { Warning } from '../../lib/validation';
import './WarningDialog.css';

interface WarningDialogProps {
  warnings: Warning[];
  onApplyFix: (warning: Warning) => void;
  onConfirmAsIs: () => void;
  onCancel: () => void;
}

export function WarningDialog({ warnings, onApplyFix, onConfirmAsIs, onCancel }: WarningDialogProps) {
  if (warnings.length === 0) return null;

  return (
    <div className="warning-dialog-backdrop" role="presentation">
      <div className="warning-dialog" role="alertdialog" aria-modal="true" aria-labelledby="warning-dialog-title">
        <h3 id="warning-dialog-title">この予定、時刻は合っていますか？</h3>
        <ul className="warning-list">
          {warnings.map((warning, i) => (
            <li key={`${warning.rule}-${i}`} className="warning-item">
              <p>{warning.message}</p>
              {warning.suggestedValue && (
                <button type="button" className="warning-fix-button" onClick={() => onApplyFix(warning)}>
                  {warning.suggestedValue}に修正する
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="warning-dialog-actions">
          <button type="button" className="warning-confirm-button" onClick={onConfirmAsIs}>
            このままで合っています
          </button>
          <button type="button" className="warning-cancel-button" onClick={onCancel}>
            編集に戻る
          </button>
        </div>
      </div>
    </div>
  );
}
