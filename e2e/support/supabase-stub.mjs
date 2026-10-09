import { createServer } from 'node:http'

const host = '127.0.0.1'
const port = 54321

const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')

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
    response.writeHead(401, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ message: 'No test session' }))
    return
  }

  if (url.pathname === '/rest/v1/projects') {
    response.writeHead(200, {
      'Content-Range': '*/0',
      'Content-Type': 'application/json',
    })
    response.end('[]')
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
