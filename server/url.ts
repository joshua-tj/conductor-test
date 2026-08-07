const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}$/

export class InvalidRepositoryUrlError extends Error {}

export function normalizeGitHubRepositoryUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 500) {
    throw new InvalidRepositoryUrlError('Enter a valid GitHub repository URL.')
  }

  const trimmed = input.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new InvalidRepositoryUrlError('Enter a valid GitHub repository URL.')
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'github.com' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    trimmed.includes('?') ||
    trimmed.includes('#')
  ) {
    throw new InvalidRepositoryUrlError('Use an ordinary https://github.com/owner/repo URL.')
  }

  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/)
  if (!match) {
    throw new InvalidRepositoryUrlError('The URL must point directly to a repository.')
  }

  const owner = match[1]
  const repo = match[2].replace(/\.git$/i, '')
  if (!OWNER.test(owner) || !REPOSITORY.test(repo) || repo === '.' || repo === '..') {
    throw new InvalidRepositoryUrlError('The repository owner or name is malformed.')
  }

  return `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`
}
