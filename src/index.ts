#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
	buildReply,
	getEmail,
	getMailboxByName,
	listEmails,
	listMailboxes,
	markAsRead,
	markAsSpam,
	moveEmail,
	searchEmails,
	sendEmail,
} from "./jmap/methods.js";
import type { Email, EmailAddress, Mailbox } from "./jmap/types.js";

const server = new McpServer({
	name: "fastmail",
	version: "0.1.0",
});

// ============ Formatters ============

function formatAddress(addr: EmailAddress): string {
	if (addr.name) {
		return `${addr.name} <${addr.email}>`;
	}
	return addr.email;
}

function formatAddressList(addrs: EmailAddress[] | null): string {
	if (!addrs || addrs.length === 0) return "(none)";
	return addrs.map(formatAddress).join(", ");
}

function formatMailbox(m: Mailbox): string {
	const role = m.role ? ` [${m.role}]` : "";
	const unread = m.unreadEmails > 0 ? ` (${m.unreadEmails} unread)` : "";
	return `${m.name}${role}${unread} - ${m.totalEmails} emails (id: ${m.id})`;
}

function formatEmailSummary(e: Email): string {
	const from = formatAddressList(e.from);
	const date = new Date(e.receivedAt).toLocaleString();
	const attachment = e.hasAttachment ? " [attachment]" : "";
	const unread = !e.keywords.$seen ? " [UNREAD]" : "";
	return `${unread}${attachment}
ID: ${e.id}
From: ${from}
Subject: ${e.subject || "(no subject)"}
Date: ${date}
Preview: ${e.preview}`;
}

function formatEmailFull(e: Email): string {
	const from = formatAddressList(e.from);
	const to = formatAddressList(e.to);
	const cc = formatAddressList(e.cc);
	const date = new Date(e.receivedAt).toLocaleString();

	// Get body text
	let body = "";
	if (e.bodyValues) {
		// Prefer text body
		const textPart = e.textBody?.[0];
		if (textPart?.partId && e.bodyValues[textPart.partId]) {
			body = e.bodyValues[textPart.partId]?.value ?? "";
		} else {
			// Fall back to first body value
			const firstValue = Object.values(e.bodyValues)[0];
			if (firstValue) {
				body = firstValue.value;
			}
		}
	}

	return `ID: ${e.id}
Thread ID: ${e.threadId}
From: ${from}
To: ${to}
CC: ${cc}
Subject: ${e.subject || "(no subject)"}
Date: ${date}
Has Attachment: ${e.hasAttachment}

--- Body ---
${body}`;
}

// ============ Read-Only Tools ============

server.tool(
	"list_mailboxes",
	"List all mailboxes (folders) in the account with their unread counts. Use this to discover available folders before listing emails.",
	{},
	async () => {
		const mailboxes = await listMailboxes();
		const sorted = mailboxes.sort((a, b) => {
			// Put role-based mailboxes first
			if (a.role && !b.role) return -1;
			if (!a.role && b.role) return 1;
			return a.name.localeCompare(b.name);
		});

		const text = sorted.map(formatMailbox).join("\n");
		return { content: [{ type: "text" as const, text }] };
	},
);

server.tool(
	"list_emails",
	"List emails in a specific mailbox/folder. Returns email summaries with ID, from, subject, date, and preview. Use the email ID with get_email for full content.",
	{
		mailbox: z
			.string()
			.describe(
				"Mailbox name (e.g., 'INBOX', 'Sent', 'Archive') or role (e.g., 'inbox', 'sent', 'drafts', 'trash', 'junk')",
			),
		limit: z
			.number()
			.optional()
			.describe("Maximum number of emails to return (default 25, max 100)"),
	},
	async ({ mailbox, limit }) => {
		const emails = await listEmails(mailbox, Math.min(limit || 25, 100));

		if (emails.length === 0) {
			return {
				content: [{ type: "text" as const, text: `No emails in ${mailbox}` }],
			};
		}

		const text = emails.map(formatEmailSummary).join("\n\n---\n\n");
		return { content: [{ type: "text" as const, text }] };
	},
);

server.tool(
	"get_email",
	"Get the full content of a specific email by its ID. Returns complete email with headers, body text, and attachment info.",
	{
		email_id: z
			.string()
			.describe("The email ID (obtained from list_emails or search_emails)"),
	},
	async ({ email_id }) => {
		const email = await getEmail(email_id);

		if (!email) {
			return {
				content: [
					{ type: "text" as const, text: `Email not found: ${email_id}` },
				],
			};
		}

		const text = formatEmailFull(email);
		return { content: [{ type: "text" as const, text }] };
	},
);

server.tool(
	"search_emails",
	"Search for emails across all mailboxes. Supports full-text search of email content, subjects, and addresses.",
	{
		query: z
			.string()
			.describe(
				"Search query - searches subject, body, and addresses. Examples: 'from:alice@example.com', 'subject:invoice', 'meeting notes'",
			),
		limit: z
			.number()
			.optional()
			.describe("Maximum number of results (default 25, max 100)"),
	},
	async ({ query, limit }) => {
		const emails = await searchEmails(query, Math.min(limit || 25, 100));

		if (emails.length === 0) {
			return {
				content: [
					{ type: "text" as const, text: `No emails found for: ${query}` },
				],
			};
		}

		const text = emails.map(formatEmailSummary).join("\n\n---\n\n");
		return { content: [{ type: "text" as const, text }] };
	},
);

// ============ Write Tools (with safety) ============

