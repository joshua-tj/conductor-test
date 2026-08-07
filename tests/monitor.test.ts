import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditDatabase } from '../server/db.js'
import { ConductorClient } from '../server/conductor.js'
import { AuditMonitor } from '../server/monitor.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('Conductor monitor', () => {
  const databases: AuditDatabase[] = []
  afterEach(() => databases.splice(0).forEach((db) => db.close()))

  it('waits for working before completing on a later idle and persists the full transcript', async () => {
    const db = new AuditDatabase(':memory:')
    databases.push(db)
    const { audit } = db.createOrGet('https://github.com/acme/tool')
    const statuses = ['idle', 'working', 'idle']
    let incrementalCalls = 0
    const messages = [
      { id: 'm1', sessionId: 's1', sessionIndex: 0, type: 'user', content: 'brief', receivedAt: '2026-01-01T00:00:00Z' },
      { id: 'm2', sessionId: 's1', sessionIndex: 1, type: 'assistant', content: '# Report\n\nNo critical findings.', receivedAt: '2026-01-01T00:01:00Z' },
    ]
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
      if (url.pathname.endsWith('/workspaces') && init?.method === 'POST') return json({ workspaceId: 'w1', sessionId: 's1', deepLink: 'https://conductor.build/w1' }, 201)
      if (url.pathname.endsWith('/messages') && init?.method === 'POST') return json({ messageId: 'brief-1', state: 'queued' }, 201)
      if (url.pathname.endsWith('/status')) return json({ workspaceId: 'w1', sessionId: 's1', status: statuses.shift(), updatedAt: new Date().toISOString() })
      if (url.pathname.endsWith('/messages') && url.searchParams.has('offset')) return json({ data: messages, offset: 0, hasMore: false })
      if (url.pathname.endsWith('/messages')) {
        incrementalCalls += 1
        return json({ data: incrementalCalls === 3 ? messages : [], offset: 0, hasMore: false })
      }
      return json({ userMessage: 'Unexpected request' }, 500)
    })

    const client = new ConductorClient({
      apiUrl: 'https://api.example.test/v0',
      apiKey: 'test-key',
      workspaceRepositoryUrl: 'https://github.com/acme/auditor-host',
      retries: 0,
      retryBaseMs: 0,
      requestTimeoutMs: 1000,
    }, fetchMock as unknown as typeof fetch)
    const monitor = new AuditMonitor(db, client, { pollIntervalMs: 0, maxPollErrors: 1, sleep: async () => {} })
    await monitor.processAudit(audit.id)

    expect(db.get(audit.id)).toMatchObject({ status: 'completed', workspaceId: 'w1', sessionId: 's1', seenWorking: true })
    expect(db.get(audit.id)?.transcript).toContain('No critical findings')
    const [workspaceUrl, workspaceInit] = fetchMock.mock.calls[0]
    expect(workspaceUrl).toBe('https://api.example.test/v0/workspaces')
    expect(JSON.parse(String(workspaceInit?.body))).toMatchObject({
      repositoryUrl: 'https://github.com/acme/auditor-host',
      agent: 'codex',
      model: 'gpt-5.6-sol',
    })
    const headers = workspaceInit?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer test-key')
    const promptCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST' && String(init.body).includes('Static security and malware audit'))
    expect(String(promptCall?.[1]?.body)).toContain('https://github.com/acme/tool')
    expect(String(promptCall?.[1]?.body)).toContain('submodules disabled')
  })
})
