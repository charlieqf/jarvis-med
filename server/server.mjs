// Jarvis server: static site + live answer planning (DESIGN §8).
//
//   GET  /                      static web app (web/dist)
//   GET  /api/health            status, content version, whether model auth is configured
//   POST /api/ask               {question} + header x-access-code  -> {jobId}
//   GET  /api/job/:id?after=n   {events, done}      (polling: robust through tunnels, no SSE needed)
//   POST /api/cancel/:id
//
// Provider "claude-code": runs `claude -p` headless with every local capability disabled
// (no tools, no MCP, no settings sources, empty cwd, no session persistence), parses its
// stream-json event stream, cuts the model's text into NDJSON plan lines, and sends each step
// to pipeline/plan_worker.py for compilation. Only compiled steps reach the browser.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const CFG = {
  port: +(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',
  dist: process.env.JARVIS_DIST || join(ROOT, 'web', 'dist'),
  caseDir: process.env.JARVIS_CASE || join(ROOT, 'cases', 'case1'),
  python: process.env.PYTHON || 'python3',
  claude: process.env.CLAUDE_BIN || join(homedir(), '.local', 'bin', 'claude'),
  model: process.env.JARVIS_MODEL || 'opus',
  effort: process.env.JARVIS_EFFORT || 'low',
  firstTimeoutMs: 60_000,
  totalTimeoutMs: 180_000,
}
const JDIR = join(homedir(), '.jarvis')

function loadEnvFile() {
  const p = join(JDIR, 'env')
  if (!existsSync(p)) return {}
  return Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
}
function accessCode() {
  const p = join(JDIR, 'access_code')
  if (!existsSync(p)) { mkdirSync(JDIR, { recursive: true }); writeFileSync(p, randomBytes(4).toString('hex') + '\n', { mode: 0o600 }) }
  return readFileSync(p, 'utf8').trim()
}

