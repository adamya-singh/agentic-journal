// The parts of the Claude Agent SDK (@anthropic-ai/claude-agent-sdk 0.3.325) the bridge uses, written by hand so the
// bridge can be tested with a stand-in SDK and type-checked without the SDK installed. Checked against the SDK's
// sdk.d.ts for 0.3.325 and against what CLI 2.1.302 sent in the Stage 0 spike. Compare again when the SDK updates.
// Messages are kept loose on purpose: the bridge reads the fields it knows and lets the rest pass.

export interface SdkContentBlock {
  type: string;                       // text | thinking | redacted_thinking | tool_use | tool_result | image | ...
  text?: string;
  thinking?: string;
  id?: string;                        // tool_use
  name?: string;                      // tool_use
  input?: Record<string, unknown>;    // tool_use
  tool_use_id?: string;               // tool_result
  content?: string | SdkContentBlock[];   // tool_result
  is_error?: boolean;                 // tool_result
}

export interface SdkUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** An Anthropic Messages API message (assistant) or message param (user). */
export interface SdkApiMessage {
  id?: string;
  model?: string;                     // '<synthetic>' on a message Claude Code made itself (an API error, ...)
  role?: string;
  content: string | SdkContentBlock[];
  usage?: SdkUsage;
  stop_reason?: string | null;
}

/** One Messages API streaming event. */
export interface SdkStreamEvent {
  type: string;                       // message_start | content_block_start | content_block_delta | content_block_stop | message_delta | message_stop
  index?: number;
  message?: { id?: string; model?: string };
  content_block?: SdkContentBlock;
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
}

export interface SdkRateLimitInfo {
  status?: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  rateLimitType?: string;             // five_hour | seven_day | seven_day_opus | seven_day_sonnet | overage | ...
  utilization?: number;
  /** Not in sdk.d.ts, but what CLI 2.1.302 sends: each window's use (a fraction) and reset (seconds). */
  unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number; status?: string } | undefined>;
  overageStatus?: string;
}

/** Any message the query yields. `type` (and `subtype` for system/result) says which fields are there. */
export interface SdkMessage {
  type: string;                       // system | assistant | user | stream_event | result | rate_limit_event | ...
  subtype?: string;                   // system: init | status | compact_boundary | api_retry | session_title_changed ...; result: success | error_*
  session_id?: string;
  uuid?: string;
  parent_tool_use_id?: string | null;
  message?: SdkApiMessage;
  event?: SdkStreamEvent;
  error?: string;                     // assistant: authentication_failed | rate_limit | billing_error | ...
  is_error?: boolean;                 // result
  result?: string;                    // result (success)
  errors?: string[];                  // result (error_*)
  usage?: SdkUsage;                   // result
  modelUsage?: Record<string, { contextWindow?: number }>;
  user_message_uuid?: string;         // assistant, result: the user message this answers
  tool_use_result?: unknown;          // user: the tool's own output object
  rate_limit_info?: SdkRateLimitInfo; // rate_limit_event
  title?: string;                     // system/session_title_changed
  session_title?: string;
  model?: string;                     // system/init
  permissionMode?: string;            // system/init
  claude_code_version?: string;       // system/init
  apiKeySource?: string;              // system/init
  cwd?: string;                       // system/init
  [key: string]: unknown;
}

/** What the bridge pushes into a streaming query: one user message. */
export interface SdkUserInput {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
  uuid?: string;                      // kept as the transcript's uuid for the message (seen in the spike)
}

export interface SdkPermissionUpdate {
  type: string;                       // addRules | replaceRules | removeRules | setMode | addDirectories | removeDirectories
  destination?: string;               // userSettings | projectSettings | localSettings | session | cliArg
  [key: string]: unknown;
}

export interface SdkCanUseToolOptions {
  signal: AbortSignal;
  suggestions?: SdkPermissionUpdate[];
  blockedPath?: string;
  decisionReason?: string;
  title?: string;
  displayName?: string;
  description?: string;
  suppressAlwaysAllowRule?: boolean;
  toolUseID: string;
  agentID?: string;
  requestId?: string;
}

