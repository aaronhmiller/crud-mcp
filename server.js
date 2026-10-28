#!/usr/bin/env node
// MCP server for the crud-app users API.
//
// Exposes the five REST endpoints of crud-app as MCP tools over stdio, so an
// MCP client such as Claude Desktop or Claude Code can list, read, create,
// update and delete users by calling the running API. The server itself holds
// no data and never touches Postgres: every tool is one HTTP request to the
// API, which stays authoritative for validation and errors.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// Where the crud-app API is listening. `docker compose up` publishes it on
// port 80, so the default needs no configuration for the normal local setup.
const API_URL = (process.env.CRUD_API_URL || 'http://localhost').replace(/\/+$/, '')
const TIMEOUT_MS = 10_000

// Column widths from app/init.sql in crud-app: both columns are VARCHAR(30).
const NAME_MAX = 30
const EMAIL_MAX = 30

const id = z.number().int().positive().describe('The user id, a positive integer')
const name = z.string().trim().min(1).max(NAME_MAX).describe(`The user's name, up to ${NAME_MAX} characters`)
const email = z.string().trim().max(EMAIL_MAX).describe(`The user's email address, up to ${EMAIL_MAX} characters`)

// Calls the API and turns the response into an MCP tool result. Non-2xx
// responses become `isError` results that carry the API's own message, which
// is short and customer-safe by the API's conventions. Network failures
// become an `isError` result that says where the API was expected.
async function callApi (method, path, body) {
  const url = `${API_URL}${path}`
  let response
  try {
    response = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'timed out' : (error?.cause?.code || error?.message || 'failed')
    return errorResult(`Could not reach the crud-app API at ${API_URL} (${reason}). Is it running? Start it with \`docker compose up -d\` in the crud-app repo, or set CRUD_API_URL.`)
  }

  const text = await response.text()
  const isJson = (response.headers.get('content-type') || '').includes('application/json')
  let parsed
  if (isJson) {
    try { parsed = JSON.parse(text) } catch { parsed = undefined }
  }

  if (!response.ok) {
    const detail = parsed && typeof parsed === 'object' && parsed.message ? parsed.message : text
    return errorResult(`${method} ${path} returned ${response.status}: ${detail.trim() || response.statusText}`)
  }

  const pretty = parsed === undefined ? text.trim() : JSON.stringify(parsed, null, 2)
  const result = { content: [{ type: 'text', text: pretty }] }
  if (parsed !== undefined) result.structuredContent = Array.isArray(parsed) ? { users: parsed } : parsed
  return result
}

function errorResult (message) {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

const server = new McpServer({ name: 'crud-mcp', version: '0.1.0' })

server.registerTool('list_users', {
  title: 'List users',
  description: 'List every user in the crud-app users table, ordered by id. Returns id, name and email for each.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
}, () => callApi('GET', '/users'))

server.registerTool('get_user', {
  title: 'Get a user',
  description: 'Fetch one user by id. Returns a 404 error if no user has that id.',
  inputSchema: { id },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
}, ({ id }) => callApi('GET', `/users/${id}`))

server.registerTool('create_user', {
  title: 'Create a user',
  description: 'Add a new user. Name is required; email is optional. Returns the new user\'s id.',
  inputSchema: { name, email: email.optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
}, ({ name, email }) => callApi('POST', '/users', { name, email }))

server.registerTool('update_user', {
  title: 'Update a user',
  description: 'Change a user\'s name, email, or both. Give the id and at least one of name or email. Fields left out are unchanged.',
  inputSchema: { id, name: name.optional(), email: email.optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, ({ id, name, email }) => {
  if (name === undefined && email === undefined) {
    return errorResult('Give at least one of name or email to update.')
  }
  return callApi('PUT', `/users/${id}`, { name, email })
})

server.registerTool('delete_user', {
  title: 'Delete a user',
  description: 'Permanently delete the user with this id. This cannot be undone; confirm with the person first if the request was ambiguous.',
  inputSchema: { id },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
}, ({ id }) => callApi('DELETE', `/users/${id}`))

const transport = new StdioServerTransport()
await server.connect(transport)
// Everything above goes over stdout as MCP protocol, so any logging must use
// stderr. This one line helps when a client shows the server's stderr.
console.error(`crud-mcp ready, calling the API at ${API_URL}`)
