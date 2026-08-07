import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { AuditDatabase } from './db.js'
import { ConductorClient, conductorConfigFromEnv } from './conductor.js'
import { AuditMonitor } from './monitor.js'
import { createApp } from './app.js'

const db = new AuditDatabase()
const conductor = new ConductorClient(conductorConfigFromEnv())
const monitor = new AuditMonitor(db, conductor)
const app = createApp(db, monitor)

app.use('/*', serveStatic({ root: './dist' }))
app.get('*', serveStatic({ path: './dist/index.html' }))

const conductorPort = Number(process.env.CONDUCTOR_PORT)
const defaultPort = Number.isFinite(conductorPort) && conductorPort > 0 ? conductorPort + 1 : 8787
const port = Number(process.env.PORT ?? defaultPort)
serve({ fetch: app.fetch, port }, () => {
  console.log(`RepoSentry listening on http://localhost:${port}`)
  monitor.resumeActive()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    db.close()
    process.exit(0)
  })
}
