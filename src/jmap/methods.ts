import { getClient } from "./client.js";
import type {
	Email,
	EmailAddress,
	EmailCreate,
	Identity,
	Mailbox,
	MaskedEmail,
} from "./types.js";

// Standard properties to fetch for email listings
const EMAIL_LIST_PROPERTIES = [
	"id",
	"threadId",
	"mailboxIds",
	"keywords",
	"from",
	"to",
	"subject",
	"receivedAt",
	"preview",
	"hasAttachment",
	"size",
];

// Full properties for single email fetch
const EMAIL_FULL_PROPERTIES = [
	...EMAIL_LIST_PROPERTIES,
	"cc",
	"bcc",
	"replyTo",
	"sentAt",
	"messageId",
	"inReplyTo",
	"references",
	"bodyValues",
	"textBody",
	"htmlBody",
	"attachments",
];

// ============ Mailbox Methods ============

export async function listMailboxes(): Promise<Mailbox[]> {
	const client = getClient();
	const accountId = await client.getAccountId();

	const result = await client.call<{ list: Mailbox[] }>("Mailbox/get", {
		accountId,
	});

	return result.list;
}

export async function getMailboxByName(name: string): Promise<Mailbox | null> {
	const mailboxes = await listMailboxes();
	const lowerName = name.toLowerCase();

	// Try exact match first, then role match, then case-insensitive
	return (
		mailboxes.find((m) => m.name === name) ||
		mailboxes.find((m) => m.role === lowerName) ||
		mailboxes.find((m) => m.name.toLowerCase() === lowerName) ||
		null
	);
}

export async function getMailboxById(id: string): Promise<Mailbox | null> {
	const mailboxes = await listMailboxes();
	return mailboxes.find((m) => m.id === id) || null;
}

// ============ Email Methods ============

export async function listEmails(
	mailboxName: string,
	limit = 25,
): Promise<Email[]> {
	const client = getClient();
	const accountId = await client.getAccountId();

	const mailbox = await getMailboxByName(mailboxName);
	if (!mailbox) {
		throw new Error(`Mailbox not found: ${mailboxName}`);
	}

	// Query for email IDs
	const queryResult = await client.call<{ ids: string[] }>("Email/query", {
		accountId,
		filter: { inMailbox: mailbox.id },
		sort: [{ property: "receivedAt", isAscending: false }],
		limit,
	});

	if (queryResult.ids.length === 0) {
		return [];
	}

	// Fetch email details
	const getResult = await client.call<{ list: Email[] }>("Email/get", {
		accountId,
		ids: queryResult.ids,
		properties: EMAIL_LIST_PROPERTIES,
	});

	return getResult.list;
}

export async function getEmail(emailId: string): Promise<Email | null> {
	const client = getClient();
	const accountId = await client.getAccountId();

	const result = await client.call<{ list: Email[] }>("Email/get", {
		accountId,
		ids: [emailId],
		properties: EMAIL_FULL_PROPERTIES,
		fetchTextBodyValues: true,
		fetchHTMLBodyValues: true,
		maxBodyValueBytes: 1024 * 1024, // 1MB
	});

	return result.list[0] || null;
}

export async function getThreadEmails(threadId: string): Promise<Email[]> {
	const client = getClient();
	const accountId = await client.getAccountId();

	// Get thread to find all email IDs
	const threadResult = await client.call<{
		list: { id: string; emailIds: string[] }[];
	}>("Thread/get", {
		accountId,
		ids: [threadId],
	});

	const thread = threadResult.list[0];
	if (!thread || thread.emailIds.length === 0) {
		return [];
	}

	// Fetch all emails in the thread
	const emailResult = await client.call<{ list: Email[] }>("Email/get", {
		accountId,
		ids: thread.emailIds,
		properties: EMAIL_FULL_PROPERTIES,
		fetchTextBodyValues: true,
		fetchHTMLBodyValues: true,
		maxBodyValueBytes: 1024 * 1024,
	});

	// Sort by receivedAt ascending (oldest first)
	return emailResult.list.sort(
		(a, b) =>
			new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
	);
}

