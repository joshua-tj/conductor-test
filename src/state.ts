import { proxy } from 'valtio'

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface Audit {
  id: string
  repositoryUrl: string
  status: AuditStatus
  workspaceId: string | null
  sessionId: string | null
  deepLink: string | null
  transcript: string
  error: string | null
  conductorState: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  cached: boolean
}

interface AppState {
  repositoryUrl: string
  fieldError: string | null
  requestError: string | null
  submitting: boolean
  audit: Audit | null
  pollGeneration: number
}

export const state = proxy<AppState>({
  repositoryUrl: '',
  fieldError: null,
  requestError: null,
  submitting: false,
  audit: null,
  pollGeneration: 0,
})

export const actions = {
  setRepositoryUrl(value: string) {
    state.repositoryUrl = value
    state.fieldError = null
  },

  async submitAudit() {
    const validationError = validateRepositoryUrl(state.repositoryUrl)
    if (validationError) {
      state.fieldError = validationError
      return
    }
    const generation = ++state.pollGeneration
    state.submitting = true
    state.requestError = null
    state.audit = null
    try {
      const response = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositoryUrl: state.repositoryUrl.trim() }),
      })
      const data = await readResponse(response)
      state.audit = data
      state.repositoryUrl = data.repositoryUrl
      if (data.status === 'queued' || data.status === 'running') void pollAudit(data.id, generation)
    } catch (error) {
      state.requestError = error instanceof Error ? error.message : 'Unable to start the audit.'
    } finally {
      state.submitting = false
    }
  },
}

async function pollAudit(id: string, generation: number) {
  while (generation === state.pollGeneration) {
    await delay(2000)
    try {
      const response = await fetch(`/api/audits/${encodeURIComponent(id)}`)
      const audit = await readResponse(response)
      if (generation !== state.pollGeneration) return
      state.audit = audit
      state.requestError = null
      if (audit.status === 'completed' || audit.status === 'failed') return
    } catch {
      if (generation === state.pollGeneration) state.requestError = 'Connection interrupted. Retrying…'
    }
  }
}

async function readResponse(response: Response): Promise<Audit> {
  const data = await response.json().catch(() => ({})) as Audit & { error?: string }
  if (!response.ok) throw new Error(data.error ?? 'The request failed.')
  return data
}

function validateRepositoryUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') throw new Error()
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length !== 2) throw new Error()
    return null
  } catch {
    return 'Enter a repository URL like https://github.com/owner/repo.'
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
