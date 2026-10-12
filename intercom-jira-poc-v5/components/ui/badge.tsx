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
        general_inquiry: "border-slate-300 bg-slate-100 text-slate-700",
        billing_issue: "border-amber-300 bg-amber-100 text-amber-900",
        // Intercom status: open is deliberately neutral; needs follow-up gets its own color
        status_open: "border-slate-300 bg-card text-slate-700",
        status_closed: "border-transparent bg-slate-200 text-slate-600",
        status_snoozed: "border-indigo-200 bg-indigo-50 text-indigo-700",
        followup: "border-orange-300 bg-orange-100 text-orange-900",
        urgent: "border-transparent bg-destructive text-destructive-foreground",
        urgent_medium: "border-orange-300 bg-orange-50 text-orange-800",
        // Jira workflow status
        jira_new: "border-slate-300 bg-slate-100 text-slate-700",
        jira_progress: "border-sky-300 bg-sky-100 text-sky-900",
        jira_done: "border-emerald-300 bg-emerald-100 text-emerald-900",
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
