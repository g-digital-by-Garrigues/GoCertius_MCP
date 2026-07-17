# Onboarding Guide — GoCertius MCP Server

Get from zero to your first tool call in under 5 minutes.

---

## Step 1 — Get your credentials

Visit [https://www.gocertius.io](https://www.gocertius.io) to create an account or obtain API credentials.

You will need either:
- **Email + password** — an interactive login, or
- **User key** — a long-lived key for automated / headless use

Configure one or the other, not both.

---

## Step 2 — Install the MCP server

### Claude Desktop or Claude Code

Open your configuration file:

- **Claude Desktop (Mac):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Code:** `~/.claude.json`

Add this block inside `"mcpServers"`:

```json
"gocertius": {
  "command": "npx",
  "args": ["-y", "@g-digital/mcp-gocertius"],
  "env": {
    "MCP_AUTH_EMAIL": "your-email@example.com",
    "MCP_AUTH_PASSWORD": "your-password"
  }
}
```

Replace `your-email@example.com` and `your-password` with your real credentials.

### User key (alternative — no password in config)

```json
"gocertius": {
  "command": "npx",
  "args": ["-y", "@g-digital/mcp-gocertius"],
  "env": {
    "MCP_AUTH_USER_KEY": "your-user-key"
  }
}
```

---

## Step 3 — Restart Claude

- **Claude Desktop:** Quit and relaunch the app.
- **Claude Code:** Run `/mcp` to verify the server appears in the connected servers list.

The server starts automatically when Claude launches. Startup takes 2–5 seconds on first run (npm downloads the package).

---

## Step 4 — Make your first tool call

Try this prompt in Claude:

```
Using the gocertius MCP server, tell me who I am logged in as.
```

Claude will call the `session_info` tool and return your account details. If you see your email address in the response, setup is complete.

---

## Bundled workflow guides

This package includes step-by-step guides as Claude Code slash-commands. After setup, try:

- `/getting-started` — opens a guided workflow
- `/evidence-lifecycle` — opens a guided workflow
- `/dossier-lifecycle` — opens a guided workflow
- `/notification-lifecycle` — opens a guided workflow
- `/chat-lifecycle` — opens a guided workflow

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `"Missing Authorization: Bearer <jwt>"` | HTTP mode: no Bearer header sent | Use stdio mode (npx) or add the Bearer header to your client |
| `"JWT is expired"` | Session token has expired | Claude will auto-refresh; if it fails, restart the server |
| `"Upstream HTTP 401"` | Wrong credentials | Re-check `MCP_AUTH_EMAIL` / `MCP_AUTH_PASSWORD` in your config |
| `"Upstream HTTP 503"` | API temporarily unavailable | Wait 1–2 minutes and retry |
| Tool not found in Claude | Server not connected | Run `/mcp` in Claude Code to verify connection; check Claude Desktop logs |
| `Error: Cannot find package` | npm cache issue | Run `npx --yes @g-digital/mcp-gocertius` manually once to pre-warm the cache |

For additional help, open an issue on the [g-digital GitHub](https://github.com/g-digital-by-Garrigues) or contact your account team.
