export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface ConductorMessage {
  id: string
  sessionId: string
  sessionIndex: number
  type: string
  content: unknown
  receivedAt: string
}

export interface AuditRecord {
  id: string
  repositoryUrl: string
  status: AuditStatus
  workspaceId: string | null
  sessionId: string | null
  deepLink: string | null
  messages: ConductorMessage[]
  transcript: string
  error: string | null
  conductorState: string | null
  seenWorking: boolean
  promptSent: boolean
  lastMessageId: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface PublicAudit extends Omit<AuditRecord, 'messages' | 'seenWorking' | 'promptSent' | 'lastMessageId'> {
  cached: boolean
}