export type SdkPermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: SdkPermissionUpdate[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

export type SdkCanUseTool = (toolName: string, input: Record<string, unknown>, options: SdkCanUseToolOptions) => Promise<SdkPermissionResult>;

export type SdkPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk' | 'auto';

export interface SdkQueryOptions {
  cwd: string;
  sessionId?: string;                 // a new session with this id
  resume?: string;                    // an existing session
  title?: string;                     // a new session's title
  pathToClaudeCodeExecutable?: string;
  settingSources?: ('user' | 'project' | 'local')[];
  systemPrompt?: { type: 'preset'; preset: 'claude_code' };
  permissionMode?: SdkPermissionMode;
  allowDangerouslySkipPermissions?: boolean;
  model?: string;
  effort?: string;
  env?: Record<string, string | undefined>;
  canUseTool?: SdkCanUseTool;
  includePartialMessages?: boolean;
  disallowedTools?: string[];
  allowedTools?: string[];            // rules allowed without asking, as Claude Code spells them ("Bash(npm test:*)")
  additionalDirectories?: string[];
  persistSession?: boolean;
  /** More CLI flags, as `{flag: value}` (`--flag value`). */
  extraArgs?: Record<string, string | null>;
  stderr?: (data: string) => void;
}

export interface SdkModelInfo {
  value: string;
  resolvedModel?: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
}

export interface SdkAccountInfo {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiKeySource?: string;
  apiProvider?: string;
}

export interface SdkQuery extends AsyncIterable<SdkMessage> {
  interrupt(): Promise<unknown>;
  close(): void;
  supportedModels(): Promise<SdkModelInfo[]>;
  accountInfo(): Promise<SdkAccountInfo>;
}

export interface SdkSessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;               // ms
  fileSize?: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
  tag?: string;
  createdAt?: number;                 // ms
  archived?: boolean;
}

export interface SdkSessionMessage {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  session_id: string;
  parent_tool_use_id: string | null;
  timestamp?: string;                 // ISO
  origin?: { kind?: string };         // human | peer | task-notification | ...
  /** A message he sent while Claude worked, taken into the running turn (CLI 2.1.302: "absorbed mid-turn"). */
  isQueuedCommand?: boolean;
  message: SdkApiMessage;
}

/** resolveSettings' answer (alpha in 0.3.325), as far as the bridge reads it. */
export interface SdkResolvedSettings {
  effective: { permissions?: { defaultMode?: string }; showThinkingSummaries?: boolean };
  [key: string]: unknown;
}

/** The SDK as the bridge uses it. The real one is loaded in claude-bridge.ts; the tests pass a stand-in. */
export interface ClaudeSdk {
  /** The settings a query in `cwd` would load, without running Claude Code. */
  resolveSettings?(options: { cwd?: string; settingSources?: ('user' | 'project' | 'local')[] }): Promise<SdkResolvedSettings>;
  /** The CLI's own rule: an escalating defaultMode from a repo's committed settings is dropped. */
  filterEscalatingDefaultMode?(resolved: SdkResolvedSettings): { permissions?: { defaultMode?: string } };
  query(params: { prompt: AsyncIterable<SdkUserInput>; options: SdkQueryOptions }): SdkQuery;
  listSessions(options: { dir?: string; limit?: number; includeProgrammatic?: boolean }): Promise<SdkSessionInfo[]>;
  getSessionInfo(sessionId: string, options?: { dir?: string }): Promise<SdkSessionInfo | undefined>;
  getSessionMessages(sessionId: string, options?: { dir?: string }): Promise<SdkSessionMessage[]>;
  renameSession(sessionId: string, title: string, options?: { dir?: string }): Promise<void>;
  archiveSession?(sessionId: string, options?: { dir?: string }): Promise<void>;
}