server.tool(
	"move_email",
	"Move an email to a different mailbox/folder.",
	{
		email_id: z.string().describe("The email ID to move"),
		target_mailbox: z
			.string()
			.describe(
				"Target mailbox name (e.g., 'Archive', 'Trash') or role (e.g., 'archive', 'trash')",
			),
	},
	async ({ email_id, target_mailbox }) => {
		// Get email info for confirmation message
		const email = await getEmail(email_id);
		if (!email) {
			return {
				content: [
					{ type: "text" as const, text: `Email not found: ${email_id}` },
				],
			};
		}

		const targetBox = await getMailboxByName(target_mailbox);
		if (!targetBox) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Mailbox not found: ${target_mailbox}`,
					},
				],
			};
		}

		await moveEmail(email_id, target_mailbox);

		return {
			content: [
				{
					type: "text" as const,
					text: `Moved email "${email.subject}" to ${targetBox.name}`,
				},
			],
		};
	},
);

server.tool(
	"mark_as_read",
	"Mark an email as read or unread.",
	{
		email_id: z.string().describe("The email ID"),
		read: z
			.boolean()
			.optional()
			.describe("true to mark read, false to mark unread (default: true)"),
	},
	async ({ email_id, read }) => {
		const email = await getEmail(email_id);
		if (!email) {
			return {
				content: [
					{ type: "text" as const, text: `Email not found: ${email_id}` },
				],
			};
		}

		await markAsRead(email_id, read ?? true);

		const status = (read ?? true) ? "read" : "unread";
		return {
			content: [
				{
					type: "text" as const,
					text: `Marked "${email.subject}" as ${status}`,
				},
			],
		};
	},
);

server.tool(
	"mark_as_spam",
	"Mark an email as spam. This moves it to the Junk folder AND trains the spam filter. USE WITH CAUTION - this affects future filtering. Requires explicit confirmation.",
	{
		email_id: z.string().describe("The email ID to mark as spam"),
		action: z
			.enum(["preview", "confirm"])
			.describe(
				"'preview' to see what will happen, 'confirm' to actually mark as spam",
			),
	},
	async ({ email_id, action }) => {
		const email = await getEmail(email_id);
		if (!email) {
			return {
				content: [
					{ type: "text" as const, text: `Email not found: ${email_id}` },
				],
			};
		}

		if (action === "preview") {
			return {
				content: [
					{
						type: "text" as const,
						text: `⚠️ SPAM PREVIEW - This will:
1. Move the email to Junk folder
2. Train the spam filter to mark similar emails as spam

Email: "${email.subject}"
From: ${formatAddressList(email.from)}

To proceed, call this tool again with action: "confirm"`,
					},
				],
			};
		}

		await markAsSpam(email_id);

		return {
			content: [
				{
					type: "text" as const,
					text: `Marked as spam: "${email.subject}" from ${formatAddressList(email.from)}`,
				},
			],
		};
	},
);

// ============ Send/Reply Tools (with preview→confirm flow) ============

server.tool(
	"send_email",
	"Compose and send a new email. ALWAYS use action='preview' first to review the draft before sending.",
	{
		action: z
			.enum(["preview", "confirm"])
			.describe("'preview' to see the draft, 'confirm' to send"),
		to: z.string().describe("Recipient email address(es), comma-separated"),
		subject: z.string().describe("Email subject line"),
		body: z.string().describe("Email body text"),
		cc: z.string().optional().describe("CC recipients, comma-separated"),
	},
	async ({ action, to, subject, body, cc }) => {
		// Parse addresses
		const parseAddresses = (s: string): EmailAddress[] =>
			s.split(",").map((e) => ({ name: null, email: e.trim() }));

		const toAddrs = parseAddresses(to);
		const ccAddrs = cc ? parseAddresses(cc) : undefined;

		if (action === "preview") {
			return {
				content: [
					{
						type: "text" as const,
						text: `📧 EMAIL PREVIEW - Review before sending:

To: ${formatAddressList(toAddrs)}
CC: ${ccAddrs ? formatAddressList(ccAddrs) : "(none)"}
Subject: ${subject}

--- Body ---
${body}

---
To send this email, call this tool again with action: "confirm" and the same parameters.`,
					},
				],
			};
		}

		const emailId = await sendEmail({
			to: toAddrs,
			subject,
			textBody: body,
			cc: ccAddrs,
		});

		return {
			content: [
				{
					type: "text" as const,
					text: `✓ Email sent successfully!
To: ${formatAddressList(toAddrs)}
Subject: ${subject}
Email ID: ${emailId}`,
				},
			],
		};
	},
);

server.tool(
	"reply_to_email",
	"Reply to an existing email thread. ALWAYS use action='preview' first to review the draft before sending.",
	{
		action: z
			.enum(["preview", "confirm"])
			.describe("'preview' to see the draft, 'confirm' to send"),
		email_id: z.string().describe("The email ID to reply to"),
		body: z
			.string()
			.describe("Reply body text (your response, without quoting original)"),
	},
	async ({ action, email_id, body }) => {
		const replyParams = await buildReply(email_id, body);

		if (action === "preview") {
			return {
				content: [
					{
						type: "text" as const,
						text: `📧 REPLY PREVIEW - Review before sending:

To: ${formatAddressList(replyParams.to)}
Subject: ${replyParams.subject}
In-Reply-To: ${replyParams.inReplyTo || "(none)"}

--- Your Reply ---
${body}

---
To send this reply, call this tool again with action: "confirm" and the same parameters.`,
					},
				],
			};
		}

		const emailId = await sendEmail(replyParams);

		return {
			content: [
				{
					type: "text" as const,
					text: `✓ Reply sent successfully!
To: ${formatAddressList(replyParams.to)}
Subject: ${replyParams.subject}
Email ID: ${emailId}`,
				},
			],
		};
	},
);

// ============ Start Server ============

const transport = new StdioServerTransport();
await server.connect(transport);
