# fastmail-mcp-server

MCP server for Fastmail. Read, search, organize, and send emails through Claude Desktop.

## Prerequisites

Requires [Bun](https://bun.sh) runtime:

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Or via mise
mise use -g bun
```

## Quick Start

### 1. Generate Fastmail API Token

1. Open [Fastmail Settings → Privacy & Security → Integrations](https://app.fastmail.com/settings/security/integrations)
2. Scroll to **API tokens** and click **Manage**
3. Click **New API token**
4. Name it something like "Claude MCP"
5. Under **Access**, enable:
   - **Mail** - required (read and write)
6. Click **Generate**
7. **Copy the token immediately** - you won't see it again

Token format: `fmu1-xxxxxxxx-xxxxxxxxxxxx...`

### 2. Configure Claude Desktop

Open the Claude Desktop config file:

```bash
# macOS
code ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Or create it if it doesn't exist
mkdir -p ~/Library/Application\ Support/Claude
touch ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Add the fastmail server config:

```json
{
  "mcpServers": {
    "fastmail": {
      "command": "bunx",
      "args": ["-y", "fastmail-mcp-server"],
      "env": {
        "FASTMAIL_API_TOKEN": "fmu1-your-token-here"
      }
    }
  }
}
```

### 3. Restart Claude Desktop

Quit Claude Desktop completely (Cmd+Q) and reopen it. The Fastmail tools should now appear.

## Security

**Token storage:** The token lives in `claude_desktop_config.json` in your user directory. This file is only readable by your user account. For additional security:

- **Don't commit** the config file to version control
- **Rotate tokens** periodically via Fastmail settings
- **Use minimal scopes** - only enable Mail access unless you need more
- **Revoke immediately** if compromised via Fastmail settings

**Send protection:** All email-sending operations require explicit two-step confirmation:

1. `action: "preview"` - shows exactly what will be sent
2. `action: "confirm"` - actually sends

No emails can be sent accidentally.

## Available Tools

### Read Operations (no confirmation needed)

| Tool             | Description                                  |
| ---------------- | -------------------------------------------- |
| `list_mailboxes` | List all folders with unread counts          |
| `list_emails`    | List emails in a mailbox (returns summaries) |
| `get_email`      | Get full email content by ID                 |
| `search_emails`  | Search across all mailboxes                  |

### Write Operations

| Tool             | Description                  | Confirmation |
| ---------------- | ---------------------------- | ------------ |
| `move_email`     | Move email to another folder | No           |
| `mark_as_read`   | Mark email read/unread       | No           |
| `mark_as_spam`   | Move to Junk + train filter  | **Yes**      |
| `send_email`     | Send a new email             | **Yes**      |
| `reply_to_email` | Reply to an email thread     | **Yes**      |

## Example Prompts

```
"What's in my inbox?"

"Check the met-police folder - anything urgent?"

"Search for emails from john@example.com"

"What would be a good response to the latest email from the solicitor?"

"Draft a reply to that insurance email explaining the situation"

"Move all the newsletters to Archive"

"Mark that spam email as junk"
```

## Troubleshooting

**"FASTMAIL_API_TOKEN environment variable is required"**

- Check your Claude Desktop config has the token in the `env` section
- Make sure the JSON is valid (no trailing commas)
- Restart Claude Desktop completely (Cmd+Q)

**"Failed to get JMAP session: 401"**

- Token is invalid or expired
- Generate a new token in Fastmail settings
- Make sure you copied the full token

**"Mailbox not found"**

- Run `list_mailboxes` first to see exact folder names
- Names are case-sensitive

**Tools not appearing in Claude**

- Check logs: `~/Library/Logs/Claude/mcp*.log`
- Make sure bun is installed: `bun --version`
- Try running directly: `bunx fastmail-mcp-server`

## How It Works

Uses [JMAP](https://jmap.io/) (JSON Meta Application Protocol) - a modern, stateless replacement for IMAP. The server implements [Model Context Protocol](https://modelcontextprotocol.io/) for Claude integration.

## Development

```bash
git clone https://github.com/radiosilence/fastmail-mcp-server
cd fastmail-mcp-server
bun install

# Test with your token
FASTMAIL_API_TOKEN=fmu1-... bun run test

# Run server directly
FASTMAIL_API_TOKEN=fmu1-... bun run start

# Format & lint
bun run format
bun run lint
```

## License

MIT
