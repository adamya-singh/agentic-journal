// The part of Codex's app-server protocol the Codex adapter uses, written by hand from the types that
// `codex app-server generate-ts` produced for codex-cli 0.169.0 (v2 protocol). Only what codex.ts reads or sends;
// fields it does not use are left out, and every field it reads is treated as possibly missing, since the app
// server is labelled experimental and changes between versions. Regenerate and compare when Codex updates.

export type CodexReasoningEffort = string;
export type CodexAskForApproval = 'untrusted' | 'on-request' | 'never' | { granular: Record<string, boolean> };
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type CodexSandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly'; networkAccess: boolean }
  | { type: 'workspaceWrite'; writableRoots: string[]; networkAccess: boolean; excludeTmpdirEnvVar: boolean; excludeSlashTmp: boolean };

export type CodexUserInput =
  | { type: 'text'; text: string; text_elements: unknown[] }
  | { type: 'image'; url?: string; fileId?: string }
  | { type: 'localImage'; path: string }
  | { type: 'audio' }
  | { type: 'localAudio'; path: string }
  | { type: 'skill'; name: string; path: string }
  | { type: 'mention'; name: string; path: string };

export type CodexItemStatus = 'inProgress' | 'completed' | 'failed' | 'declined';

export interface CodexFileUpdateChange {
  path: string;
  kind: { type: 'add' } | { type: 'delete' } | { type: 'update'; move_path: string | null };
  diff: string;
}

export type CodexWebSearchAction =
  | { type: 'search'; query?: string; queries?: string[] }
  | { type: 'open_page'; url?: string }
  | { type: 'find_in_page'; url?: string; pattern?: string }
  | { type: 'other' };

type Times = { startedAtMs?: number | null; completedAtMs?: number | null };

export type CodexThreadItem = Times & (
  | { type: 'userMessage'; id: string; content: CodexUserInput[] }
  | { type: 'hookPrompt'; id: string; fragments: { text: string }[] }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'functionCallOutput'; id: string; name: string; namespace: string | null; output: string | { type: string; text?: string }[] }
  | { type: 'plan'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | { type: 'commandExecution'; id: string; command: string; cwd: string; status: CodexItemStatus; aggregatedOutput: string | null; exitCode: number | null; durationMs: number | null }
  | { type: 'fileChange'; id: string; changes: CodexFileUpdateChange[]; status: CodexItemStatus }
  | { type: 'mcpToolCall'; id: string; server: string; tool: string; status: CodexItemStatus; arguments: unknown; result: { content: unknown[]; structuredContent: unknown } | null; error: { message: string } | null; durationMs: number | null }
  | { type: 'dynamicToolCall'; id: string; namespace: string | null; tool: string; arguments: unknown; status: CodexItemStatus; contentItems: { type: string; text?: string }[] | null; success: boolean | null }
  | { type: 'collabAgentToolCall'; id: string; tool: string; status: CodexItemStatus; prompt: string | null; receiverThreadIds: string[] }
  | { type: 'subAgentActivity'; id: string; kind: string; agentPath: string }
  | { type: 'webSearch'; id: string; query: string; action: CodexWebSearchAction | null }
  | { type: 'imageView'; id: string; path: string }
  | { type: 'sleep'; id: string; durationMs: number }
  | { type: 'imageGeneration'; id: string; status: string; revisedPrompt: string | null; savedPath?: string }
  | { type: 'enteredReviewMode'; id: string; review: string }
  | { type: 'exitedReviewMode'; id: string; review: string }
  | { type: 'contextCompaction'; id: string }
);

export type CodexTurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export interface CodexTurnError {
  message: string;
  codexErrorInfo: unknown;      // "usageLimitExceeded", "rateLimitExceeded", { httpConnectionFailed: ... }, ...
  additionalDetails: string | null;
}

export interface CodexTurn {
  id: string;
  items: CodexThreadItem[];
  status: CodexTurnStatus;
  error: CodexTurnError | null;
  startedAt: number | null;     // seconds
  completedAt: number | null;   // seconds
  durationMs: number | null;
}

export type CodexThreadStatus =
  | { type: 'notLoaded' }
  | { type: 'idle' }
  | { type: 'systemError' }
  | { type: 'active'; activeFlags: ('waitingOnApproval' | 'waitingOnUserInput')[] };

export interface CodexThread {
  id: string;
  preview: string;
  model: string | null;
  reasoningEffort: CodexReasoningEffort | null;
  createdAt: number;            // seconds
  updatedAt: number;            // seconds
  status: CodexThreadStatus;
  path: string | null;
  cwd: string;
  source: unknown;              // "cli" | "vscode" | "exec" | { custom: string } | ...
  name: string | null;
  turns: CodexTurn[];
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: { reasoningEffort: CodexReasoningEffort; description: string }[];
  defaultReasoningEffort: CodexReasoningEffort;
  isDefault: boolean;
}

export interface CodexRateLimitWindow { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null }
export interface CodexRateLimitSnapshot {
  limitId: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  planType: string | null;
  rateLimitReachedType: string | null;
}

