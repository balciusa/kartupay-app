import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '../..')
const baseline = process.env.NEW_PROJECT_FORM_BASELINE === '1'
function source(path: string) {
  return baseline && /NewProjectForm.tsx|project\/new\/actions.ts/.test(path)
    ? execFileSync('git', ['show', `839d9565dc3613fee8359d57f0a6c2a33263f7c3:${path}`], { cwd: root, encoding: 'utf8' })
    : readFileSync(join(root, path), 'utf8')
}
function compile(path: string) {
  return ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: path,
  }).outputText
}
function fixture() {
  const writes: Array<{ table: string; values: Record<string, unknown> }> = []
  const modules: Record<string, unknown> = {}
  const load = (name: string): unknown => {
    if (modules[name]) return modules[name]
    if (!name.startsWith('@/')) return require(name)
    const exports = {}
    modules[name] = exports
    new Function('require', 'exports', compile(`src/${name.slice(2)}.ts`))(load, exports)
    return exports
  }
  modules['@/lib/supabaseServer'] = { getCurrentUserId: async () => 'test-user' }
  modules['@/lib/activityLog'] = { recordProjectActivity: async () => {} }
  modules['next/cache'] = { revalidatePath: () => {} }
  modules['next/navigation'] = { redirect: (url: string) => { throw Object.assign(new Error('redirect'), { digest: `NEXT_REDIRECT;replace;${url};307;` }) } }
  modules['@/lib/supabaseAdmin'] = { supabaseAdmin: { from(table: string) {
    let values: Record<string, unknown> = {}
    const q = {
      insert(v: Record<string, unknown>) { values = v; writes.push({ table, values }); return q },
      update() { return q }, select() { return q }, eq() { return q }, single() { return q },
      then(done: (v: unknown) => void) { done({ data: table === 'projects' || table === 'participants' ? { id: `test-${table}` } : [], error: null }) },
    }
    return q
  } } }
  const actions = load('@/app/project/new/actions') as typeof import('../app/project/new/actions')
  return { actions, writes }
}
function form(mode: string | null = 'selecting') {
  const data = new FormData()
  for (const [k, v] of Object.entries({ title: 'Weekend trip', description: 'Keep my description', visibility: 'public', finance_mode: 'none', date_voting_deadline_date: '2099-05-01', date_option_start_date: '2099-06-01', date_option_end_date: '2099-06-03' })) data.set(k, v)
  if (mode !== null) data.set('date_mode', mode)
  return data
}

test('server independently validates modes, participants, dates, deadline and duplicates; redirects on success', async () => {
  if (baseline) return
  for (const mode of [null, '', 'invalid']) {
    const f = fixture()
    assert.equal((await f.actions.createProjectWithState({ error: null }, form(mode))).error, 'Choose how the project date will be decided.')
    assert.equal(f.writes.length, 0)
  }
  for (const start of ['', '2099-06-01']) {
    const f = fixture(); const data = form('fixed'); data.set('event_start_date', start)
    assert.match((await f.actions.createProjectWithState({ error: null }, data)).error!, /fixed project needs/)
    assert.equal(f.writes.length, 0)
  }
  for (const mutation of [
    (d: FormData) => { d.set('min_participants', '10'); d.set('max_participants', '2') },
    (d: FormData) => d.set('date_voting_deadline_date', '2000-01-01'),
    (d: FormData) => { d.append('date_option_start_date', '2099-06-01'); d.append('date_option_end_date', '2099-06-03') },
  ]) {
    const f = fixture(); const data = form(); mutation(data)
    assert.ok((await f.actions.createProjectWithState({ error: null }, data)).error)
    assert.equal(f.writes.length, 0)
  }
  for (const mode of ['fixed', 'selecting']) {
    const f = fixture(); const data = form(mode)
    if (mode === 'fixed') { data.set('event_start_date', '2099-06-01'); data.set('event_start_time', '10:00') }
    await assert.rejects(f.actions.createProjectWithState({ error: null }, data), (e: unknown) => String((e as { digest: string }).digest).includes('NEXT_REDIRECT;replace;/project/test-projects;'))
    assert.equal(f.writes[0].values.date_mode, mode)
  }
})

