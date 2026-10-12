import type { Ticket } from "./types";

// Sample tickets themed around a court-records platform. All names, courts and
// IDs are invented. Product-area wording is a placeholder: swap in real
// TRX product names/terminology before showing this to the team.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export const MOCK_TICKETS: Ticket[] = [
  {
    id: "215000000101",
    subject: "Transcript request stuck on 'Processing' for 3 days",
    body:
      "Hi team, a transcript request we submitted Friday for a felony hearing is still showing 'Processing'. " +
      "The requesting attorney keeps calling the clerk's office. Refreshing doesn't help and we get no error message. " +
      "Case number ends in 4471. Can someone look at this today?",
    customer: { name: "Dana Whitfield", org: "Harlan County Circuit Court" },
    createdAt: hoursAgo(2),
    tags: [],
  },
  {
    id: "215000000102",
    subject: "Would love bulk download for audio recordings",
    body:
      "Our court reporters often need to pull audio for a full week of hearings. Right now we download each recording one at a time. " +
      "It would be nice to select multiple hearings and download them as a single zip. Not urgent, just a suggestion for the roadmap.",
    customer: { name: "Marcus Odell", org: "Ridgemont Superior Court" },
    createdAt: hoursAgo(5),
    tags: [],
  },
  {
    id: "215000000103",
    subject: "Full-text search returns blank results for judge",
    body:
      "Judge Alvarez tried searching a transcript for a witness name and the results panel comes back blank, even though the name is definitely in the document. " +
      "It works for other judges in our building. Seems broken for just her account.",
    customer: { name: "Priya Raman", org: "Lakeshore District Court" },
    createdAt: hoursAgo(8),
    tags: [],
  },
  {
    id: "215000000104",
    subject: "Can we add support for custom delivery expiry on secure links?",
    body:
      "Secure delivery links currently expire after a fixed window. Our AOC office would like the ability to set a longer expiry for large media requests. " +
      "Please consider adding an option for administrators to configure this per request type.",
    customer: { name: "Tom Becker", org: "State Court Administrator's Office" },
    createdAt: hoursAgo(26),
    tags: [],
  },
  {
    id: "215000000105",
    subject: "Duplicate order confirmation emails going to requesters",
    body:
      "Requesters are receiving the order confirmation email twice every time they order court records. " +
      "Two people complained this morning. It started after last week's update. Not sure if it's on your side or ours.",
    customer: { name: "Elena Cho", org: "Marlowe Municipal Court" },
    createdAt: hoursAgo(30),
    tags: [],
  },
  {
    id: "215000000106",
    subject: "Question about SOC 2 report for our IT review",
    body:
      "Our IT department is doing its annual vendor review. Could you send over your latest SOC 2 Type II report and a point of contact for security questions? Thanks!",
    customer: { name: "Greg Pace", org: "Eastbrook County IT" },
    createdAt: hoursAgo(50),
    tags: [],
  },
];
