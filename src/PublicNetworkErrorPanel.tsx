/** Shared network-failure UX for public receive/pickup routes. */
export function PublicNetworkErrorPanel({
  message,
  onRetry,
  testId = "public-network-error",
}: {
  message: string;
  onRetry: () => void;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center"
      data-testid={testId}
    >
      <p className="text-accent-red font-semibold mb-2">{message}</p>
      <p className="text-sm text-text-secondary mb-6">
        Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="action-btn action-btn-secondary"
        data-testid="public-network-retry"
      >
        Try again
      </button>
    </div>
  );
}