export interface SearchFilter {
	query?: string; // General search across subject, from, to, body
	from?: string;
	to?: string;
	cc?: string;
	bcc?: string;
	subject?: string;
	body?: string;
	mailbox?: string; // Mailbox name or ID
	hasAttachment?: boolean;
	minSize?: number;
	maxSize?: number;
	before?: string; // ISO date or YYYY-MM-DD
	after?: string; // ISO date or YYYY-MM-DD
	unread?: boolean;
	flagged?: boolean;
}

export async function searchEmails(
	filter: string | SearchFilter,
	limit = 25,
): Promise<Email[]> {
	const client = getClient();
	const accountId = await client.getAccountId();

	// Handle simple string query (backwards compat)
	if (typeof filter === "string") {
		filter = { query: filter };
	}

	// Build JMAP filter
	const jmapFilter: Record<string, unknown> = {};

	// General query - OR across multiple fields (Fastmail doesn't support "text")
	if (filter.query) {
		const queryResult = await client.call<{ ids: string[] }>("Email/query", {
			accountId,
			filter: {
				operator: "OR",
				conditions: [
					{ subject: filter.query },
					{ from: filter.query },
					{ to: filter.query },
					{ body: filter.query },
				],
			},
			sort: [{ property: "receivedAt", isAscending: false }],
			limit,
		});

		if (queryResult.ids.length === 0) {
			return [];
		}

		const getResult = await client.call<{ list: Email[] }>("Email/get", {
			accountId,
			ids: queryResult.ids,
			properties: EMAIL_LIST_PROPERTIES,
		});

		return getResult.list;
	}

	// Specific field filters
	if (filter.from) jmapFilter.from = filter.from;
	if (filter.to) jmapFilter.to = filter.to;
	if (filter.cc) jmapFilter.cc = filter.cc;
	if (filter.bcc) jmapFilter.bcc = filter.bcc;
	if (filter.subject) jmapFilter.subject = filter.subject;
	if (filter.body) jmapFilter.body = filter.body;

	// Mailbox filter
	if (filter.mailbox) {
		const mailbox = await getMailboxByName(filter.mailbox);
		if (mailbox) {
			jmapFilter.inMailbox = mailbox.id;
		}
	}

	// Boolean/size filters
	if (filter.hasAttachment) jmapFilter.hasAttachment = true;
	if (filter.minSize) jmapFilter.minSize = filter.minSize;
	if (filter.maxSize) jmapFilter.maxSize = filter.maxSize;

	// Date filters - normalize to ISO 8601
	if (filter.before) {
		jmapFilter.before = filter.before.includes("T")
			? filter.before
			: `${filter.before}T00:00:00Z`;
	}
	if (filter.after) {
		jmapFilter.after = filter.after.includes("T")
			? filter.after
			: `${filter.after}T00:00:00Z`;
	}

	// Keyword filters
	if (filter.unread) jmapFilter.notKeyword = "$seen";
	if (filter.flagged) jmapFilter.hasKeyword = "$flagged";

	const queryResult = await client.call<{ ids: string[] }>("Email/query", {
		accountId,
		filter: jmapFilter,
		sort: [{ property: "receivedAt", isAscending: false }],
		limit,
	});

	if (queryResult.ids.length === 0) {
		return [];
	}

	// Fetch email details
	const getResult = await client.call<{ list: Email[] }>("Email/get", {
		accountId,
		ids: queryResult.ids,
		properties: EMAIL_LIST_PROPERTIES,
	});

	return getResult.list;
}

// ============ Email Modification Methods ============

export async function moveEmail(
	emailId: string,
	targetMailboxName: string,
): Promise<void> {
	const client = getClient();
	const accountId = await client.getAccountId();

	const targetMailbox = await getMailboxByName(targetMailboxName);
	if (!targetMailbox) {
		throw new Error(`Target mailbox not found: ${targetMailboxName}`);
	}

	// Get current email to find its mailboxes
	const email = await getEmail(emailId);
	if (!email) {
		throw new Error(`Email not found: ${emailId}`);
	}

	// Build new mailboxIds - remove all current, add target
	const newMailboxIds: Record<string, boolean> = { [targetMailbox.id]: true };

	await client.call("Email/set", {
		accountId,
		update: {
			[emailId]: { mailboxIds: newMailboxIds },
		},
	});
}

