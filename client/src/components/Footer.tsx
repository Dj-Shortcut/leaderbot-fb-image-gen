export default function Footer() {
  return (
    <footer className="border-t border-slate-800/70 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 py-3 text-center text-xs text-slate-400">
      <a
        href="https://leaderbot.live/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="transition-colors hover:text-slate-200 hover:underline"
      >
        Privacy Policy
      </a>

      <span className="mx-2" aria-hidden="true">.</span>

      <a
        href="https://leaderbot.live/terms"
        className="transition-colors hover:text-slate-200 hover:underline"
      >
        Terms of Service
      </a>

      <span className="mx-2" aria-hidden="true">.</span>

      <a
        href="https://leaderbot.live/data-deletion"
        className="transition-colors hover:text-slate-200 hover:underline"
      >
        Data Deletion
      </a>
    </footer>
  );
}
