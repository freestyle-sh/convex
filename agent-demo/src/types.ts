import type { ModelChoice, StoredModelChoice } from "../convex/lib/models";
export type Project = {
  _id: string;
  name: string;
  deploymentUrl: string;
  keyPrefix: string;
  workspaceId?: string;
  hasWebhookSecret?: boolean;
  connectionId?: string;
  connectionStatus?: "connected" | "disconnected";
  verifiedAt?: number;
  tokenExpiresAt?: number | null;
  tokenExpiryCheckedAt?: number;
  threadId: string;
  permissions: {
    readLogs: boolean;
    runQueries: boolean;
    analyze: boolean;
    proposeChanges: boolean;
  };
  allowedQueries: string[];
  allowedMutations: string[];
  intervalMinutes: number;
  enabled: boolean;
  policyVersion: number;
  activeRunId?: string;
  lastRunAt?: number;
  lastWebhookAt?: number;
};
export type Configuration = Omit<
  Project,
  | "workspaceId"
  | "hasWebhookSecret"
  | "connectionId"
  | "connectionStatus"
  | "verifiedAt"
  | "tokenExpiresAt"
  | "tokenExpiryCheckedAt"
  | "_id"
  | "threadId"
  | "policyVersion"
  | "activeRunId"
  | "lastRunAt"
  | "lastWebhookAt"
>;
export type Conversation = {
  modelChoice?: ModelChoice;
  threadId: string;
  projectId: string;
  title: string;
  trigger: "chat" | "cron" | "webhook";
  updatedAt: number;
  state: string;
  lastRunId?: string;
};
export type Evidence = {
  _id: string;
  eventId: string;
  timestamp: number;
  level: string;
  functionPath: string;
  message: string;
  source: string;
};
export type Finding = {
  _id: string;
  runId?: string;
  title: string;
  detail: string;
  severity: string;
  evidence: string[];
  occurrences: number;
};
export type Proposal = {
  notebookOutput?: unknown;
  notebook?: {
    code: string;
    timeoutMs: number;
    requests: import("../convex/lib/notebookAccess").NetworkOperation[];
  };
  kind?: import("../convex/lib/operations").OperationKind;
  oneTime?: boolean;
  allowedActions?: string[];
  _id: string;
  runId?: string;
  functionPath: string;
  argsJson: string;
  reason: string;
  state: string;
  expiresAt: number;
  policyVersion: number;
  result?: string;
};
export type Sandbox = {
  _id: string;
  runId?: string;
  purpose: string;
  credentialRef: string;
  endpoint: string;
  state: string;
  expiresAt?: number;
  slug: string;
};
export type Run = {
  modelChoice?: StoredModelChoice;
  _id: string;
  threadId?: string;
  promptMessageId?: string;
  trigger: string;
  startedAt: number;
  state: string;
  summary?: string;
  error?: string;
  prompt?: string;
};
export type Detail = {
  logs: Evidence[];
  findings: Finding[];
  proposals: Proposal[];
  sandboxes: Sandbox[];
  runs: Run[];
};
export type ToolStep = {
  id: string;
  name: string;
  state: string;
  input?: unknown;
  output?: unknown;
  error?: string;
};
export type Message = {
  id?: string;
  selection?: import("../convex/lib/resultSelection").ResultSelection;
  key: string;
  role: string;
  text: string;
  status?: string;
  thinking?: boolean;
  queued?: boolean;
  tools?: ToolStep[];
  openrouterProviders?: string[];
};
export const emptyDetail: Detail = {
  logs: [],
  findings: [],
  proposals: [],
  sandboxes: [],
  runs: [],
};
