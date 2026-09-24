import { useId } from 'react';

/** Optional word for the Bluesky feed. Posts that contain it pulse strongly; the rest stay quiet. */
export function WatchedWord({ value, onChange }: { value: string; onChange(word: string): void }) {
  const hint = useId();
  return (
    <label className="select-label">
      Watch a word (optional)
      <input
        type="text"
        value={value}
        maxLength={40}
        placeholder="rain"
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hint}
        onChange={(e) => onChange(e.target.value)}
      />
      <span id={hint} className="fine-print">
        {value.trim()
          ? `Only posts saying “${value.trim()}” pulse. Everything else still moves the mood.`
          : 'Leave empty to see every post.'}
      </span>
    </label>
  );
}
