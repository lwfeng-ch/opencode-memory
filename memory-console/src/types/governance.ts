export type ProposalAction = "merge" | "archive" | "delete" | "split" | "resolve";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ProposalStatus = "pending" | "approved" | "rejected" | "executed";
export type LiveStatus = "connected" | "reconnecting" | "offline";

export interface EvidenceItem {
  id: string;
  label: string;
  score: number;
}

export interface RiskFactors {
  impact: number;
  blastRadius: number;
  reversibility: number;
}

export interface AiExplanation {
  summary: string;
  recommendation: string;
  confidenceBreakdown: Record<string, number>;
}

export interface GovernanceProposal {
  id: string;
  type: ProposalAction;
  targetMemory: string;
  reason: string;
  confidence: number;
  risk: RiskLevel;
  status: ProposalStatus;
  evidence: EvidenceItem[];
  before: string;
  after: string;
  createdAt: string;
  createdBy: "discovery" | "dream" | "governance";
  riskFactors: RiskFactors;
  aiExplanation: AiExplanation;
  execution?: { executedAt: string; snapshot: string };
}

export interface AuditEvent {
  id: string;
  action: string;
  actor: string;
  risk: RiskLevel;
  result: "success" | "failure";
  timestamp: string;
  detail: string;
  snapshotHash: string | null;
}

export interface AuditResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}
