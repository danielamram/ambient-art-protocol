import type { Notice } from '../hooks/use-notices.js';

/**
 * A polite live region that is always mounted, so screen readers announce new notices.
 * Actionable failures use role="alert" elsewhere; nothing here repeats continuously.
 */
export function NoticeRegion({ notice, onDismiss }: { notice: Notice | null; onDismiss(): void }) {
  return (
    <div className="notice-region" role="status" aria-live="polite">
      {notice && (
        <div className="notice" key={notice.id}>
          <span>{notice.text}</span>
          {notice.action && (
            <button type="button" className="notice-action" onClick={notice.action.run}>
              {notice.action.label}
            </button>
          )}
          <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
