export type HostName = "codex" | "opencode" | "grok" | "unknown";

export type ProjectContext = {
  readonly id: string;
  readonly repoRoot: string;
  readonly gitRemote: string | null;
  readonly gitBranch: string | null;
  readonly gitHead: string | null;
};

export type SessionStartInput = { readonly host: HostName; readonly adapter: string };

export type SessionBootstrapInput = SessionStartInput & { readonly limit: number };

export type SessionBootstrapResult = {
  readonly sessionId: string;
  readonly project: ProjectContext;
};

export type MemoryRecallInput = { readonly query: string; readonly limit: number };

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
    readonly concepts: number;
    readonly relations: number;
    readonly durableMemories: number;
    readonly decisionRecords: number;
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
  readonly concepts: readonly ConceptExportRow[];
  readonly relations: readonly RelationExportRow[];
  readonly durableMemories: readonly DurableMemoryExportRow[];
  readonly decisionRecords: readonly DecisionRecordExportRow[];
  readonly memoryReferences: readonly MemoryReferenceExportRow[];
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

export type ConceptExportRow = {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly description: string | null;
  readonly aliasesJson: string;
  readonly payloadJson: string;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly score: number;
  readonly retentionClass: string;
  readonly manualPin: number;
  readonly refCount: number;
  readonly projectSpread: number;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
};

export type RelationExportRow = {
  readonly id: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly relation: string;
  readonly weight: number;
  readonly payloadJson: string;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type DurableMemoryExportRow = {
  readonly id: string;
  readonly type: string;
  readonly summary: string;
  readonly body: string | null;
  readonly sourceEventId: string | null;
  readonly sourceHandoffId: string | null;
  readonly confidence: number;
  readonly status: string;
  readonly retentionClass: string;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type DecisionRecordExportRow = {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  readonly alternativesJson: string;
  readonly evidenceJson: string;
  readonly status: string;
  readonly reversible: number;
  readonly sourceEventId: string | null;
  readonly supersedesDecisionId: string | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type MemoryReferenceExportRow = {
  readonly id: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly refKind: string;
  readonly weight: number;
  readonly createdAt: string;
};

export type DeleteCounts = {
  readonly events: number;
  readonly handoffs: number;
  readonly sessions: number;
  readonly projects: number;
  readonly concepts: number;
  readonly relations: number;
  readonly durableMemories: number;
  readonly decisionRecords: number;
  readonly memoryReferences: number;
};
