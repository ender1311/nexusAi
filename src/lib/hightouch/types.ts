export type HightouchSyncStatus =
  | "success"
  | "warning"
  | "failed"
  | "pending"
  | "queued"
  | "running"
  | "interrupted"
  | "cancelled";

export type HightouchModelQueryType =
  | "table"
  | "custom_sql"
  | "dbt_model"
  | "visual"
  | "looker_look"
  | "sigma";

export type HightouchSyncRunRows = {
  added: number;
  changed: number;
  removed: number;
  invalid: number;
  filtered: number;
};

export type HightouchSync = {
  id: string;
  name: string;
  slug: string;
  status: HightouchSyncStatus;
  primaryKey: string;
  modelId: string | number;
  destinationId: string | number;
  schedule: {
    type: string;
    expression?: string;
  } | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  configuration: Record<string, unknown>;
};

export type HightouchSyncRun = {
  id: string;
  syncId: string;
  status: HightouchSyncStatus;
  startedAt: string | null;
  finishedAt: string | null;
  plannedRows: HightouchSyncRunRows | null;
  completionRatio: number;
  error: { message: string; shouldRetry: boolean } | null;
};

export type HightouchModel = {
  id: string;
  name: string;
  slug: string;
  sourceId: string | number;
  primaryKey: string;
  queryType: HightouchModelQueryType;
  sql: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HightouchSource = {
  id: string;
  name: string;
  slug: string;
  type: string;
  createdAt: string;
  updatedAt: string;
};

export type HightouchDestination = {
  id: string;
  name: string;
  slug: string;
  type: string;
  createdAt: string;
  updatedAt: string;
};