// ------------------------------------------------------------------ system prompt
const SANDBOX = join(JDIR, 'sandbox')
mkdirSync(SANDBOX, { recursive: true })
const PROMPT_FILE = join(JDIR, 'system-prompt.md')
function buildPrompt() {
  const tpl = readFileSync(join(ROOT, 'server', 'prompt.md'), 'utf8')
  const catalog = readFileSync(join(CFG.caseDir, 'catalog.txt'), 'utf8')
  writeFileSync(PROMPT_FILE, tpl.replace('{{CATALOG}}', catalog))
  return catalog.match(/^# content_version (\w+)/)?.[1]
}
let CONTENT_VERSION = buildPrompt()

// ------------------------------------------------------------------ jobs
const jobs = new Map()
let current = null

function newJob(question) {
  const job = { id: randomBytes(5).toString('hex'), question, events: [], done: false, t0: Date.now(), procs: [], passed: 0, rejected: [] }
  job.push = (kind, text, data, status) => job.events.push({ n: job.events.length, t: Date.now() - job.t0, kind, text, data, status })
  jobs.set(job.id, job)
  if (jobs.size > 30) jobs.delete(jobs.keys().next().value)
  return job
}

function finish(job, status, text) {
  if (job.done) return
  job.done = true
  for (const p of job.procs) { try { p.kill('SIGTERM'); setTimeout(() => { try { p.kill('SIGKILL') } catch {} }, 2000) } catch {} }
  job.push('done', text ?? `回答结束：通过 ${job.passed} 步，拒绝 ${job.rejected.length} 步，用时 ${((Date.now() - job.t0) / 1000).toFixed(1)}s`, undefined, status)
}

function startWorker(job) {
  const w = spawn(CFG.python, [join(ROOT, 'pipeline', 'plan_worker.py'), CFG.caseDir], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  job.procs.push(w)
  const waiting = []
  let buf = ''
  w.stdout.on('data', d => {
    buf += d.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (line.trim()) waiting.shift()?.(JSON.parse(line))
    }
  })
  w.stderr.on('data', d => job.push('worker', `校验器输出：${d.toString().slice(0, 300)}`, undefined, 'reject'))
  const ask = msg => new Promise(res => { waiting.push(res); w.stdin.write(JSON.stringify(msg) + '\n') })
  return ask
}

async function runJob(job) {
  const env = { ...process.env, ...loadEnvFile() }
  if (!env.CLAUDE_CODE_OAUTH_TOKEN && !env.ANTHROPIC_API_KEY) {
    job.push('error', '模型未授权：Mac mini 上还没有配置 ~/.jarvis/env（CLAUDE_CODE_OAUTH_TOKEN）', undefined, 'reject')
    return finish(job, 'reject', '无法调用模型')
  }
  const ask = startWorker(job)
  const ready = await ask({ type: 'hello' })
  job.push('version', `校验器就绪，数据版本 ${ready.content_version}`, ready, ready.content_version === CONTENT_VERSION ? 'pass' : 'reject')

  const pending = []
  let seq = 0
  const rejectedSteps = []

  const handleLine = line => {
    line = line.trim().replace(/^```(json)?|```$/g, '').trim()
    if (!line) return
    let msg
    try { msg = JSON.parse(line) } catch { job.push('parse', `无法解析的一行（已丢弃）：${line.slice(0, 120)}`, undefined, 'reject'); return }
    if (msg.type === 'meta') job.push('plan', `回答计划：${msg.title ?? ''}`, msg)
    else if (msg.type === 'step' && msg.step) {
      const n = seq++
      job.push('plan', `收到第 ${n + 1} 步计划「${msg.step.title ?? ''}」，送校验`, msg.step)
      pending.push(ask({ type: 'step', plan_id: `L${job.id.slice(0, 4)}`, seq: n, step: msg.step }).then(r => {
        if (job.done) return
        if (r.type === 'step_ok') {
          job.passed++
          for (const c of r.checks) job.push('check', `${c.claim} [${c.type}] 引用 ${c.cite.join(', ')} → 通过${c.flags.length ? '；标记：' + c.flags.join('、') : ''}`, c, 'pass')
          job.push('step', `第 ${n + 1} 步通过校验，推送到舞台`, r.step, 'pass')
        } else {
          job.rejected.push(r.error)
          rejectedSteps.push({ step: msg.step, error: r.error })
          job.push('reject', `第 ${n + 1} 步被拒绝：${r.error}`, msg.step, 'reject')
        }
      }))
    } else if (msg.type === 'not_in_source') {
      pending.push(ask({ type: 'not_in_source', nearest: msg.nearest ?? [] }).then(r => {
        job.push('not_in_source', `原稿中没有这个问题的答案：${msg.reason ?? ''}`, { ...msg, check: r.type }, r.type === 'nis_ok' ? 'pass' : 'reject')
      }))
    } else if (msg.type === 'end') job.push('plan', '模型声明计划结束')
  }

  const runModel = (userPrompt, label) => new Promise(resolve => {
    const args = ['-p', userPrompt, '--system-prompt-file', PROMPT_FILE,
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence',
      '--model', CFG.model, '--effort', CFG.effort]
    const t0 = Date.now()
    job.push('model', `${label}：启动模型（claude-code，模型 ${CFG.model}，工具 / MCP / 本地配置全部禁用）`, { args: args.filter((_, i) => i !== 1) })
    const proc = spawn(CFG.claude, args, { cwd: SANDBOX, env, stdio: ['ignore', 'pipe', 'pipe'] })
    job.procs.push(proc)
    let firstAt = null, lineBuf = '', evBuf = '', thinkChars = 0, lastThinkLog = 0, thinkTail = ''
    const firstTimer = setTimeout(() => { if (!firstAt) { job.push('timeout', `模型 ${CFG.firstTimeoutMs / 1000}s 内没有输出`, undefined, 'reject'); proc.kill('SIGTERM') } }, CFG.firstTimeoutMs)
    proc.stdout.on('data', d => {
      evBuf += d.toString('utf8')
      let i
      while ((i = evBuf.indexOf('\n')) >= 0) {
        const raw = evBuf.slice(0, i); evBuf = evBuf.slice(i + 1)
        if (!raw.trim()) continue
        let ev
        try { ev = JSON.parse(raw) } catch { continue }
        if (ev.type === 'system' && ev.subtype === 'init') job.push('model', `模型会话已建立（${ev.model ?? CFG.model}；可用工具 ${ev.tools?.length ?? 0} 个，MCP ${ev.mcp_servers?.length ?? 0} 个）`, { model: ev.model, tools: ev.tools, mcp_servers: ev.mcp_servers })
        if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta') {
          const e = ev.event
          if (!firstAt) { firstAt = Date.now(); job.push('model', `首个 token 到达：${((firstAt - t0) / 1000).toFixed(1)}s`, undefined, 'pass') }
          if (e.delta?.type === 'thinking_delta') {
            thinkChars += e.delta.thinking.length; thinkTail = (thinkTail + e.delta.thinking).slice(-160)
            if (Date.now() - lastThinkLog > 1500) { lastThinkLog = Date.now(); job.push('thinking', `模型思考中（已 ${thinkChars} 字）…${thinkTail.replace(/\s+/g, ' ')}`) }
          } else if (e.delta?.type === 'text_delta') {
            lineBuf += e.delta.text
            let j
            while ((j = lineBuf.indexOf('\n')) >= 0) { handleLine(lineBuf.slice(0, j)); lineBuf = lineBuf.slice(j + 1) }
          }
        }
        if (ev.type === 'result') {
          if (lineBuf.trim()) { handleLine(lineBuf); lineBuf = '' }
          const u = ev.usage ?? {}
          const inTok = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
          job.push('usage', `${label}完成：输入 ${inTok} tokens（其中缓存读取 ${u.cache_read_input_tokens ?? 0}、缓存写入 ${u.cache_creation_input_tokens ?? 0}），输出 ${u.output_tokens ?? '?'} tokens，模型耗时 ${(ev.duration_api_ms / 1000).toFixed(1)}s`, u)
          if (ev.is_error) job.push('error', `模型返回错误：${ev.result}`, undefined, 'reject')
        }
      }
    })
    proc.stderr.on('data', d => job.push('model', `模型 stderr：${d.toString().slice(0, 200)}`))
    proc.on('close', () => { clearTimeout(firstTimer); if (lineBuf.trim()) handleLine(lineBuf); resolve() })
  })

  const totalTimer = setTimeout(() => { job.push('timeout', `超过总时限 ${CFG.totalTimeoutMs / 1000}s`, undefined, 'reject'); finish(job, 'reject') }, CFG.totalTimeoutMs)
  await runModel(`用户问题：${job.question}
请按输出协议给出回答计划。`, '第 1 轮')
  await Promise.all(pending)
  // one repair round (DESIGN §6.3): feed the structured errors back, ask for replacement steps only
  if (!job.done && rejectedSteps.length) {
    const errs = rejectedSteps.map((r, i) => `被拒步骤 ${i + 1}：${JSON.stringify(r.step)}
错误：${r.error}`).join('\n\n')
    job.push('repair', `${rejectedSteps.length} 个步骤被拒绝，把错误反馈给模型重试一次（只生成替换步骤）`, rejectedSteps)
    rejectedSteps.length = 0
    await runModel(`用户问题：${job.question}

你之前输出的以下步骤未通过校验：
${errs}

请只输出修正后的替换步骤（同样的输出协议：step 行，最后 end 行），修正上述错误；不要重复已通过的内容。`, '修正轮')
    await Promise.all(pending)
  }
  clearTimeout(totalTimer)
  if (!job.done) finish(job, job.passed ? 'done' : 'reject', job.passed ? undefined : '没有通过校验的步骤')
}

