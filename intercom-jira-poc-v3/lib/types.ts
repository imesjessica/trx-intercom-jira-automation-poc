export type Tag = "product_feedback" | "product_bug";

export const TAGS: Tag[] = ["product_feedback", "product_bug"];

export interface Ticket {
  id: string;
  subject: string;
  body: string;
  customer: { name: string; org: string };
  createdAt: string; // ISO
  tags: string[];
  jira?: { key: string; url: string | null };
}

export type Mode = "mock" | "live";

export interface AppConfig {
  intercom: Mode;
  jira: Mode;
  project: string;
  issueTypes: Record<Tag, string>;
}
