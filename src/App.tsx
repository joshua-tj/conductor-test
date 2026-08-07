import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSnapshot } from 'valtio'
import { actions, state } from './state'

const statusCopy = {
  queued: ['Queued', 'Your audit brief is waiting for the Conductor workspace.'],
  running: ['Inspecting', 'Codex is reviewing the repository with static analysis.'],
  completed: ['Complete', 'The full audit transcript is ready.'],
  failed: ['Failed', 'The audit did not finish successfully.'],
} as const

export function App() {
  const snap = useSnapshot(state)
  const audit = snap.audit

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07100e] text-stone-100">
      <div className="grid-noise pointer-events-none absolute inset-0 opacity-35" />
      <div className="pointer-events-none absolute left-1/2 top-[-20rem] h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-[120px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <a href="/" className="flex items-center gap-3" aria-label="RepoSentry home">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-300/30 bg-emerald-400/10 text-emerald-300">
              <ShieldIcon />
            </span>
            <span className="font-display text-lg tracking-tight">RepoSentry</span>
          </a>
          <span className="hidden items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
            Powered by Conductor
          </span>
        </header>

        <section className="mx-auto w-full max-w-4xl pb-16 pt-16 sm:pt-24">
          <div className="mb-12 max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300">
              Static analysis · no code execution
            </div>
            <h1 className="font-display text-5xl leading-[0.95] tracking-[-0.045em] text-stone-50 sm:text-7xl">
              Know what you’re<br /><span className="text-emerald-300">bringing inside.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-stone-400 sm:text-lg">
              A focused security and malware review for any public GitHub library. One URL in, an evidence-backed audit out.
            </p>
          </div>

          <form className="rounded-2xl border border-white/10 bg-white/[0.035] p-2 shadow-2xl shadow-black/30 backdrop-blur" onSubmit={(event) => { event.preventDefault(); void actions.submitAudit() }}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="repository-url">GitHub repository URL</label>
              <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
                <GitHubIcon />
                <input
                  id="repository-url"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  value={snap.repositoryUrl}
                  onChange={(event) => actions.setRepositoryUrl(event.target.value)}
                  placeholder="https://github.com/owner/repository"
                  aria-invalid={Boolean(snap.fieldError)}
                  aria-describedby={snap.fieldError ? 'url-error' : undefined}
                  className="h-14 min-w-0 flex-1 bg-transparent font-mono text-sm text-stone-100 outline-none placeholder:text-stone-600"
                />
              </div>
              <button type="submit" disabled={snap.submitting} className="group flex h-14 items-center justify-center gap-2 rounded-xl bg-emerald-300 px-7 font-mono text-xs font-bold uppercase tracking-[0.14em] text-[#07100e] transition hover:bg-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-wait disabled:opacity-60">
                {snap.submitting ? 'Launching' : 'Audit'} <ArrowIcon />
              </button>
            </div>
          </form>
          {snap.fieldError && <p id="url-error" role="alert" className="mt-3 text-sm text-rose-300">{snap.fieldError}</p>}
          {snap.requestError && <p role="alert" className="mt-3 text-sm text-amber-200">{snap.requestError}</p>}

          {!audit && <TrustStrip />}

          {audit && (
            <section className="mt-12" aria-live="polite" aria-busy={audit.status === 'queued' || audit.status === 'running'}>
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1512]/90">
                <div className="grid gap-px bg-white/10 sm:grid-cols-[1fr_auto]">
                  <div className="bg-[#0b1512] p-6 sm:p-7">
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                      <StatusPill status={audit.status} />
                      {audit.cached && <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-sky-200">Cached result</span>}
                    </div>
                    <h2 className="break-all font-display text-2xl text-stone-100">{shortRepo(audit.repositoryUrl)}</h2>
                    <p className="mt-2 text-sm text-stone-500">{statusCopy[audit.status][1]}</p>
                  </div>
                  <div className="grid min-w-64 grid-cols-2 gap-px bg-white/10 sm:grid-cols-1">
                    <Meta label="Conductor" value={audit.conductorState ?? 'starting'} />
                    <Meta label={audit.completedAt ? 'Completed' : 'Started'} value={formatDate(audit.completedAt ?? audit.createdAt)} />
                  </div>
                </div>

                {(audit.status === 'queued' || audit.status === 'running') && <Progress />}
                {audit.status === 'failed' && <div className="border-t border-white/10 p-6 text-sm text-rose-200">{audit.error ?? 'The audit failed.'}</div>}
                {audit.status === 'completed' && (
                  <article className="markdown border-t border-white/10 px-6 py-8 sm:px-10 sm:py-12">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
                      a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
                      img: ({ node: _node, alt }) => <span className="text-stone-500">[Remote image omitted{alt ? `: ${alt}` : ''}]</span>,
                    }}>{audit.transcript || '# Audit complete\n\nNo transcript content was returned.'}</ReactMarkdown>
                  </article>
                )}
              </div>
              {safeDeepLink(audit.deepLink) && <a className="mt-4 inline-flex items-center gap-2 font-mono text-xs text-stone-500 transition hover:text-emerald-300" href={safeDeepLink(audit.deepLink)!} target="_blank" rel="noreferrer noopener">Open session in Conductor <ArrowIcon /></a>}
            </section>
          )}
        </section>

        <footer className="mt-auto flex flex-col gap-2 border-t border-white/10 py-5 font-mono text-[10px] uppercase tracking-[0.16em] text-stone-600 sm:flex-row sm:items-center sm:justify-between">
          <span>Automated aid, not a safety guarantee</span><span>Read-only repository analysis</span>
        </footer>
      </div>
    </main>
  )
}

