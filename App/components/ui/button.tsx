import * as React from "react";
import { cn } from "@/lib/utils";

// Cursor-inspired button variants using warm-cream editorial palette.
// All colour values come from @theme — change tokens in index.css to re-skin.
// Primary action uses Cursor Orange (#f54e00) — the single brand voltage.
// No drop shadows; hairline borders only.

type Variant = "default" | "secondary" | "ghost" | "outline" | "destructive" | "link";
type Size = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  default: "bg-primary text-on-primary hover:bg-primary-active border border-primary",
  secondary: "bg-surface-card text-ink hover:bg-surface-canvas-soft border border-hairline-strong",
  ghost: "hover:bg-surface-canvas-soft hover:text-ink",
  outline: "border border-primary bg-transparent text-primary-text hover:bg-primary hover:text-on-primary",
  destructive: "bg-semantic-error text-white hover:bg-semantic-error/80 border border-semantic-error",
  link: "text-primary-text underline-offset-4 hover:underline",
};

const SIZES: Record<Size, string> = {
  default: "h-9 px-4 py-2",
  sm: "h-8 px-3 text-xs",
  lg: "h-10 px-6",
  icon: "h-9 w-9",
};

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap " +
  "rounded-sm text-sm font-medium transition-all duration-150 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
  "disabled:pointer-events-none disabled:opacity-50 cursor-pointer " +
  "active:scale-97";

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, children, ...props }, ref) => {
    const classes = cn(BASE, VARIANTS[variant], SIZES[size], className);

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ className?: string }>;
      return React.cloneElement(child, {
        className: cn(classes, child.props.className),
      });
    }

    return (
      <button ref={ref} className={classes} {...props}>
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
