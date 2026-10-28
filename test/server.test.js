// Drives server.js over stdio exactly as an MCP client would, against a stub
// HTTP server that stands in for crud-app. Needs no Docker, Postgres or network.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js')

const seen = []
const stub = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, body })
    if (req.method === 'GET' && req.url === '/users') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify([{ id: 1, name: 'Marcia', email: 'marcia@example.edu' }]))
    }
    if (req.method === 'GET' && req.url === '/users/99') {
      res.writeHead(404, { 'content-type': 'text/html' })
      return res.end('User cannot be retrieved as that ID does not exist.')
    }
    if (req.method === 'POST' && req.url === '/users') {
      res.writeHead(201, { 'content-type': 'text/html' })
      return res.end('User added with ID: 7')
    }
    if (req.method === 'PUT' && req.url === '/users/1') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('User email updated with ID: 1')
    }
    if (req.method === 'DELETE' && req.url === '/users/1') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('User deleted with ID: 1')
    }
    res.writeHead(500); res.end('unexpected')
  })
})

let client
before(async () => {
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
  const apiUrl = `http://127.0.0.1:${stub.address().port}`
  client = new Client({ name: 'crud-mcp-test', version: '0.0.0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, CRUD_API_URL: apiUrl },
    stderr: 'ignore'
  }))
})
after(async () => {
  await client?.close()
  await new Promise((resolve) => stub.close(resolve))
})

test('exposes the five users tools', async () => {
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), ['create_user', 'delete_user', 'get_user', 'list_users', 'update_user'])
  assert.equal(tools.find((t) => t.name === 'delete_user').annotations.destructiveHint, true)
})

test('list_users calls GET /users and returns the rows', async () => {
  const r = await client.callTool({ name: 'list_users', arguments: {} })
  assert.equal(r.isError, undefined)
  assert.match(r.content[0].text, /Marcia/)
  assert.deepEqual(r.structuredContent.users[0].id, 1)
})

test('get_user surfaces the API 404 as an error result', async () => {
  const r = await client.callTool({ name: 'get_user', arguments: { id: 99 } })
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, /404.*does not exist/)
})

test('create_user posts JSON and returns the new id', async () => {
  const r = await client.callTool({ name: 'create_user', arguments: { name: 'Ada', email: 'ada@example.org' } })
  assert.equal(r.isError, undefined)
  assert.match(r.content[0].text, /ID: 7/)
  const post = seen.find((s) => s.method === 'POST')
  assert.deepEqual(JSON.parse(post.body), { name: 'Ada', email: 'ada@example.org' })
})

test('update_user without fields is rejected before any HTTP call', async () => {
  const puts = seen.filter((s) => s.method === 'PUT').length
  const r = await client.callTool({ name: 'update_user', arguments: { id: 1 } })
  assert.equal(r.isError, true)
  assert.equal(seen.filter((s) => s.method === 'PUT').length, puts)
})

test('update_user and delete_user hit the right paths', async () => {
  const u = await client.callTool({ name: 'update_user', arguments: { id: 1, email: 'new@example.org' } })
  assert.match(u.content[0].text, /email updated/)
  const d = await client.callTool({ name: 'delete_user', arguments: { id: 1 } })
  assert.match(d.content[0].text, /deleted/)
})

test('input validation rejects a bad id', async () => {
  const r = await client.callTool({ name: 'get_user', arguments: { id: -3 } })
  assert.equal(r.isError, true)
})
