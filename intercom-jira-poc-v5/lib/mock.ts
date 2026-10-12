import type { Ticket } from "./types";

type Raw = Omit<Ticket, "status" | "followedUp" | "reviewed" | "jira"> &
  Partial<Pick<Ticket, "status" | "followedUp" | "lastAdminReplyAt">>;

// Sample tickets themed around a court-records platform. All names, courts and
// IDs are invented. Product-area wording is a placeholder: swap in real
// TRX product names/terminology before showing this to the team.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const RAW: Raw[] = [
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
    followedUp: true,
    lastAdminReplyAt: hoursAgo(4),
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
    status: "closed",
    followedUp: true,
    lastAdminReplyAt: hoursAgo(6),
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
    status: "closed",
    followedUp: true,
    lastAdminReplyAt: hoursAgo(48),
  },
  {
    id: "215000000107",
    subject: "Transcript order stuck in Processing, no error shown",
    body:
      "A transcript order for a civil hearing has been stuck in Processing since yesterday afternoon. " +
      "The requester emailed twice. There is no error message and refreshing doesn't help.",
    customer: { name: "Alicia Moreno", org: "Westfield Civil Court" },
    createdAt: hoursAgo(12),
    tags: [],
  },
  {
    id: "215000000108",
    subject: "Audio download times out on long hearings (would love a bulk zip too)",
    body:
      "Downloading the recording of an all-day trial times out after a couple of minutes and the file is incomplete. " +
      "While we're at it, we would love to select several hearings and download them together as one zip.",
    customer: { name: "Sam Kowalski", org: "Ridgemont Superior Court" },
    createdAt: hoursAgo(20),
    tags: [],
  },
  {
    id: "215000000109",
    subject: "Order confirmation email arriving twice again",
    body:
      "Requesters are getting two copies of the order confirmation email. Duplicate messages started again this week.",
    customer: { name: "Nadia Farouk", org: "Pinecrest Municipal Court" },
    createdAt: hoursAgo(72),
    tags: [],
    status: "closed",
    followedUp: true,
    lastAdminReplyAt: hoursAgo(70),
  },
  {
    id: "215000000110",
    subject: "Search is very slow on large transcripts",
    body:
      "Searching inside a 600 page transcript is slow, sometimes 20 seconds before anything shows up, and the page lags while typing.",
    customer: { name: "Owen Hale", org: "Brookdale District Court" },
    createdAt: hoursAgo(90),
    tags: [],
    status: "snoozed",
  },
  {
    id: "215000000111",
    subject: "We were charged twice on our latest invoice",
    body:
      "Our accounts payable team noticed two charges for the same monthly invoice. Could someone from billing review the payment and send back the extra one as a refund?",
    customer: { name: "Rita Santos", org: "Cedar Valley Court Services" },
    createdAt: hoursAgo(6),
    tags: [],
  },
  {
    id: "215000000112",
    subject: "Secure delivery links are broken again, this is unacceptable",
    body:
      "For the third time this month the secure delivery links we send to attorneys are broken and show an expired message right away. " +
      "We have a hearing tomorrow and our attorneys are furious. If this is not fixed today we will cancel our contract and look at other vendors.",
    customer: { name: "Harold Briggs", org: "Summit County Clerk of Courts" },
    createdAt: hoursAgo(1),
    tags: [],
  },
  {
    id: "215000000113",
    subject: "Do you offer an on-prem option?",
    body:
      "We are wondering whether you offer a self-hosted version, and who is the right point of contact to discuss it. No rush.",
    customer: { name: "Leah Park", org: "Tri-County Court Technology Office" },
    createdAt: hoursAgo(15),
    tags: [],
    status: "closed",
    followedUp: true,
    lastAdminReplyAt: hoursAgo(14),
  },
];

export const MOCK_TICKETS: Ticket[] = RAW.map((t) => ({
  status: "open",
  followedUp: false,
  reviewed: false,
  jira: [],
  ...t,
}));