// Bundle the actual component and installed React without adding a test dependency.
function browserBundle() {
  const codes: Record<string, string> = {
    '@/app/project/new/actions': `exports.createProjectWithState = async (_, data) => { window.submissions.push([...data]); const r = await fetch('/submit', {method:'POST',body:JSON.stringify([...data])}).then(r=>r.json()); if(r.redirect) window.redirected=r.redirect; return {error:r.error || null}; };`,
    '@/components/ui/button': `exports.Button = ({variant, ...props}) => require('react').createElement('button', props);`,
    entry: `const {createRoot} = require('react-dom/client'); const React=require('react'); window.submissions=[]; createRoot(document.getElementById('root')).render(React.createElement(require('@/components/Project/NewProjectForm').NewProjectForm));`,
  }
  const visit = (name: string) => {
    if (codes[name]) return
    const path = name.startsWith('@/') ? `src/${name.slice(2)}${name.includes('NewProjectForm') ? '.tsx' : '.ts'}` : require.resolve(name)
    codes[name] = name.startsWith('@/') ? compile(path) : readFileSync(path, 'utf8')
    codes[name] = codes[name].replace(/require\(['"]([^'"]+)['"]\)/g, (_match, dep: string) => {
      const id = dep.startsWith('.') ? require.resolve(resolve(path, '..', dep)) : dep
      visit(id)
      return `require(${JSON.stringify(id)})`
    })
  }
  visit('react'); visit('react-dom/client'); visit('@/components/Project/NewProjectForm')
  return `const process={env:{NODE_ENV:'development'}}; const modules={${Object.entries(codes).map(([id, code]) => `${JSON.stringify(id)}:function(require,module,exports){${code}\n}`).join(',')}}; const cache={}; function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](require,m,m.exports);return m.exports;}require('entry');`
}

