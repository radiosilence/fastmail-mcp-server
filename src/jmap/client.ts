import type {
	JMAPMethodCall,
	JMAPMethodResponse,
	JMAPRequest,
	JMAPResponse,
	JMAPSession,
} from "./types.js";

const FASTMAIL_SESSION_URL = "https://api.fastmail.com/jmap/session";

export class JMAPClient {
	private session: JMAPSession | null = null;
	private token: string;

	constructor(token: string) {
		this.token = token;
	}

	async getSession(): Promise<JMAPSession> {
		if (this.session) {
			return this.session;
		}

		const response = await fetch(FASTMAIL_SESSION_URL, {
			headers: {
				Authorization: `Bearer ${this.token}`,
			},
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Failed to get JMAP session: ${response.status} ${text}`);
		}

		this.session = (await response.json()) as JMAPSession;
		return this.session;
	}

	async getAccountId(): Promise<string> {
		const session = await this.getSession();
		const accountId = session.primaryAccounts["urn:ietf:params:jmap:mail"];
		if (!accountId) {
			throw new Error("No mail account found in session");
		}
		return accountId;
	}

	async request(methodCalls: JMAPMethodCall[]): Promise<JMAPMethodResponse[]> {
		const session = await this.getSession();

		const request: JMAPRequest = {
			using: [
				"urn:ietf:params:jmap:core",
				"urn:ietf:params:jmap:mail",
				"urn:ietf:params:jmap:submission",
			],
			methodCalls,
		};

		const response = await fetch(session.apiUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`JMAP request failed: ${response.status} ${text}`);
		}

		const result = (await response.json()) as JMAPResponse;

		// Check for JMAP-level errors in responses
		for (const [methodName, data] of result.methodResponses) {
			if (methodName === "error") {
				const errorData = data as { type: string; description?: string };
				throw new Error(
					`JMAP error: ${errorData.type}${errorData.description ? ` - ${errorData.description}` : ""}`,
				);
			}
		}

		return result.methodResponses;
	}

	// Helper to make a single method call and extract the response
	async call<T>(
		method: string,
		args: Record<string, unknown>,
		callId = "0",
	): Promise<T> {
		const responses = await this.request([[method, args, callId]]);
		const response = responses[0];
		if (!response) {
			throw new Error(`No response for method ${method}`);
		}
		return response[1] as T;
	}
}

// Singleton client instance
let client: JMAPClient | null = null;

export function getClient(): JMAPClient {
	if (!client) {
		const token = process.env.FASTMAIL_API_TOKEN;
		if (!token) {
			throw new Error(
				"FASTMAIL_API_TOKEN environment variable is required. " +
					"Generate one at Fastmail → Settings → Privacy & Security → Integrations → API tokens",
			);
		}
		client = new JMAPClient(token);
	}
	return client;
}