export type CodexAccount =
  | { type: 'apiKey' }
  | { type: 'chatgpt'; email: string | null; planType: string }
  | { type: 'amazonBedrock' }
  | { type: 'gcp' };

// ---- Requests the adapter sends, and what they answer.

export interface CodexInitializeResult { userAgent?: string; codexHome?: string }
export interface CodexAccountReadResult { account: CodexAccount | null; requiresOpenaiAuth: boolean }
export interface CodexRateLimitsReadResult { ordinaryUsageAllowed: boolean | null; rateLimits: CodexRateLimitSnapshot }
/**
 * config/read {cwd?}: the effective config.toml (snake_case keys as in the file), with the project layers between
 * `cwd` and its repo root when `cwd` is given. Only what the adapter reads.
 */
export interface CodexConfigReadResult {
  config: {
    model?: string | null;
    model_reasoning_effort?: string | null;
    approval_policy?: CodexAskForApproval | null;
    sandbox_mode?: CodexSandboxMode | null;
    sandbox_workspace_write?: { writable_roots?: string[]; network_access?: boolean; exclude_tmpdir_env_var?: boolean; exclude_slash_tmp?: boolean } | null;
  } | null;
}
/** account/login/start: only the device-code way is used (no browser on the device is needed). */
export type CodexLoginStartResult =
  | { type: 'chatgptDeviceCode'; loginId: string; verificationUrl: string; userCode: string }
  | { type: 'chatgpt'; loginId: string; authUrl: string }
  | { type: string; loginId?: string };
/** account/login/cancel. An id the server does not know is a JSON-RPC error (-32600 "invalid login id"), seen live. */
export interface CodexLoginCancelResult { status: 'canceled' | 'notFound' }
export interface CodexModelListResult { data: CodexModel[]; nextCursor: string | null }
export interface CodexThreadListResult { data: CodexThread[]; nextCursor: string | null }
export interface CodexThreadStartResult { thread: CodexThread; model: string; reasoningEffort?: string | null; approvalPolicy?: unknown; sandbox?: unknown }
export interface CodexThreadResumeResult { thread: CodexThread; model: string; reasoningEffort?: string | null; approvalPolicy?: unknown; sandbox?: unknown }
export interface CodexTurnsListResult { data: CodexTurn[]; nextCursor: string | null; backwardsCursor: string | null }
export interface CodexTurnStartResult { turn: CodexTurn }
export interface CodexTurnSteerResult { turnId: string }

// ---- Notifications the adapter reads (params).

export interface CodexNotificationParams {
  'turn/started': { threadId: string; turn: CodexTurn };
  'turn/completed': { threadId: string; turn: CodexTurn };
  'item/started': { threadId: string; turnId: string; item: CodexThreadItem; startedAtMs?: number };
  'item/completed': { threadId: string; turnId: string; item: CodexThreadItem; completedAtMs?: number };
  'item/agentMessage/delta': { threadId: string; turnId: string; itemId: string; delta: string };
  'item/reasoning/summaryTextDelta': { threadId: string; turnId: string; itemId: string; delta: string; summaryIndex: number };
  'item/commandExecution/outputDelta': { threadId: string; turnId: string; itemId: string; delta: string };
  'item/plan/delta': { threadId: string; turnId: string; itemId: string; delta: string };
  'item/fileChange/patchUpdated': { threadId: string; turnId: string; itemId: string; changes: CodexFileUpdateChange[] };
  'turn/plan/updated': { threadId: string; turnId: string; explanation: string | null; plan: { step: string; status: 'pending' | 'inProgress' | 'completed' }[] };
  'turn/diff/updated': { threadId: string; turnId: string; diff: string };
  'thread/tokenUsage/updated': { threadId: string; turnId: string; tokenUsage: { total: { totalTokens: number; inputTokens: number; outputTokens: number }; last: { totalTokens: number }; modelContextWindow: number | null } };
  'thread/name/updated': { threadId: string; threadName?: string };
  'thread/status/changed': { threadId: string; status: CodexThreadStatus };
  'error': { error: CodexTurnError; willRetry: boolean; threadId: string; turnId: string };
  'serverRequest/resolved': { threadId: string; requestId: string | number };
  'account/rateLimits/updated': { rateLimits: CodexRateLimitSnapshot };
  'account/login/completed': { loginId: string | null; success: boolean; error: string | null };
}

// ---- Requests the server sends (params), answered by the Journal.

export interface CodexCommandApprovalParams {
  threadId: string; turnId: string; itemId: string;
  reason?: string | null; command?: string | null; cwd?: string | null;
}
export interface CodexFileChangeApprovalParams {
  threadId: string; turnId: string; itemId: string;
  reason?: string | null; grantRoot?: string | null;
}
export interface CodexPermissionsApprovalParams { threadId: string; turnId: string; itemId: string; cwd: string; reason: string | null }
export interface CodexUserInputParams { threadId: string; turnId: string; itemId: string; questions: { id: string; header: string; question: string }[] }
export interface CodexElicitationParams { threadId: string; turnId: string | null; serverName: string; message: string; mode: string }

/** The answer to a command or file-change approval. */
export type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';
