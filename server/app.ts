import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { AuditDatabase } from './db.js'
import type { AuditMonitor } from './monitor.js'
import { InvalidRepositoryUrlError, normalizeGitHubRepositoryUrl } from './url.js'
import type { AuditRecord, PublicAudit } from './types.js'

interface MonitorLike { kick(id: string): void }

export function createApp(db: AuditDatabase, monitor: MonitorLike) {
  const app = new Hono()

  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    },
    referrerPolicy: 'no-referrer',
  }))

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.post('/api/audits', async (c) => {
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Request body must be valid JSON.' }, 400) }
    try {
      const repositoryUrl = normalizeGitHubRepositoryUrl((body as { repositoryUrl?: unknown })?.repositoryUrl)
      const { audit, created } = db.createOrGet(repositoryUrl)
      if (created) monitor.kick(audit.id)
      const current = db.get(audit.id) ?? audit
      const cached = !created && current.status === 'completed'
      return c.json(toPublic(current, cached), cached ? 200 : 202)
    } catch (error) {
      if (error instanceof InvalidRepositoryUrlError) return c.json({ error: error.message }, 400)
      console.error('Create audit failed', error)
      return c.json({ error: 'Unable to create the audit.' }, 500)
    }
  })

  app.get('/api/audits/:id', (c) => {
    const audit = db.get(c.req.param('id'))
    return audit ? c.json(toPublic(audit, false)) : c.json({ error: 'Audit not found.' }, 404)
  })

  app.onError((error, c) => {
    console.error('Unhandled API error', error)
    return c.json({ error: 'An unexpected server error occurred.' }, 500)
  })

  return app
}

function toPublic(audit: AuditRecord, cached: boolean): PublicAudit {
  const { messages: _messages, seenWorking: _seenWorking, promptSent: _promptSent, lastMessageId: _lastMessageId, ...publicAudit } = audit
  return { ...publicAudit, cached }
}