export async function setEmailKeywords(
	emailId: string,
	keywords: Record<string, boolean>,
): Promise<void> {
	const client = getClient();
	const accountId = await client.getAccountId();

	await client.call("Email/set", {
		accountId,
		update: {
			[emailId]: { keywords },
		},
	});
}

export async function markAsRead(emailId: string, read = true): Promise<void> {
	const email = await getEmail(emailId);
	if (!email) {
		throw new Error(`Email not found: ${emailId}`);
	}

	const keywords: Record<string, boolean> = { ...email.keywords };
	if (read) {
		keywords.$seen = true;
	} else {
		delete keywords.$seen;
	}

	await setEmailKeywords(emailId, keywords);
}

export async function markAsSpam(emailId: string): Promise<void> {
	const client = getClient();
	const accountId = await client.getAccountId();

	const junkMailbox = await getMailboxByName("junk");
	if (!junkMailbox) {
		throw new Error("Junk mailbox not found");
	}

	// Move to Junk and set $junk keyword (trains spam filter)
	const email = await getEmail(emailId);
	if (!email) {
		throw new Error(`Email not found: ${emailId}`);
	}

	const keywords: Record<string, boolean> = { ...email.keywords, $junk: true };
	delete keywords.$notjunk;

	await client.call("Email/set", {
		accountId,
		update: {
			[emailId]: {
				mailboxIds: { [junkMailbox.id]: true },
				keywords,
			},
		},
	});
}

// ============ Identity Methods ============

export async function getIdentities(): Promise<Identity[]> {
	const client = getClient();
	const accountId = await client.getAccountId();

	const result = await client.call<{ list: Identity[] }>("Identity/get", {
		accountId,
	});

	return result.list;
}

export async function getDefaultIdentity(): Promise<Identity> {
	const identities = await getIdentities();
	const identity = identities[0];
	if (!identity) {
		throw new Error("No email identity found");
	}
	return identity;
}

// ============ Email Sending Methods ============

export interface SendEmailParams {
	to: EmailAddress[];
	subject: string;
	textBody: string;
	htmlBody?: string;
	cc?: EmailAddress[];
	bcc?: EmailAddress[];
	inReplyTo?: string;
	references?: string[];
}

export async function sendEmail(params: SendEmailParams): Promise<string> {
	const client = getClient();
	const accountId = await client.getAccountId();

	const identity = await getDefaultIdentity();

	// Get Drafts and Sent mailbox IDs
	const mailboxes = await listMailboxes();
	const draftsMailbox = mailboxes.find((m) => m.role === "drafts");
	const sentMailbox = mailboxes.find((m) => m.role === "sent");

	if (!draftsMailbox || !sentMailbox) {
		throw new Error("Could not find Drafts or Sent mailbox");
	}

	// Create email body
	const emailCreate: EmailCreate = {
		mailboxIds: { [draftsMailbox.id]: true },
		keywords: { $draft: true },
		from: [{ name: identity.name, email: identity.email }],
		to: params.to,
		cc: params.cc,
		bcc: params.bcc,
		subject: params.subject,
		bodyValues: {
			body: { value: params.textBody },
		} as unknown as EmailCreate["bodyValues"],
		textBody: [
			{ partId: "body", type: "text/plain" },
		] as EmailCreate["textBody"],
	};

	if (params.inReplyTo) {
		emailCreate.inReplyTo = [params.inReplyTo];
	}
	if (params.references) {
		emailCreate.references = params.references;
	}

	// Create email and submit in one request
	const responses = await client.request([
		[
			"Email/set",
			{
				accountId,
				create: { draft: emailCreate },
			},
			"0",
		],
		[
			"EmailSubmission/set",
			{
				accountId,
				create: {
					submission: {
						identityId: identity.id,
						emailId: "#draft",
						envelope: null,
					},
				},
				onSuccessUpdateEmail: {
					"#submission": {
						mailboxIds: { [sentMailbox.id]: true },
						"keywords/$draft": null,
					},
				},
			},
			"1",
		],
	]);

	// Extract created email ID and check for errors
	const emailSetResponse = responses[0];
	if (!emailSetResponse) {
		throw new Error("No response from Email/set");
	}

	const emailSetResult = emailSetResponse[1] as {
		created?: Record<string, { id: string }>;
		notCreated?: Record<string, { type: string; description?: string }>;
	};

	// Check for creation errors
	if (emailSetResult.notCreated?.draft) {
		const err = emailSetResult.notCreated.draft;
		console.error("[Email/set notCreated]", JSON.stringify(err, null, 2));
		throw new Error(
			`Failed to create email: ${err.type}${err.description ? ` - ${err.description}` : ""}`,
		);
	}

	const emailId = emailSetResult.created?.draft?.id;
	if (!emailId) {
		console.error(
			"[Email/set response]",
			JSON.stringify(emailSetResult, null, 2),
		);
		throw new Error("Failed to create email - no ID returned");
	}

	// Check submission response
	const submissionResponse = responses[1];
	if (submissionResponse) {
		const submissionResult = submissionResponse[1] as {
			created?: Record<string, unknown>;
			notCreated?: Record<string, { type: string; description?: string }>;
		};
		if (submissionResult.notCreated?.submission) {
			const err = submissionResult.notCreated.submission;
			console.error(
				"[EmailSubmission/set notCreated]",
				JSON.stringify(err, null, 2),
			);
			throw new Error(
				`Failed to submit email: ${err.type}${err.description ? ` - ${err.description}` : ""}`,
			);
		}
	}

	return emailId;
}

