import type { ConductorMessage } from './types.js'

export interface ConductorConfig {
  apiUrl: string
  apiKey: string
  sessionId?: string
  workspaceProjectId?: string
  workspaceRepositoryUrl?: string
  retries: number
  retryBaseMs: number
  requestTimeoutMs: number
}

export class ConductorApiError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message)
  }
}

export class ConductorClient {
  private readonly baseUrl: string

  constructor(
    private readonly config: ConductorConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    const base = config.apiUrl.replace(/\/$/, '')
    this.baseUrl = base.endsWith('/v0') ? base : `${base}/v0`
  }

  createWorkspace(name: string) {
    const workspaceSource = this.config.workspaceProjectId
      ? { projectId: this.config.workspaceProjectId }
      : { repositoryUrl: this.config.workspaceRepositoryUrl! }
    return this.request<{ workspaceId: string; sessionId: string; deepLink: string }>('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ ...workspaceSource, name, sessionName: 'Security audit', agent: 'codex', model: 'gpt-5.6-sol' }),
    })
  }

  sendMessage(sessionId: string, message: string, messageId: string) {
    return this.request<{ messageId: string; state: 'queued' | 'sent' }>(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message, messageId }),
    })
  }

  getStatus(sessionId: string) {
    return this.request<{ status: 'idle' | 'working' | 'error'; errorMessage?: string; lastError?: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/status`,
    )
  }

  getMessages(sessionId: string, after?: string | null) {
    const query = new URLSearchParams({ limit: '100' })
    if (after) query.set('after', after)
    return this.request<{ data: ConductorMessage[]; hasMore: boolean; offset: number }>(
      `/sessions/${encodeURIComponent(sessionId)}/messages?${query}`,
    )
  }

  async getAllMessages(sessionId: string): Promise<ConductorMessage[]> {
    const all: ConductorMessage[] = []
    let offset = 0
    do {
      const page = await this.request<{ data: ConductorMessage[]; hasMore: boolean }>(
        `/sessions/${encodeURIComponent(sessionId)}/messages?limit=100&offset=${offset}`,
      )
      all.push(...page.data)
      if (!page.hasMore) break
      offset += page.data.length
    } while (true)
    return all
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.config.retries; attempt += 1) {
      try {
        const headers = new Headers(init.headers)
        headers.set('Authorization', `Bearer ${this.config.apiKey}`)
        headers.set('Accept', 'application/json')
        headers.set('User-Agent', 'repo-sentry/1.0')
        if (init.body) headers.set('Content-Type', 'application/json')
        if (this.config.sessionId) headers.set('X-Conductor-Session-Id', this.config.sessionId)
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          headers,
          signal: init.signal ?? AbortSignal.timeout(this.config.requestTimeoutMs),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { userMessage?: string; retryable?: boolean }
          const retryable = body.retryable ?? (response.status === 429 || response.status >= 500)
          throw new ConductorApiError(body.userMessage ?? `Conductor request failed (${response.status})`, retryable, response.status)
        }
        return await response.json() as T
      } catch (error) {
        lastError = error
        const retryable = !(error instanceof ConductorApiError) || error.retryable
        if (!retryable || attempt === this.config.retries) break
        await this.sleep(this.config.retryBaseMs * 2 ** attempt)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Conductor request failed')
  }
}

export function conductorConfigFromEnv(): ConductorConfig {
  const apiUrl = process.env.CONDUCTOR_API_URL
  const apiKey = process.env.CONDUCTOR_API_KEY ?? process.env.CONDUCTOR_API_TOKEN
  const workspaceProjectId = process.env.CONDUCTOR_WORKSPACE_PROJECT_ID
  const workspaceRepositoryUrl = process.env.CONDUCTOR_WORKSPACE_REPOSITORY_URL
  if (!apiUrl || !apiKey || (!workspaceProjectId && !workspaceRepositoryUrl)) {
    throw new Error('Conductor server configuration is missing')
  }
  return {
    apiUrl,
    apiKey,
    sessionId: process.env.CONDUCTOR_SESSION_ID,
    workspaceProjectId,
    workspaceRepositoryUrl,
    retries: numberEnv('AUDIT_REQUEST_RETRIES', 3),
    retryBaseMs: numberEnv('AUDIT_RETRY_BASE_MS', 500),
    requestTimeoutMs: numberEnv('AUDIT_REQUEST_TIMEOUT_MS', 30_000),
  }
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}
