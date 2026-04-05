export type ActiveProcessKind = "download" | "analysis";

export interface ActiveProcessRecord {
  id: string;
  kind: ActiveProcessKind;
  name: string | null;
  status: "queued" | "running";
  progressPercent: number | null;
  statusLabel: string;
  detailText: string | null;
}

export interface ActiveProcessesResponse {
  jobs: ActiveProcessRecord[];
}