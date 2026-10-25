import type { KeyboardEvent } from "react";

interface VendorRunSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}

export function VendorRunSearchField({
  value,
  onChange,
  id = "vendor-run-search-input",
}: VendorRunSearchFieldProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  return (
    <div className="vendor-run-search relative">
      <label htmlFor={id} className="sr-only">
        Search deliveries by invoice, PO, or job name
      </label>
      <input
        id={id}
        data-testid="vendor-run-search"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Invoice, PO, or job name"
        className="vendor-run-search-input tap-target min-h-12 w-full rounded-xl border border-white/15 bg-bg-secondary py-3 pl-4 pr-12 text-base text-text-primary placeholder:text-[#94a3b8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6ee7b7]"
        style={{ fontSize: 16 }}
      />
      {value.length > 0 && (
        <button
          type="button"
          className="vendor-run-search-clear absolute right-1 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-lg text-[#cbd5e1] transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6ee7b7]"
          aria-label="Clear search"
          data-testid="vendor-run-search-clear"
          onClick={() => onChange("")}
        >
          <svg
            className="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
