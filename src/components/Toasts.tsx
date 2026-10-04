import { notifier } from '../lib/notify';
import { useObservable } from '../lib/observable';

export function Toasts() {
  useObservable(notifier);
  return (
    <div className="toasts" aria-live="polite">
      {notifier.toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.severity}`}
          onClick={() => {
            if (t.href) location.hash = t.href;
            notifier.dismiss(t.id);
          }}
        >
          <b>{t.title}</b>
          <span>{t.body}</span>
        </div>
      ))}
    </div>
  );
}
