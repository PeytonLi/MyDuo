import Link from "next/link";

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="wordmark" href="/" aria-label="MyDuo home">
      <span className="wordmark-mark" aria-hidden="true">
        M<span>D</span>
      </span>
      {!compact && <span className="wordmark-name">MyDuo</span>}
    </Link>
  );
}