function TrustStrip() {
  return <div className="mt-8 grid grid-cols-1 gap-4 border-t border-white/10 pt-6 text-xs text-stone-500 sm:grid-cols-3">
    <span><b className="mr-2 font-mono text-emerald-300/70">01</b>No installs or builds</span>
    <span><b className="mr-2 font-mono text-emerald-300/70">02</b>Supply-chain review</span>
    <span><b className="mr-2 font-mono text-emerald-300/70">03</b>Evidence and remediation</span>
  </div>
}

function StatusPill({ status }: { status: keyof typeof statusCopy }) {
  const active = status === 'queued' || status === 'running'
  return <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.07] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-200">
    <span className={`h-1.5 w-1.5 rounded-full ${status === 'failed' ? 'bg-rose-400' : 'bg-emerald-400'} ${active ? 'animate-pulse' : ''}`} />
    {statusCopy[status][0]}
  </span>
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#0b1512] px-6 py-4"><div className="font-mono text-[9px] uppercase tracking-[0.18em] text-stone-600">{label}</div><div className="mt-1 font-mono text-xs capitalize text-stone-300">{value}</div></div>
}

function Progress() {
  return <div className="border-t border-white/10 px-6 py-5"><div className="h-1 overflow-hidden rounded-full bg-white/5"><div className="scan-progress h-full w-1/3 rounded-full bg-emerald-300" /></div><p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-stone-600">Session transcript will appear here when complete</p></div>
}

const shortRepo = (url: string) => new URL(url).pathname.slice(1)
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const safeDeepLink = (value: string | null) => {
  if (!value) return null
  try { return ['https:', 'conductor:'].includes(new URL(value).protocol) ? value : null } catch { return null }
}

function ShieldIcon() { return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3 4.5 6v5.4c0 4.6 3.1 8.8 7.5 9.8 4.4-1 7.5-5.2 7.5-9.8V6L12 3Z"/><path d="m9 12 2 2 4-4"/></svg> }
function GitHubIcon() { return <svg aria-hidden="true" className="shrink-0 text-stone-500" width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .7a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.2.8-.5v-2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17 4.7 18 5 18 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.2c0 .3.2.6.8.5A11.5 11.5 0 0 0 12 .7Z"/></svg> }
function ArrowIcon() { return <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg> }
