import { Link } from "@tanstack/react-router";
import { playLogoSfx } from "@/lib/cart-fx";
import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-9 shrink-0", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="#E25A32" />
      <path
        d="M5 11.5h6M3.5 16h5.5M6 20.5h5"
        stroke="#EFE4D0"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.72"
      />
      <path
        d="M17.2 7.2h4.2v2.2l1.6 2.1v11.4a2.6 2.6 0 0 1-2.6 2.6h-2.2a2.6 2.6 0 0 1-2.6-2.6V11.5l1.6-2.1V7.2z"
        fill="#EFE4D0"
      />
      <rect x="18.3" y="5.1" width="2.1" height="2.3" rx="0.55" fill="#2F6D56" />
    </svg>
  );
}

export function Logo({
  inverted,
  to = "/",
}: {
  inverted?: boolean;
  to?: string;
}) {
  return (
    <Link to={to} onClick={playLogoSfx} className="flex items-center gap-2.5 min-h-11">
      <Mark />
      <span className="leading-none">
        <span
          className={cn(
            "block font-display text-[1.12rem] font-semibold tracking-tight",
            inverted ? "text-paper" : "text-ink",
          )}
        >
          Botella{" "}
          <span className={inverted ? "text-paper/75" : "text-ember"}>Rápida</span>
        </span>
        <span
          className={cn(
            "mt-1 block text-[0.62rem] font-semibold uppercase tracking-[0.18em]",
            inverted ? "text-ember" : "text-bottle",
          )}
        >
          Express España
        </span>
      </span>
    </Link>
  );
}
