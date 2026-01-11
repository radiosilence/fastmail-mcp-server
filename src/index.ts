#!/usr/bin/env bun
import {
	McpServer,
	ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseOffice } from "officeparser";
import { z } from "zod";
import {
	buildReply,
	downloadAttachment,
	getAttachments,
	getEmail,
	getMailboxByName,
	getThreadEmails,
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
	version: "0.2.2",
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
	"List all mailboxes (folders) in the account with their unread counts. START HERE - use this to discover available folders before listing emails.",
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
	"Get the full content of a specific email by its ID. Automatically includes the full thread context (all emails in the conversation) sorted oldest-first.",
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

		// Get full thread context
		const threadEmails = await getThreadEmails(email.threadId);

		if (threadEmails.length <= 1) {
			// Single email, no thread
			const text = formatEmailFull(email);
			return { content: [{ type: "text" as const, text }] };
		}

		// Format thread with all emails
		const threadText = threadEmails
			.map((e, i) => {
				const marker = e.id === email_id ? ">>> SELECTED EMAIL <<<\n" : "";
				return `${marker}[${i + 1}/${threadEmails.length}]\n${formatEmailFull(e)}`;
			})
			.join("\n\n========== THREAD ==========\n\n");

		return {
			content: [
				{
					type: "text" as const,
					text: `Thread contains ${threadEmails.length} emails:\n\n${threadText}`,
				},
			],
		};
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
	"Mark an email as spam. This moves it to Junk AND trains the spam filter - affects future filtering! MUST use action='preview' first, then 'confirm' after user approval.",
	{
		email_id: z.string().describe("The email ID to mark as spam"),
		action: z
			.enum(["preview", "confirm"])
			.describe("'preview' first, then 'confirm' after user approval"),
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
	"Compose and send a new email. CRITICAL: You MUST call with action='preview' first, show the user the draft, get explicit approval, then call again with action='confirm'. NEVER skip the preview step.",
	{
		action: z
			.enum(["preview", "confirm"])
			.describe(
				"'preview' to see the draft, 'confirm' to send - ALWAYS preview first",
			),
		to: z.string().describe("Recipient email address(es), comma-separated"),
		subject: z.string().describe("Email subject line"),
		body: z.string().describe("Email body text"),
		cc: z.string().optional().describe("CC recipients, comma-separated"),
		bcc: z
			.string()
			.optional()
			.describe("BCC recipients (hidden), comma-separated"),
	},
	async ({ action, to, subject, body, cc, bcc }) => {
		// Parse addresses
		const parseAddresses = (s: string): EmailAddress[] =>
			s.split(",").map((e) => ({ name: null, email: e.trim() }));

		const toAddrs = parseAddresses(to);
		const ccAddrs = cc ? parseAddresses(cc) : undefined;
		const bccAddrs = bcc ? parseAddresses(bcc) : undefined;

		if (action === "preview") {
			return {
				content: [
					{
						type: "text" as const,
						text: `📧 EMAIL PREVIEW - Review before sending:

To: ${formatAddressList(toAddrs)}
CC: ${ccAddrs ? formatAddressList(ccAddrs) : "(none)"}
BCC: ${bccAddrs ? formatAddressList(bccAddrs) : "(none)"}
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
			bcc: bccAddrs,
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
	"Reply to an existing email thread. CRITICAL: You MUST call with action='preview' first, show the user the draft, get explicit approval, then call again with action='confirm'. NEVER skip the preview step. For reply-all, include original CC recipients in the cc param.",
	{
		action: z
			.enum(["preview", "confirm"])
			.describe(
				"'preview' to see the draft, 'confirm' to send - ALWAYS preview first",
			),
		email_id: z.string().describe("The email ID to reply to"),
		body: z
			.string()
			.describe("Reply body text (your response, without quoting original)"),
		cc: z
			.string()
			.optional()
			.describe("CC recipients for reply-all, comma-separated"),
		bcc: z
			.string()
			.optional()
			.describe("BCC recipients (hidden), comma-separated"),
	},
	async ({ action, email_id, body, cc, bcc }) => {
		const parseAddresses = (s: string): EmailAddress[] =>
			s.split(",").map((e) => ({ name: null, email: e.trim() }));

		const replyParams = await buildReply(email_id, body);

		// Add cc/bcc if provided
		if (cc) {
			replyParams.cc = parseAddresses(cc);
		}
		if (bcc) {
			replyParams.bcc = parseAddresses(bcc);
		}

		if (action === "preview") {
			return {
				content: [
					{
						type: "text" as const,
						text: `📧 REPLY PREVIEW - Review before sending:

To: ${formatAddressList(replyParams.to)}
CC: ${replyParams.cc ? formatAddressList(replyParams.cc) : "(none)"}
BCC: ${replyParams.bcc ? formatAddressList(replyParams.bcc) : "(none)"}
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

// ============ Attachment Tools ============

server.tool(
	"list_attachments",
	"List all attachments on an email. Returns attachment names, types, sizes, and blob IDs for downloading.",
	{
		email_id: z.string().describe("The email ID to get attachments from"),
	},
	async ({ email_id }) => {
		const attachments = await getAttachments(email_id);

		if (attachments.length === 0) {
			return {
				content: [
					{ type: "text" as const, text: "No attachments on this email." },
				],
			};
		}

		const lines = attachments.map((a, i) => {
			const size =
				a.size > 1024 * 1024
					? `${(a.size / 1024 / 1024).toFixed(1)} MB`
					: a.size > 1024
						? `${(a.size / 1024).toFixed(1)} KB`
						: `${a.size} bytes`;
			return `${i + 1}. ${a.name || "(unnamed)"}\n   Type: ${a.type}\n   Size: ${size}\n   Blob ID: ${a.blobId}`;
		});

		return {
			content: [
				{
					type: "text" as const,
					text: `Attachments (${attachments.length}):\n\n${lines.join("\n\n")}`,
				},
			],
		};
	},
);

// File types that officeparser can extract text from
const EXTRACTABLE_TYPES = [
	"application/pdf",
	"application/msword", // .doc
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
	"application/vnd.ms-excel", // .xls
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
	"application/vnd.ms-powerpoint", // .ppt
	"application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
	"application/rtf",
	"application/vnd.oasis.opendocument.text", // .odt
	"application/vnd.oasis.opendocument.spreadsheet", // .ods
	"application/vnd.oasis.opendocument.presentation", // .odp
];

// Also match by extension for when MIME types are wrong
const EXTRACTABLE_EXTENSIONS = [
	".pdf",
	".doc",
	".docx",
	".xls",
	".xlsx",
	".ppt",
	".pptx",
	".rtf",
	".odt",
	".ods",
	".odp",
];

function canExtractText(mimeType: string, filename: string | null): boolean {
	// Check MIME type first
	if (EXTRACTABLE_TYPES.includes(mimeType)) return true;

	// Check extension - this catches octet-stream with proper filenames
	if (filename) {
		const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
		console.error(`[canExtractText] filename=${filename}, ext=${ext}`);
		if (ext && EXTRACTABLE_EXTENSIONS.includes(ext)) return true;
	}

	return false;
}

async function extractText(
	data: Uint8Array,
	filename: string | null,
): Promise<string> {
	const buffer = Buffer.from(data);
	const ext = filename?.toLowerCase().match(/\.[^.]+$/)?.[0];

	// For .doc files, use macOS textutil (officeparser doesn't handle old OLE format well)
	if (ext === ".doc") {
		console.error("[extractText] Using textutil for .doc file");
		const tmpPath = `/tmp/fastmail-${Date.now()}.doc`;
		await Bun.write(tmpPath, buffer);
		try {
			const proc = Bun.spawn([
				"textutil",
				"-convert",
				"txt",
				"-stdout",
				tmpPath,
			]);
			const output = await new Response(proc.stdout).text();
			return output;
		} finally {
			(await Bun.file(tmpPath).exists()) &&
				(await Bun.$`rm ${tmpPath}`.quiet());
		}
	}

	// For everything else, use officeparser
	const result = await parseOffice(buffer, { outputFormat: "text" });
	if (typeof result === "string") {
		return result;
	}
	// AST result - extract text from it
	return JSON.stringify(result, null, 2);
}

server.tool(
	"get_attachment",
	"Download an attachment. Text files and documents (PDF, DOC, DOCX, XLS, PPT, etc) have text extracted and returned. Images returned as viewable content.",
	{
		email_id: z.string().describe("The email ID the attachment belongs to"),
		blob_id: z
			.string()
			.describe("The blob ID of the attachment (from list_attachments)"),
	},
	async ({ email_id, blob_id }) => {
		const result = await downloadAttachment(email_id, blob_id);

		console.error(
			`[get_attachment] Downloaded ${result.size} bytes, type: ${result.type}, name: ${result.name}`,
		);

		// Plain text - return directly
		if (result.isText) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Attachment: ${result.name || "(unnamed)"}\nType: ${result.type}\n\n--- Content ---\n${result.content}`,
					},
				],
			};
		}

		// Documents - extract text
		const shouldExtract = canExtractText(result.type, result.name);
		console.error(
			`[get_attachment] canExtractText(${result.type}, ${result.name}) = ${shouldExtract}`,
		);

		if (shouldExtract) {
			try {
				console.error(`[get_attachment] Extracting text from ${result.type}`);
				const text = await extractText(result.data, result.name);
				console.error(
					`[get_attachment] Extracted ${text.length} chars of text`,
				);
				return {
					content: [
						{
							type: "text" as const,
							text: `Attachment: ${result.name || "(unnamed)"}\nType: ${result.type}\nSize: ${Math.round(result.size / 1024)}KB\n\n--- Extracted Text ---\n${text}`,
						},
					],
				};
			} catch (err) {
				console.error(`[get_attachment] Text extraction failed:`, err);
				// Fall through to base64
			}
		}

		const base64 = Buffer.from(result.data).toString("base64");

		// Images - return as image content
		if (result.type.startsWith("image/")) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Attachment: ${result.name || "(unnamed)"} (${Math.round(result.size / 1024)}KB)`,
					},
					{
						type: "image" as const,
						data: base64,
						mimeType: result.type,
					},
				],
			};
		}

		// Other binary - return base64 as last resort
		return {
			content: [
				{
					type: "text" as const,
					text: `Attachment: ${result.name || "(unnamed)"}\nType: ${result.type}\nSize: ${Math.round(result.size / 1024)}KB\nEncoding: base64\n\n${base64}`,
				},
			],
		};
	},
);

// ============ Resources ============

// Expose attachments as resources with blob content
server.resource(
	"attachment",
	new ResourceTemplate("fastmail://attachment/{emailId}/{blobId}", {
		list: undefined,
	}),
	{
		description: "Email attachment content",
		mimeType: "application/octet-stream",
	},
	async (uri, variables) => {
		const { emailId, blobId } = variables as {
			emailId: string;
			blobId: string;
		};
		const result = await downloadAttachment(emailId, blobId);

		if (result.isText) {
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: result.type,
						text: result.content,
					},
				],
			};
		}

		// Binary - return as blob (base64)
		return {
			contents: [
				{
					uri: uri.toString(),
					mimeType: result.type,
					blob: result.content, // already base64
				},
			],
		};
	},
);

