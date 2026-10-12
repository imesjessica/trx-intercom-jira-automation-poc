export type Tag = "product_feedback" | "product_bug";

export const TAGS: Tag[] = ["product_feedback", "product_bug"];

export type TicketStatus = "open" | "closed" | "snoozed";

// A Jira issue a ticket belongs to. A ticket can have several (one per tag,
// or more), and one issue can be shared by several tickets.
export interface JiraLink {
  key: string;
  tag: Tag;
  url: string | null;
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
}

export type Mode = "mock" | "live";

export interface AppConfig {
  intercom: Mode;
  jira: Mode;
  project: string;
  issueTypes: Record<Tag, string>;
}
