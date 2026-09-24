import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildProjectShareUrl,
  getProjectShareStrings,
  performProjectShare,
  shouldShowProjectShare,
} from './projectShare.ts'

const nodeRequire = createRequire(import.meta.url)
const pageSource = readFileSync(new URL('../app/project/[id]/page.tsx', import.meta.url), 'utf8')
const componentSource = readFileSync(new URL('../components/Project/ShareProjectButton.tsx', import.meta.url), 'utf8')
const componentCode = ts.transpileModule(componentSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  fileName: 'ShareProjectButton.tsx',
}).outputText

const componentExports = {} as {
  ShareProjectButton: typeof import('../components/Project/ShareProjectButton').ShareProjectButton
}
new Function('require', 'exports', componentCode)((name: string) => {
  if (name === '@/components/ui/button') {
    return {
      Button: ({ variant, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => {
        void variant
        return createElement('button', props, children)
      },
    }
  }
  if (name === '@/lib/projectShare') return nodeRequire('./projectShare.ts')
  return nodeRequire(name)
}, componentExports)

const visible = (overrides: Partial<Parameters<typeof shouldShowProjectShare>[0]> = {}) => shouldShowProjectShare({
  isActiveParticipant: true,
  isCanceled: false,
  isFinalized: false,
  ...overrides,
})

for (const role of ['organizer', 'collector', 'ordinary participant']) {
  test(`active ${role} sees Share project`, () => assert.equal(visible(), true))
}

test('nonparticipant and pending join requester do not see Share project', () => {
  assert.equal(visible({ isActiveParticipant: false }), false)
})

test('canceled and finalized projects do not show Share project', () => {
  assert.equal(visible({ isCanceled: true }), false)
  assert.equal(visible({ isFinalized: true }), false)
})

test('canonical URL ignores current paths, query parameters, and fragments', () => {
  assert.equal(
    buildProjectShareUrl('https://example.com/current?tab=admin#requests', 'project id'),
    'https://example.com/project/project%20id'
  )
})

test('native share receives only the project title and canonical URL', async () => {
  const calls: ShareData[] = []
  const result = await performProjectShare({
    projectId: 'abc',
    projectTitle: 'Autumn trip',
    origin: 'https://example.com',
    nativeShare: async data => { calls.push(data) },
    writeClipboard: async () => { throw new Error('Clipboard should not run') },
  })
  assert.equal(result, 'shared')
  assert.deepEqual(calls, [{ title: 'Autumn trip', url: 'https://example.com/project/abc' }])
})

test('clipboard fallback copies the canonical URL and reports success', async () => {
  const copied: string[] = []
  const result = await performProjectShare({
    projectId: 'abc',
    projectTitle: 'Autumn trip',
    origin: 'https://example.com',
    writeClipboard: async value => { copied.push(value) },
  })
  assert.equal(result, 'copied')
  assert.deepEqual(copied, ['https://example.com/project/abc'])
})

test('share cancellation is quiet while real share failures fall back to clipboard', async () => {
  assert.equal(await performProjectShare({
    projectId: 'abc', projectTitle: 'Trip', origin: 'https://example.com',
    nativeShare: async () => { throw { name: 'AbortError' } },
  }), 'canceled')
  const copied: string[] = []
  assert.equal(await performProjectShare({
    projectId: 'abc', projectTitle: 'Trip', origin: 'https://example.com',
    nativeShare: async () => { throw new Error('Share failed') },
    writeClipboard: async value => { copied.push(value) },
  }), 'copied')
  assert.deepEqual(copied, ['https://example.com/project/abc'])
  assert.equal(await performProjectShare({
    projectId: 'abc', projectTitle: 'Trip', origin: 'https://example.com',
    nativeShare: async () => { throw new Error('Share failed') },
  }), 'failed')
  assert.equal(await performProjectShare({
    projectId: 'abc', projectTitle: 'Trip', origin: 'https://example.com',
    writeClipboard: async () => { throw new Error('Copy failed') },
  }), 'failed')
})

test('English and Lithuanian copy render without mixed labels', () => {
  const en = renderToStaticMarkup(createElement(componentExports.ShareProjectButton, {
    projectId: 'abc', projectTitle: 'Trip', locale: 'en',
  }))
  const lt = renderToStaticMarkup(createElement(componentExports.ShareProjectButton, {
    projectId: 'abc', projectTitle: 'Trip', locale: 'lt',
  }))
  assert.match(en, />Share project<\/button>/)
  assert.doesNotMatch(en, /Dalintis projektu/)
  assert.match(lt, />Dalintis projektu<\/button>/)
  assert.doesNotMatch(lt, /Share project/)
  assert.deepEqual(getProjectShareStrings('lt'), {
    shareProject: 'Dalintis projektu',
    linkCopied: 'Nuoroda nukopijuota',
    copyFailed: 'Nepavyko nukopijuoti nuorodos',
  })
})

test('button is accessible and header keeps Share plus Leave mobile-safe', () => {
  const html = renderToStaticMarkup(createElement(componentExports.ShareProjectButton, {
    projectId: 'abc', projectTitle: 'Trip', locale: 'en',
  }))
  assert.match(html, /type="button"/)
  assert.match(html, /aria-label="Share project"/)
  assert.match(pageSource, /flex flex-wrap items-start justify-end gap-2/)
  assert.match(pageSource, /<ShareProjectButton[\s\S]*<LeaveProjectButton/)
})