// ============ Prompts ============

server.prompt(
	"fastmail-usage",
	"Instructions for using the Fastmail MCP server effectively",
	() => ({
		messages: [
			{
				role: "user",
				content: {
					type: "text",
					text: `# Fastmail MCP Server Usage Guide

## Reading Emails
1. Use \`list_mailboxes\` to see available folders
2. Use \`list_emails\` with a mailbox name to see emails (e.g., "inbox", "Archive", "Sent")
3. Use \`get_email\` with an email ID to read full content
4. Use \`search_emails\` to find emails across all folders

## Attachments
1. Use \`list_attachments\` to see attachments on an email
2. Use \`get_attachment\` with email_id and blob_id to read attachment content
3. For binary files (PDFs, images), access via resource URI: fastmail://attachment/{emailId}/{blobId}

## Sending Emails (ALWAYS preview first!)
1. Use \`send_email\` with action="preview" to draft
2. Review the preview with the user
3. Only use action="confirm" after explicit user approval
4. Supports to, cc, bcc fields

## Replying
1. Use \`reply_to_email\` with action="preview" to draft a reply
2. The reply automatically threads correctly
3. Add cc/bcc for reply-all scenarios

## Managing Emails
- \`move_email\` - Move to folder (Archive, Trash, etc.)
- \`mark_as_read\` - Toggle read/unread
- \`mark_as_spam\` - Requires preview→confirm (trains spam filter!)

## Safety Rules
- NEVER send without showing preview first
- NEVER confirm send without explicit user approval
- Be careful with mark_as_spam - it affects future filtering`,
				},
			},
		],
	}),
);

// ============ Start Server ============

const transport = new StdioServerTransport();
await server.connect(transport);
