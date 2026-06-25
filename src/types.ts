export type HostName = "codex" | "opencode" | "grok" | "unknown";

export type ProjectContext = {
  readonly id: string;
  readonly repoRoot: string;
  readonly gitRemote: string | null;
  readonly gitBranch: string | null;
  readonly gitHead: string | null;
};

export type SessionStartInput = { readonly host: HostName; readonly adapter: string };

export type EventRecordInput = {
  readonly type: string;
  readonly summary: string;
  readonly payloadJson?: string;
  readonly sessionId?: string;
};

export type MemoryPaths = { readonly dbPath: string };

export type DoctorReport = {
  readonly paths: MemoryPaths;
  readonly schemaVersion: number;
  readonly project: ProjectContext;
  readonly counts: {
    readonly projects: number;
    readonly sessions: number;
    readonly events: number;
    readonly handoffs: number;
  };
};

export type RecentEvent = {
  readonly id: string;
  readonly type: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly sessionId: string | null;
};

export type MemoryExport = {
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly paths: MemoryPaths;
  readonly project: ProjectContext;
  readonly sessions: readonly SessionExportRow[];
  readonly events: readonly EventExportRow[];
  readonly handoffs: readonly HandoffExportRow[];
};

export type PurgeMemoryInput = { readonly yes: boolean };

export type PurgeMemoryResult = {
  readonly project: ProjectContext;
  readonly deleted: DeleteCounts;
};

export type SessionExportRow = {
  readonly id: string;
  readonly host: string;
  readonly adapter: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly gitBranch: string | null;
  readonly gitHead: string | null;
};

export type EventExportRow = {
  readonly id: string;
  readonly sessionId: string | null;
  readonly type: string;
  readonly summary: string;
  readonly payloadJson: string | null;
  readonly createdAt: string;
};

export type HandoffExportRow = {
  readonly id: string;
  readonly sessionId: string | null;
  readonly summaryMd: string;
  readonly createdAt: string;
};

export type DeleteCounts = {
  readonly events: number;
  readonly handoffs: number;
  readonly sessions: number;
  readonly projects: number;
};
