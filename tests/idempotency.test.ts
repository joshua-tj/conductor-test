import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditDatabase } from '../server/db.js'
import { createApp } from '../server/app.js'

describe('audit API idempotency', () => {
  const databases: AuditDatabase[] = []
  afterEach(() => databases.splice(0).forEach((db) => db.close()))

  it('creates one record and launches one monitor for normalized duplicates', async () => {
    const db = new AuditDatabase(':memory:')
    databases.push(db)
    const kick = vi.fn()
    const app = createApp(db, { kick })

    const responses = await Promise.all([
      app.request('/api/audits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repositoryUrl: 'https://github.com/acme/tool.git' }) }),
      app.request('/api/audits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repositoryUrl: 'https://github.com/acme/tool/' }) }),
    ])
    const bodies = await Promise.all(responses.map((response) => response.json())) as Array<{ id: string }>
    expect(bodies[0].id).toBe(bodies[1].id)
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('marks a completed duplicate as cached', async () => {
    const db = new AuditDatabase(':memory:')
    databases.push(db)
    const { audit } = db.createOrGet('https://github.com/acme/tool')
    db.complete(audit.id, [])
    const app = createApp(db, { kick: vi.fn() })
    const response = await app.request('/api/audits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repositoryUrl: 'https://github.com/acme/tool.git' }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: audit.id, status: 'completed', cached: true })
  })

  it('requeues a failed audit so configuration errors can be retried', async () => {
    const db = new AuditDatabase(':memory:')
    databases.push(db)
    const { audit } = db.createOrGet('https://github.com/acme/tool')
    db.fail(audit.id, 'Previous attempt failed')
    const kick = vi.fn()
    const app = createApp(db, { kick })

    const response = await app.request('/api/audits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryUrl: 'https://github.com/acme/tool' }),
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ id: audit.id, status: 'queued', error: null, cached: false })
    expect(kick).toHaveBeenCalledWith(audit.id)
  })
})
