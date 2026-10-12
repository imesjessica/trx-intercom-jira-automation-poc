import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold leading-5 transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        outline: "text-foreground",
        muted: "border-transparent bg-muted font-medium text-muted-foreground",
        // Tag-specific variants so a tag name can be passed straight in
        product_bug: "border-destructive/30 bg-destructive-soft text-destructive",
        product_feedback: "border-success/30 bg-success-soft text-success",
        jira: "border-primary/25 bg-primary/10 text-primary",
        status_open: "border-amber-300 bg-amber-50 text-amber-800",
        status_closed: "border-slate-300 bg-slate-100 text-slate-700",
        status_snoozed: "border-indigo-200 bg-indigo-50 text-indigo-700",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
