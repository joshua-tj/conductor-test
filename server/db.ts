import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { AuditRecord, AuditStatus, ConductorMessage } from './types.js'

interface AuditRow {
  id: string
  repository_url: string
  status: AuditStatus
  workspace_id: string | null
  session_id: string | null
  deep_link: string | null
  messages_json: string
  transcript: string
  error: string | null
  conductor_state: string | null
  seen_working: number
  prompt_sent: number
  last_message_id: string | null
  monitor_owner: string | null
  lease_until: number | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export class AuditDatabase {
  private readonly db: DatabaseSync

  constructor(path = process.env.DATABASE_PATH ?? './data/audits.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audits (
        id TEXT PRIMARY KEY,
        repository_url TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
        workspace_id TEXT,
        session_id TEXT,
        deep_link TEXT,
        messages_json TEXT NOT NULL DEFAULT '[]',
        transcript TEXT NOT NULL DEFAULT '',
        error TEXT,
        conductor_state TEXT,
        seen_working INTEGER NOT NULL DEFAULT 0,
        prompt_sent INTEGER NOT NULL DEFAULT 0,
        last_message_id TEXT,
        monitor_owner TEXT,
        lease_until INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS audits_status_idx ON audits(status);
    `)
    const columns = this.db.prepare('PRAGMA table_info(audits)').all() as unknown as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'prompt_sent')) {
      this.db.exec('ALTER TABLE audits ADD COLUMN prompt_sent INTEGER NOT NULL DEFAULT 0')
    }
  }

  createOrGet(repositoryUrl: string): { audit: AuditRecord; created: boolean } {
    const id = randomUUID()
    const now = new Date().toISOString()
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO audits (id, repository_url, status, created_at, updated_at)
      VALUES (?, ?, 'queued', ?, ?)
    `).run(id, repositoryUrl, now, now)
    const audit = this.getByRepositoryUrl(repositoryUrl)
    if (!audit) throw new Error('Audit insert failed')
    return { audit, created: result.changes === 1 }
  }

  get(id: string): AuditRecord | null {
    return this.fromRow(this.db.prepare('SELECT * FROM audits WHERE id = ?').get(id) as AuditRow | undefined)
  }

  getByRepositoryUrl(repositoryUrl: string): AuditRecord | null {
    return this.fromRow(this.db.prepare('SELECT * FROM audits WHERE repository_url = ?').get(repositoryUrl) as AuditRow | undefined)
  }

  listActive(): AuditRecord[] {
    return (this.db.prepare("SELECT * FROM audits WHERE status IN ('queued', 'running')").all() as unknown as AuditRow[]).map((row) => this.fromRow(row)!)
  }

  claim(id: string, owner: string, leaseMs: number): boolean {
    const now = Date.now()
    const result = this.db.prepare(`
      UPDATE audits SET monitor_owner = ?, lease_until = ?, updated_at = ?
      WHERE id = ? AND status IN ('queued', 'running')
        AND (monitor_owner IS NULL OR monitor_owner = ? OR lease_until IS NULL OR lease_until < ?)
    `).run(owner, now + leaseMs, new Date(now).toISOString(), id, owner, now)
    return result.changes === 1
  }

  renewLease(id: string, owner: string, leaseMs: number) {
    this.db.prepare('UPDATE audits SET lease_until = ? WHERE id = ? AND monitor_owner = ?').run(Date.now() + leaseMs, id, owner)
  }

  setWorkspace(id: string, workspaceId: string, sessionId: string, deepLink: string) {
    this.db.prepare(`
      UPDATE audits SET workspace_id = ?, session_id = ?, deep_link = ?, status = 'running',
        conductor_state = 'queued', updated_at = ? WHERE id = ?
    `).run(workspaceId, sessionId, deepLink, new Date().toISOString(), id)
  }

  markPromptSent(id: string) {
    this.db.prepare('UPDATE audits SET prompt_sent = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  }

  updateProgress(id: string, messages: ConductorMessage[], conductorState: string, seenWorking: boolean, lastMessageId: string | null) {
    this.db.prepare(`
      UPDATE audits SET messages_json = ?, transcript = ?, conductor_state = ?, seen_working = ?,
        last_message_id = ?, status = 'running', updated_at = ? WHERE id = ?
    `).run(JSON.stringify(messages), renderTranscript(messages), conductorState, seenWorking ? 1 : 0, lastMessageId, new Date().toISOString(), id)
  }

  complete(id: string, messages: ConductorMessage[]) {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE audits SET messages_json = ?, transcript = ?, status = 'completed', conductor_state = 'idle',
        error = NULL, updated_at = ?, completed_at = ?, monitor_owner = NULL, lease_until = NULL WHERE id = ?
    `).run(JSON.stringify(messages), renderTranscript(messages), now, now, id)
  }

  fail(id: string, safeError: string, conductorState = 'error') {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE audits SET status = 'failed', conductor_state = ?, error = ?, updated_at = ?, completed_at = ?,
        monitor_owner = NULL, lease_until = NULL WHERE id = ?
    `).run(conductorState, safeError, now, now, id)
  }

  close() {
    this.db.close()
  }

  private fromRow(row?: AuditRow): AuditRecord | null {
    if (!row) return null
    let messages: ConductorMessage[] = []
    try { messages = JSON.parse(row.messages_json) as ConductorMessage[] } catch { /* keep a recoverable empty transcript */ }
    return {
      id: row.id,
      repositoryUrl: row.repository_url,
      status: row.status,
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      deepLink: row.deep_link,
      messages,
      transcript: row.transcript,
      error: row.error,
      conductorState: row.conductor_state,
      seenWorking: row.seen_working === 1,
      promptSent: row.prompt_sent === 1,
      lastMessageId: row.last_message_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    }
  }
}

export function renderTranscript(messages: ConductorMessage[]): string {
  return messages.map((message) => {
    const role = /user|human/i.test(message.type) ? 'Audit brief' : /assistant|agent|codex/i.test(message.type) ? 'Security auditor' : message.type
    return `## ${role}\n\n${contentToMarkdown(message.content)}`
  }).join('\n\n---\n\n')
}

function contentToMarkdown(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text
      return `\`\`\`json\n${JSON.stringify(part, null, 2)}\n\`\`\``
    }).join('\n\n')
  }
  return `\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\``
}