// ============ Attachment Methods ============

export interface AttachmentInfo {
	blobId: string;
	name: string | null;
	type: string;
	size: number;
}

export async function getAttachments(
	emailId: string,
): Promise<AttachmentInfo[]> {
	const email = await getEmail(emailId);
	if (!email) {
		throw new Error(`Email not found: ${emailId}`);
	}

	if (!email.attachments || email.attachments.length === 0) {
		return [];
	}

	return email.attachments
		.filter((a) => a.blobId)
		.map((a) => ({
			blobId: a.blobId as string,
			name: a.name,
			type: a.type,
			size: a.size,
		}));
}

export async function downloadAttachment(
	emailId: string,
	blobId: string,
): Promise<{
	content: string;
	data: Uint8Array;
	type: string;
	name: string | null;
	size: number;
	isText: boolean;
}> {
	const client = getClient();
	const accountId = await client.getAccountId();

	// Get attachment info for the name
	const attachments = await getAttachments(emailId);
	const attachment = attachments.find((a) => a.blobId === blobId);
	if (!attachment) {
		throw new Error(`Attachment not found: ${blobId}`);
	}

	const { data, type } = await client.downloadBlob(blobId, accountId);
	const bytes = new Uint8Array(data);

	// Determine if it's text-based content
	const isText =
		type.startsWith("text/") ||
		type.includes("json") ||
		type.includes("xml") ||
		type.includes("javascript") ||
		type.includes("csv");

	if (isText) {
		// Return as text
		const decoder = new TextDecoder();
		return {
			content: decoder.decode(data),
			data: bytes,
			type,
			name: attachment.name,
			size: bytes.length,
			isText: true,
		};
	}

	// For binary files, return raw data (caller decides what to do)
	return {
		content: "", // Not used for binary
		data: bytes,
		type,
		name: attachment.name,
		size: bytes.length,
		isText: false,
	};
}

// Helper to build a reply
export async function buildReply(
	originalEmailId: string,
	replyBody: string,
): Promise<SendEmailParams> {
	const original = await getEmail(originalEmailId);
	if (!original) {
		throw new Error(`Original email not found: ${originalEmailId}`);
	}

	// Determine who to reply to
	const replyTo = original.replyTo?.[0] || original.from?.[0];
	if (!replyTo) {
		throw new Error("Cannot determine reply address");
	}

	// Build subject (add Re: if not present)
	let subject = original.subject || "";
	if (!subject.toLowerCase().startsWith("re:")) {
		subject = `Re: ${subject}`;
	}

	// Build references chain
	const references: string[] = [];
	if (original.references) {
		references.push(...original.references);
	}
	if (original.messageId?.[0]) {
		references.push(original.messageId[0]);
	}

	return {
		to: [replyTo],
		subject,
		textBody: replyBody,
		inReplyTo: original.messageId?.[0],
		references: references.length > 0 ? references : undefined,
	};
}

