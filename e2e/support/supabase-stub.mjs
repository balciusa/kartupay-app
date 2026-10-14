import { createServer } from 'node:http'

const host = '127.0.0.1'
const port = 54321
const userId = '00000000-0000-4000-8000-000000000001'
const projectId = '00000000-0000-4000-8000-000000000002'
const participantId = '00000000-0000-4000-8000-000000000003'
const collectorParticipantId = '00000000-0000-4000-8000-000000000004'
const tokenPayload = Buffer.from(JSON.stringify({
  sub: userId,
  email: 'member@example.test',
  role: 'authenticated',
  aud: 'authenticated',
  exp: 4_102_444_800,
})).toString('base64url')
const accessToken = `e2e.${tokenPayload}.signature`
const testUser = {
  id: userId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'member@example.test',
  email_confirmed_at: '2026-01-01T00:00:00.000Z',
  phone: '',
  confirmed_at: '2026-01-01T00:00:00.000Z',
  last_sign_in_at: '2026-01-01T00:00:00.000Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}
const project = {
  id: projectId,
  title: 'Private browser regression project',
  description: 'Invite-safe project description',
  status: 'pending',
  canceled_at: null,
  event_start_at: null,
  event_end_at: null,
  is_public: false,
  closed_at: null,
  aborted_at: null,
  finalized_at: null,
  event_location_label: null,
  finance_mode: 'managed',
  total_cents: 10000,
  total_is_per_person: false,
  min_participants: 1,
  max_participants: null,
  collector_participant_id: collectorParticipantId,
  bundle_size: null,
  bundle_pay_for: null,
  event_location_address: null,
  event_location_lat: null,
  event_location_lng: null,
  event_location_place_id: null,
  date_mode: 'fixed',
  date_voting_deadline_at: null,
  date_suggestions_close_at: null,
  date_selection_status: 'confirmed',
  selected_date_option_id: null,
  confirmation_deadline_at: null,
  transport_enabled: false,
  event_duration_nights: null,
}
const participant = {
  id: participantId,
  project_id: projectId,
  user_id: userId,
  role: 'organizer',
  short_code: 'ORG001',
  joined_at: '2026-01-01T00:00:00.000Z',
  left_at: null,
  attendance_status: 'confirmed',
  users: { email: testUser.email, display_name: 'Private Member' },
}
const collectorParticipant = {
  id: collectorParticipantId,
  project_id: projectId,
  user_id: '00000000-0000-4000-8000-000000000005',
  role: 'organizer',
  short_code: 'COL001',
  joined_at: '2026-01-01T00:00:00.000Z',
  left_at: null,
  attendance_status: 'confirmed',
  users: { email: 'collector@example.test', display_name: 'Test Collector' },
}
const countedPayment = {
  id: '00000000-0000-4000-8000-000000000006',
  participant_id: participantId,
  is_counted: true,
  amount_cents: 5000,
  marked_received_at: '2026-01-02T00:00:00.000Z',
  created_by: collectorParticipant.user_id,
  created_at: '2026-01-02T00:00:00.000Z',
}
const refundRequest = {
  id: '00000000-0000-4000-8000-000000000007',
  project_id: projectId,
  participant_id: participantId,
  collector_participant_id: collectorParticipantId,
  requested_by_participant_id: participantId,
  base_amount_cents: 5000,
  extras_amount_cents: 0,
  late_transfer_amount_cents: 0,
  total_amount_cents: 5000,
  status: 'sent',
  requested_at: '2026-01-03T00:00:00.000Z',
  decided_at: '2026-01-03T01:00:00.000Z',
  decided_by_participant_id: collectorParticipantId,
  collector_marked_sent_at: '2026-01-03T02:00:00.000Z',
  participant_confirmed_at: null,
  completed_at: null,
  rejection_reason: null,
  created_at: '2026-01-03T00:00:00.000Z',
  updated_at: '2026-01-03T02:00:00.000Z',
}
let participantActive = true

const json = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(body === undefined ? undefined : JSON.stringify(body))
}

const hasSession = request => request.headers.authorization?.includes(accessToken)

const rowsForTable = table => {
  if (table === 'projects') return [project]
  if (table === 'participants') return [
    { ...participant, left_at: participantActive ? null : '2026-01-04T00:00:00.000Z' },
    collectorParticipant,
  ]
  if (table === 'payments') return [countedPayment]
  if (table === 'participant_refund_requests') return [refundRequest]
  return []
}

const parseBody = request => new Promise((resolve, reject) => {
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    try { resolve(body ? JSON.parse(body) : {}) } catch (error) { reject(error) }
  })
})

const applyFilters = (rows, url) => rows.filter(row => {
  for (const [key, raw] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue
    if (raw === 'is.null' && row[key] !== null) return false
    if (raw.startsWith('eq.') && String(row[key]) !== decodeURIComponent(raw.slice(3))) return false
    if (raw.startsWith('neq.') && String(row[key]) === decodeURIComponent(raw.slice(4))) return false
  }
  return true
})

const restResponse = async (request, response, table, url) => {
  let rows = applyFilters(rowsForTable(table), url)
  const wantsObject = String(request.headers.accept ?? '').includes('application/vnd.pgrst.object+json')

  if (request.method === 'PATCH') {
    const values = await parseBody(request)
    if (table === 'participant_refund_requests' && rows.some(row => row.id === refundRequest.id)) {
      await new Promise(resolve => setTimeout(resolve, 250))
      Object.assign(refundRequest, values)
      rows = [refundRequest]
    }
    if (table === 'participants' && rows.some(row => row.id === participant.id) && values.left_at) {
      participantActive = false
      rows = [{ ...participant, left_at: values.left_at }]
    }
    json(response, 200, wantsObject ? (rows[0] ?? null) : rows)
    return
  }

  if (request.method === 'POST') {
    await parseBody(request)
    json(response, 201, wantsObject ? (rows[0] ?? {}) : rows)
    return
  }

  const body = wantsObject ? (rows[0] ?? null) : rows
  const range = rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0'

  if (request.method === 'HEAD') {
    response.writeHead(200, { 'Content-Range': range, 'Content-Type': 'application/json' })
    response.end()
    return
  }

  json(response, 200, body, { 'Content-Range': range })
}

const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', 'http://' + host + ':' + port)

  if (url.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('ok')
    return
  }

  if (url.pathname === '/auth/v1/user') {
    if (hasSession(request)) {
      json(response, 200, testUser)
    } else {
      json(response, 401, { message: 'No test session' })
    }
    return
  }

  if (url.pathname === '/auth/v1/token' && request.method === 'POST') {
    participantActive = true
    Object.assign(refundRequest, {
      status: 'sent',
      participant_confirmed_at: null,
      completed_at: null,
      updated_at: '2026-01-03T02:00:00.000Z',
    })
    json(response, 200, {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 2_147_483_647,
      expires_at: 4_102_444_800,
      refresh_token: 'e2e-refresh-token',
      user: testUser,
    })
    return
  }

  if (url.pathname === '/auth/v1/logout' && request.method === 'POST') {
    setTimeout(() => {
      response.writeHead(204)
      response.end()
    }, 500)
    return
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    void restResponse(request, response, url.pathname.slice('/rest/v1/'.length), url)
    return
  }

  response.writeHead(404, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ message: 'Not found' }))
})

server.listen(port, host, () => {
  console.log('Local Supabase smoke stub listening at http://' + host + ':' + port)
})

const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
