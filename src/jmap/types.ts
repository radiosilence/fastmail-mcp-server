// JMAP Core Types
// Based on RFC 8620 (JMAP Core) and RFC 8621 (JMAP Mail)

export interface JMAPSession {
	capabilities: Record<string, unknown>;
	accounts: Record<string, JMAPAccount>;
	primaryAccounts: Record<string, string>;
	username: string;
	apiUrl: string;
	downloadUrl: string;
	uploadUrl: string;
	eventSourceUrl: string;
	state: string;
}

export interface JMAPAccount {
	name: string;
	isPersonal: boolean;
	isReadOnly: boolean;
	accountCapabilities: Record<string, unknown>;
}

export interface JMAPRequest {
	using: string[];
	methodCalls: JMAPMethodCall[];
}

export type JMAPMethodCall = [string, Record<string, unknown>, string];

export interface JMAPResponse {
	methodResponses: JMAPMethodResponse[];
	sessionState: string;
}

export type JMAPMethodResponse = [string, Record<string, unknown>, string];

// Mailbox Types
export interface Mailbox {
	id: string;
	name: string;
	parentId: string | null;
	role: MailboxRole | null;
	sortOrder: number;
	totalEmails: number;
	unreadEmails: number;
	totalThreads: number;
	unreadThreads: number;
	myRights: MailboxRights;
	isSubscribed: boolean;
}

export type MailboxRole =
	| "all"
	| "archive"
	| "drafts"
	| "flagged"
	| "important"
	| "inbox"
	| "junk"
	| "sent"
	| "subscribed"
	| "trash";

export interface MailboxRights {
	mayReadItems: boolean;
	mayAddItems: boolean;
	mayRemoveItems: boolean;
	maySetSeen: boolean;
	maySetKeywords: boolean;
	mayCreateChild: boolean;
	mayRename: boolean;
	mayDelete: boolean;
	maySubmit: boolean;
}

// Email Types
export interface Email {
	id: string;
	blobId: string;
	threadId: string;
	mailboxIds: Record<string, boolean>;
	keywords: Record<string, boolean>;
	size: number;
	receivedAt: string;
	messageId: string[] | null;
	inReplyTo: string[] | null;
	references: string[] | null;
	sender: EmailAddress[] | null;
	from: EmailAddress[] | null;
	to: EmailAddress[] | null;
	cc: EmailAddress[] | null;
	bcc: EmailAddress[] | null;
	replyTo: EmailAddress[] | null;
	subject: string | null;
	sentAt: string | null;
	hasAttachment: boolean;
	preview: string;
	bodyStructure?: EmailBodyPart;
	bodyValues?: Record<string, EmailBodyValue>;
	textBody?: EmailBodyPart[];
	htmlBody?: EmailBodyPart[];
	attachments?: EmailBodyPart[];
	headers?: EmailHeader[];
}

export interface EmailAddress {
	name: string | null;
	email: string;
}

export interface EmailBodyPart {
	partId: string | null;
	blobId: string | null;
	size: number;
	headers?: EmailHeader[];
	name: string | null;
	type: string;
	charset: string | null;
	disposition: string | null;
	cid: string | null;
	language: string[] | null;
	location: string | null;
	subParts?: EmailBodyPart[];
}

export interface EmailBodyValue {
	value: string;
	isEncodingProblem: boolean;
	isTruncated: boolean;
}

export interface EmailHeader {
	name: string;
	value: string;
}

// Identity Types (for sending)
export interface Identity {
	id: string;
	name: string;
	email: string;
	replyTo: EmailAddress[] | null;
	bcc: EmailAddress[] | null;
	textSignature: string;
	htmlSignature: string;
	mayDelete: boolean;
}

// EmailSubmission Types
export interface EmailSubmission {
	id: string;
	identityId: string;
	emailId: string;
	threadId: string;
	envelope: Envelope | null;
	sendAt: string;
	undoStatus: "pending" | "final" | "canceled";
	deliveryStatus: Record<string, DeliveryStatus> | null;
	dsnBlobIds: string[];
	mdnBlobIds: string[];
}

export interface Envelope {
	mailFrom: EnvelopeAddress;
	rcptTo: EnvelopeAddress[];
}

export interface EnvelopeAddress {
	email: string;
	parameters: Record<string, string | null> | null;
}

export interface DeliveryStatus {
	smtpReply: string;
	delivered: "queued" | "yes" | "no" | "unknown";
	displayed: "unknown" | "yes";
}

// Helper type for creating emails
export interface EmailCreate {
	mailboxIds: Record<string, boolean>;
	keywords?: Record<string, boolean>;
	from?: EmailAddress[];
	to?: EmailAddress[];
	cc?: EmailAddress[];
	bcc?: EmailAddress[];
	replyTo?: EmailAddress[];
	subject?: string;
	sentAt?: string;
	bodyStructure?: EmailBodyPart;
	bodyValues?: Record<string, EmailBodyValue>;
	textBody?: EmailBodyPart[];
	htmlBody?: EmailBodyPart[];
	inReplyTo?: string[];
	references?: string[];
	messageId?: string[];
	headers?: EmailHeader[];
}