test('real React form in browser preserves the entire draft after server and client failures', { timeout: 120000 }, async t => {
  const executable = process.env.NEW_PROJECT_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  if (!process.env.NEW_PROJECT_TEST_BROWSER && process.platform !== 'win32') {
    t.skip('Set NEW_PROJECT_TEST_BROWSER to a Chromium executable for the DOM regression'); return
  }
  const f = fixture()
  const bundle = browserBundle()
  const server = createServer(async (req, res) => {
    if (req.url === '/submit') {
      let body = ''; for await (const chunk of req) body += chunk
      const data = new FormData(); for (const [k, v] of JSON.parse(body)) data.append(k, v)
      try { res.end(JSON.stringify(await f.actions.createProjectWithState({ error: null }, data))) }
      catch (e) { res.end(JSON.stringify({ redirect: (e as { digest: string }).digest })) }
    } else if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle) }
    else { res.end('<!doctype html><html><head><title>New Project draft regression</title></head><body><main id="root"></main><script src="/bundle.js"></script></body></html>') }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const profile = mkdtempSync(join(tmpdir(), 'new-project-form-test-'))
  const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'pipe' })
  let ws: WebSocket | undefined
  try {
    let endpoint = ''
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        const [debugPort, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/)
        endpoint = `ws://127.0.0.1:${debugPort}${path}`
        break
      } catch { await new Promise(r => setTimeout(r, 50)) }
    }
    assert.ok(endpoint, 'Browser must expose its local debugging endpoint')
    console.log('Browser endpoint ready')
    ws = new WebSocket(endpoint)
    await new Promise<void>((r, reject) => { const timer = setTimeout(() => reject(new Error('Browser websocket timeout')), 10000); ws!.addEventListener('open', () => { clearTimeout(timer); r() }, { once: true }); ws!.addEventListener('error', reject, { once: true }) })
    console.log('Browser connected')
    let id = 0
    const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: unknown) => void }>()
    ws.addEventListener('message', event => { const msg = JSON.parse(String(event.data)); const p = pending.get(msg.id); if (p) { pending.delete(msg.id); if (msg.error) p.reject(msg.error); else p.resolve(msg.result) } })
    const send = (method: string, params = {}, sessionId?: string) => new Promise<Record<string, unknown>>((resolve, reject) => { pending.set(++id, { resolve, reject }); ws!.send(JSON.stringify({ id, method, params, sessionId })) })
    const target = await send('Target.createTarget', { url: `http://127.0.0.1:${port}` })
    const session = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
    const evaluate = async (expression: string) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session.sessionId as string)
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
      return (r.result as { value: unknown }).value
    }
    const wait = async (expression: string) => {
      for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 25)) }
      throw new Error(`Timed out: ${expression}`)
    }
    console.log('Browser target attached')
    await wait('!!document.querySelector("form")')
    console.log('Form mounted')
    await evaluate(`window.fill=(name,value,index=0)=>{const el=document.getElementsByName(name)[index];Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};window.draft=()=>JSON.stringify([...new FormData(document.querySelector('form'))]);window.submit=()=>document.querySelector('form').requestSubmit();`)
    await evaluate(`fill('title','Weekend trip');fill('description','Detailed description stays exactly as entered.');document.querySelector('[name=visibility][value=public]').click();document.querySelector('[name=finance_mode][value=managed]').click();document.querySelector('[name=date_mode][value=selecting]').click();fill('min_participants','3');fill('max_participants','12');fill('event_location_label','Test venue');fill('event_location_address','Test address');`)
    await wait('!!document.querySelector("[name=totalEur]")')
    await evaluate(`fill('totalEur','25,50');document.querySelector('[name=total_is_per_person][value=true]').click();`)
    await wait('!!document.querySelector("input[type=checkbox]")')
    await evaluate(`document.querySelector('input[type=checkbox]').click();Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Add another')).click();`)
    await wait('document.getElementsByName("date_option_start_date").length===2')
    await evaluate(`fill('date_voting_deadline_date','2000-01-01');fill('date_option_start_date','2099-06-01',0);fill('date_option_end_date','2099-06-03',0);fill('date_option_start_date','2099-07-01',1);fill('date_option_end_date','2099-07-04',1);window.before=draft();submit();`)
    await wait(`document.body.textContent.includes('Date voting deadline must be more than') && !document.querySelector('[type=submit]').disabled`)
    assert.equal(await evaluate('submissions[0].find(([k])=>k==="date_mode")[1]'), 'selecting')
    if (baseline) {
      assert.equal(await evaluate('document.querySelector("[name=title]").value'), '')
      assert.equal(await evaluate('new FormData(document.querySelector("form")).get("date_mode")'), 'fixed')
      assert.equal(await evaluate('!!document.querySelector("[name=date_voting_deadline_date]") && !document.querySelector("[name=event_start_date]")'), true)
      await evaluate(`fill('title','Weekend trip');fill('totalEur','25');fill('date_voting_deadline_date','2099-05-01');fill('date_option_start_date','2099-06-01',0);fill('date_option_start_date','2099-07-01',1);submit();`)
      await wait(`document.body.textContent.includes('A fixed project needs a confirmed start date and time')`)
      console.log('BASELINE REPRODUCED: returned server error resets title and date radio to fixed while selecting fields remain visible; retry triggers misleading fixed-date error.')
      return
    }
    assert.equal(await evaluate('draft()===before'), true, 'server failure preserves every FormData entry, including dynamic ranges and finance values')
    assert.equal(await evaluate('document.getElementsByName("date_option_start_date").length'), 2)
    assert.equal(await evaluate('document.activeElement.hasAttribute("data-creation-error")'), true)
    // Correct only the rejected deadline; successful server action still redirects.
    await evaluate(`fill('date_voting_deadline_date','2099-05-01');submit();`)
    await wait('!!window.redirected')
    assert.match(String(await evaluate('window.redirected')), /NEXT_REDIRECT;replace;\/project\/test-projects;/)
    assert.equal(await evaluate('submissions[1].find(([k])=>k==="date_mode")[1]'), 'selecting')
    await evaluate(`fill('max_participants','2');window.before=draft();submit();`)
    await wait(`document.body.textContent.includes('Max participants must be greater')`)
    assert.equal(await evaluate('draft()===before && submissions.length===2'), true)
    await evaluate(`fill('max_participants','12');fill('date_option_start_date','2099-06-01',1);fill('date_option_end_date','2099-06-03',1);window.before=draft();submit();`)
    await wait(`document.body.textContent.includes('same date option')`)
    assert.equal(await evaluate('draft()===before && submissions.length===2'), true)
    await evaluate(`document.querySelector('[name=date_mode][value=fixed]').click();`)
    await wait('!!document.querySelector("[name=event_start_date]")')
    await evaluate(`fill('event_start_date','2099-08-01');fill('event_start_time','10:00');fill('event_end_date','2099-07-31');fill('event_end_time','11:00');window.before=draft();submit();`)
    await wait(`document.body.textContent.includes('Event end must be after')`)
    assert.equal(await evaluate('draft()===before && submissions.length===2'), true)
    // Bypass HTML required validation: the handler also catches a missing fixed start.
    await evaluate(`fill('event_start_date','');document.querySelector('form').noValidate=true;submit();`)
    await wait(`document.body.textContent.includes('fixed project needs')`)
    await evaluate(`fill('event_start_date','2099-08-01');fill('event_end_date','2099-08-02');fill('title','ab');window.before=draft();submit();`)
    await wait(`document.body.textContent.includes('Invalid form:') && !document.querySelector('[type=submit]').disabled`)
    assert.equal(await evaluate('draft()===before'), true, 'fixed dates/times survive server validation')
    console.log('BROWSER PASS: selecting payload; full draft/ranges/bundle/location preservation; fix-only-deadline redirect; client participant/duplicate/end errors; fixed server failure preservation.')
  } finally {
    ws?.close(); browser.kill(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()))
  }
})
