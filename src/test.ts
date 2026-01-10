#!/usr/bin/env bun
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
	const transport = new StdioClientTransport({
		command: "bun",
		args: ["run", "src/index.ts"],
		env: {
			...process.env,
			FASTMAIL_API_TOKEN: process.env.FASTMAIL_API_TOKEN || "",
		},
	});

	const client = new Client({ name: "fastmail-test", version: "1.0.0" });
	await client.connect(transport);

	console.log("Connected to Fastmail MCP server\n");

	// Test 1: List mailboxes
	console.log("=== Test: list_mailboxes ===");
	try {
		const result = await client.callTool({
			name: "list_mailboxes",
			arguments: {},
		});
		const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
		console.log(text.slice(0, 500) + (text.length > 500 ? "..." : ""));
		console.log("✓ list_mailboxes works\n");
	} catch (e) {
		console.log("✗ list_mailboxes failed:", e);
	}

	// Test 2: List emails in inbox
	console.log("=== Test: list_emails (inbox, limit 3) ===");
	try {
		const result = await client.callTool({
			name: "list_emails",
			arguments: { mailbox: "inbox", limit: 3 },
		});
		const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
		console.log(text.slice(0, 800) + (text.length > 800 ? "..." : ""));
		console.log("✓ list_emails works\n");
	} catch (e) {
		console.log("✗ list_emails failed:", e);
	}

	// Test 3: Search
	console.log("=== Test: search_emails ===");
	try {
		const result = await client.callTool({
			name: "search_emails",
			arguments: { query: "test", limit: 2 },
		});
		const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
		console.log(text.slice(0, 500) + (text.length > 500 ? "..." : ""));
		console.log("✓ search_emails works\n");
	} catch (e) {
		console.log("✗ search_emails failed:", e);
	}

	await client.close();
	console.log("\n=== All tests completed ===");
}

main().catch((e) => {
	console.error("Test failed:", e);
	process.exit(1);
});
