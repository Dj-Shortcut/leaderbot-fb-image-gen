export default function Footer() {
  return (
    <footer className="text-center text-xs text-gray-500 py-3">
      <a
        href="https://leaderbot.live/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
      >
        Privacy Policy
      </a>

      <span className="mx-2">·</span>

      <a
        href="https://leaderbot.live/terms"
        className="hover:underline"
      >
        Terms of Service
      </a>

      <span className="mx-2">·</span>

      <a
        href="https://leaderbot.live/data-deletion"
        className="hover:underline"
      >
        Data Deletion
      </a>
    </footer>
  );
}