// Helper to build a forward
export async function buildForward(
	originalEmailId: string,
	forwardBody: string,
): Promise<
	SendEmailParams & { originalSubject: string; originalFrom: string }
> {
	const original = await getEmail(originalEmailId);
	if (!original) {
		throw new Error(`Original email not found: ${originalEmailId}`);
	}

	// Build subject (add Fwd: if not present)
	let subject = original.subject || "";
	if (!subject.toLowerCase().startsWith("fwd:")) {
		subject = `Fwd: ${subject}`;
	}

	// Get original body
	let originalBodyText = "";
	if (original.bodyValues) {
		const textPart = original.textBody?.[0];
		if (textPart?.partId && original.bodyValues[textPart.partId]) {
			originalBodyText = original.bodyValues[textPart.partId]?.value ?? "";
		} else {
			const firstValue = Object.values(original.bodyValues)[0];
			if (firstValue) {
				originalBodyText = firstValue.value;
			}
		}
	}

	// Format sender
	const sender = original.from?.[0];
	const senderStr = sender
		? sender.name
			? `${sender.name} <${sender.email}>`
			: sender.email
		: "unknown";

	const date = original.receivedAt
		? new Date(original.receivedAt).toLocaleString()
		: "unknown date";

	// Build full body with attribution
	const fullBody = `${forwardBody}

---------- Forwarded message ---------
From: ${senderStr}
Date: ${date}
Subject: ${original.subject || ""}

${originalBodyText}`;

	return {
		to: [], // Caller must provide
		subject,
		textBody: fullBody,
		originalSubject: original.subject || "",
		originalFrom: senderStr,
	};
}

// ============ Masked Email Methods ============

export async function listMaskedEmails(): Promise<MaskedEmail[]> {
	const client = getClient();
	const accountId = await client.getAccountId();

	const result = await client.call<{ list: MaskedEmail[] }>("MaskedEmail/get", {
		accountId,
		ids: null, // null = get all
	});

	return result.list;
}

export interface CreateMaskedEmailParams {
	forDomain?: string;
	description?: string;
	emailPrefix?: string;
}

export async function createMaskedEmail(
	params: CreateMaskedEmailParams = {},
): Promise<MaskedEmail> {
	const client = getClient();
	const accountId = await client.getAccountId();

	const createObj: Record<string, unknown> = {
		state: "enabled",
	};

	if (params.forDomain) {
		createObj.forDomain = params.forDomain;
	}
	if (params.description) {
		createObj.description = params.description;
	}
	if (params.emailPrefix) {
		createObj.emailPrefix = params.emailPrefix;
	}

	const result = await client.call<{
		created?: Record<string, MaskedEmail>;
		notCreated?: Record<string, { type: string; description?: string }>;
	}>("MaskedEmail/set", {
		accountId,
		create: { new: createObj },
	});

	if (result.notCreated?.new) {
		const err = result.notCreated.new;
		throw new Error(
			`Failed to create masked email: ${err.type}${err.description ? ` - ${err.description}` : ""}`,
		);
	}

	const created = result.created?.new;
	if (!created) {
		throw new Error("No masked email returned from create");
	}

	return created;
}

export async function updateMaskedEmail(
	id: string,
	state: "enabled" | "disabled" | "deleted",
): Promise<void> {
	const client = getClient();
	const accountId = await client.getAccountId();

	const result = await client.call<{
		updated?: Record<string, unknown>;
		notUpdated?: Record<string, { type: string; description?: string }>;
	}>("MaskedEmail/set", {
		accountId,
		update: { [id]: { state } },
	});

	if (result.notUpdated?.[id]) {
		const err = result.notUpdated[id];
		throw new Error(
			`Failed to update masked email: ${err.type}${err.description ? ` - ${err.description}` : ""}`,
		);
	}
}
