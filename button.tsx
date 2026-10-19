import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-150 ease-out disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-ember text-surface shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_8px_20px_-10px_rgba(217,74,40,0.7)] hover:bg-ember-dark active:scale-[0.98]",
        ink: "bg-ink text-surface hover:bg-ink/90 active:scale-[0.98]",
        bottle: "bg-bottle text-surface hover:brightness-110 active:scale-[0.98]",
        outline:
          "bg-transparent text-ink shadow-[0_0_0_1px_rgba(28,23,18,0.18)] hover:bg-ink hover:text-paper",
        line: "bg-transparent text-paper shadow-[0_0_0_1px_rgba(239,228,208,0.38)] hover:bg-paper hover:text-ink",
        ghost: "bg-ink/6 text-ink hover:bg-ink/10",
        surface: "bg-surface text-ink shadow-card hover:shadow-lift",
      },
      size: {
        sm: "h-9 rounded-full px-3.5 text-sm",
        md: "h-11 rounded-full px-5 text-[0.95rem]",
        lg: "h-12 rounded-full px-6 text-base",
        icon: "size-11 rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
