import { describe, expect, it } from 'vitest'
import { normalizeGitHubRepositoryUrl } from '../server/url.js'

describe('normalizeGitHubRepositoryUrl', () => {
  it.each([
    ['https://github.com/owner/repo', 'https://github.com/owner/repo'],
    [' https://github.com/owner/repo/ ', 'https://github.com/owner/repo'],
    ['https://github.com/owner/repo.git', 'https://github.com/owner/repo'],
    ['https://GITHUB.com/Owner/Repo.GIT/', 'https://github.com/owner/repo'],
  ])('normalizes %s', (input, expected) => expect(normalizeGitHubRepositoryUrl(input)).toBe(expected))

  it.each([
    'http://github.com/owner/repo',
    'https://user:pass@github.com/owner/repo',
    'https://github.com/owner/repo/tree/main',
    'https://github.com/owner/repo?tab=readme',
    'https://github.com/owner/repo#readme',
    'https://github.com.evil.test/owner/repo',
    'https://github.com/owner',
    'https://github.com/owner/repo/extra',
    'https://github.com/owner_name/repo',
    'https://github.com/-owner/repo',
    'https://github.com//owner/repo',
    'not a url',
  ])('rejects %s', (input) => expect(() => normalizeGitHubRepositoryUrl(input)).toThrow())
})