// ------------------------------------------------------------------ http
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
const body = req => new Promise(r => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => { try { r(JSON.parse(b || '{}')) } catch { r({}) } }) })

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/api/health') {
    const env = loadEnvFile()
    return json(res, 200, { ok: true, content_version: CONTENT_VERSION, model_auth: !!(env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_API_KEY), provider: 'claude-code', model: CFG.model, busy: !!(current && !current.done) })
  }
  if (url.pathname === '/api/ask' && req.method === 'POST') {
    if (req.headers['x-access-code'] !== accessCode()) return json(res, 401, { error: '访问码不正确' })
    const { question } = await body(req)
    if (!question || typeof question !== 'string' || question.length > 300) return json(res, 400, { error: 'bad question' })
    if (current && !current.done) { current.push('cancel', '新问题到达，本回答取消；之后的输出将被丢弃', undefined, 'cancelled'); finish(current, 'cancelled', '已取消') }
    const job = newJob(question.trim())
    current = job
    job.push('input', `服务端收到问题：「${job.question}」`)
    runJob(job).catch(e => { job.push('error', String(e), undefined, 'reject'); finish(job, 'reject') })
    return json(res, 200, { jobId: job.id, content_version: CONTENT_VERSION })
  }
  let m
  if ((m = url.pathname.match(/^\/api\/job\/(\w+)$/))) {
    const job = jobs.get(m[1])
    if (!job) return json(res, 404, { error: 'no such job' })
    const after = +(url.searchParams.get('after') ?? -1)
    return json(res, 200, { events: job.events.filter(e => e.n > after), done: job.done })
  }
  if ((m = url.pathname.match(/^\/api\/cancel\/(\w+)$/)) && req.method === 'POST') {
    const job = jobs.get(m[1])
    if (job && !job.done) { job.push('cancel', '客户端取消', undefined, 'cancelled'); finish(job, 'cancelled', '已取消') }
    return json(res, 200, { ok: true })
  }
  // static
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
  if (p.includes('..')) return json(res, 400, { error: 'bad path' })
  let file = join(CFG.dist, p || 'index.html')
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(CFG.dist, 'index.html')
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': file.endsWith('.html') || file.endsWith('.json') ? 'no-cache' : 'max-age=3600' })
  res.end(readFileSync(file))
}).listen(CFG.port, CFG.host, () => {
  console.log(`jarvis server on http://${CFG.host}:${CFG.port}  dist=${CFG.dist}  case=${CFG.caseDir}  version=${CONTENT_VERSION}`)
  console.log(`access code file: ${join(JDIR, 'access_code')}`)
})
