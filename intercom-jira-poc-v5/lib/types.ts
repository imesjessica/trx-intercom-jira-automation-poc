// Internal ids keep their original names so existing Intercom tags keep working.
// What people see are the labels in TAG_INFO.
export type Tag = "product_bug" | "product_feedback" | "general_inquiry" | "billing_issue";

export const TAGS: Tag[] = ["product_bug", "product_feedback", "general_inquiry", "billing_issue"];

export const TAG_INFO: Record<Tag, { label: string; short: string; escalate: boolean }> = {
  // escalate = a Jira issue is created automatically. Inquiries and billing stay with support.
  product_bug: { label: "Bug", short: "bug", escalate: true },
  product_feedback: { label: "Feature request", short: "feedback", escalate: true },
  general_inquiry: { label: "General inquiry", short: "inquiry", escalate: false },
  billing_issue: { label: "Billing issue", short: "billing", escalate: false },
};

export const tagLabel = (t: Tag) => TAG_INFO[t].label;
export const isEscalated = (t: Tag) => TAG_INFO[t].escalate;

export type TicketStatus = "open" | "closed" | "snoozed";

// A Jira issue a ticket belongs to. A ticket can have several (one per tag,
// or more), and one issue can be shared by several tickets.
export interface JiraLink {
  key: string;
  tag: Tag;
  url: string | null;
}

export type UrgencyLevel = "high" | "medium" | "low";

export interface Urgency {
  level: UrgencyLevel;
  churnRisk: boolean; // customer is upset and may cancel / leave
  reasons: string[];
  source: "keywords" | "ai";
}

export interface Ticket {
  id: string;
  subject: string;
  body: string;
  customer: { name: string; org: string };
  createdAt: string; // ISO
  tags: string[];
  status: TicketStatus;
  followedUp: boolean; // a teammate has replied
  lastAdminReplyAt?: string; // ISO
  reviewed: boolean; // support has manually overridden something; automation leaves it alone
  jira: JiraLink[];
  intercomUrl?: string | null; // link to the conversation in the Intercom inbox
  urgency?: Urgency;
}

export type Mode = "mock" | "live";

export interface AppConfig {
  intercom: Mode;
  jira: Mode;
  ai: boolean; // true when ANTHROPIC_API_KEY is set (AI urgency); otherwise keyword rules
  project: string;
  issueTypes: Record<Tag, string>;
}

export type JiraStatusCategory = "new" | "indeterminate" | "done";
export interface JiraStatus {
  name: string;
  category: JiraStatusCategory;
}
