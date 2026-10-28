# crud-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes the
[crud-app](https://github.com/aaronhmiller/crud-app) users API as tools, so
Claude can list, read, create, update and delete users by talking to the
running API. It holds no data and never touches Postgres: each tool is one
HTTP request to crud-app, which stays authoritative for validation and errors.

| Tool          | Calls                 | Arguments                              |
| ------------- | --------------------- | -------------------------------------- |
| `list_users`  | `GET /users`          | none                                   |
| `get_user`    | `GET /users/:id`      | `id`                                   |
| `create_user` | `POST /users`         | `name`, optional `email`               |
| `update_user` | `PUT /users/:id`      | `id`, and `name` and/or `email`        |
| `delete_user` | `DELETE /users/:id`   | `id` (marked destructive)              |

Names and emails are capped at 30 characters to match the `VARCHAR(30)`
columns. API errors come back as tool errors carrying the API's own message.

## Requirements

- Node 20 or later.
- crud-app running. From the crud-app checkout: `docker compose up -d`. It
  publishes the API on `http://localhost`, which is this server's default.
- To point at an API elsewhere, set `CRUD_API_URL`, for example
  `CRUD_API_URL=http://localhost:3000`.

## Install

```bash
git clone https://github.com/aaronhmiller/crud-mcp
cd crud-mcp
npm ci
npm test          # drives the server over stdio against a stub API; no Docker needed
```

The server speaks MCP over stdio. A client starts it as a subprocess, so you
never run it by hand. To poke at it interactively:

```bash
npm run inspect   # opens the MCP Inspector in your browser
```

## Connect Claude Code

Register the server once, at user scope so it is available in every project:

```bash
claude mcp add --scope user crud-mcp -- node /ABSOLUTE/PATH/TO/crud-mcp/server.js
```

Or make it part of the crud-app project, so anyone who opens that repo in
Claude Code gets it. Put this in `.mcp.json` at the root of crud-app:

```json
{
  "mcpServers": {
    "crud-mcp": {
      "command": "node",
      "args": ["../crud-mcp/server.js"]
    }
  }
}
```

Check it with `claude mcp list`; `crud-mcp` should show as connected. Then, in
a Claude Code session: "list the users", "add a user named Dana with email
dana@example.org", "change user 3's email to gerry@example.net".

## Connect Claude Desktop

Edit the config file:

```
~/Library/Application Support/Claude/claude_desktop_config.json      (macOS)
%APPDATA%\Claude\claude_desktop_config.json                           (Windows)
```

Add a `mcpServers` entry alongside whatever is already there:

```json
{
  "mcpServers": {
    "crud-mcp": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/crud-mcp/server.js"],
      "env": { "CRUD_API_URL": "http://localhost" }
    }
  }
}
```

Use the absolute path to `node` (`which node`) if Claude Desktop cannot find
it, since GUI apps do not read your shell's `PATH`. Quit and reopen Claude
Desktop. The tools appear under the tools icon in the chat composer.

## Driving it by voice

MCP servers do not know or care where the words came from, so any voice input
that lands in Claude's chat box works:

- **Claude Desktop** has a microphone button in the composer for dictation in
  current builds. Speak, then send.
- **macOS dictation** works in any text field, including Claude Desktop and
  the terminal running Claude Code. Enable it in System Settings, then press
  the dictation key (or `fn` twice by default) and speak.
- **Claude mobile** has voice mode but runs on your phone, which cannot start
  a stdio server on your Mac. Use Desktop or Claude Code for this one.

Say things like "show me all the users", "who is user two", "add a user named
Priya", "delete user five". Claude picks the tool, calls the API, and reads
back the result. Deletes are flagged as destructive, so Claude will typically
confirm before running them.

## Development

```bash
npm test                                   # node:test, stdio client against a stub API
CRUD_API_URL=http://localhost node server.js   # run by hand; speaks MCP on stdin/stdout
```

Logging must go to stderr: stdout is the MCP channel.
