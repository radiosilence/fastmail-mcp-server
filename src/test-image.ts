#!/usr/bin/env bun
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, writeFileSync } from "node:fs";

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

	// Search for the test email
	console.log("=== Searching for 'CLAUDE TEST IMAGE 3' ===");
	const searchResult = await client.callTool({
		name: "search_emails",
		arguments: { subject: "CLAUDE TEST IMAGE 3", limit: 1 },
	});
	const searchText =
		(searchResult.content as Array<{ text: string }>)[0]?.text ?? "";
	console.log(searchText);

	// Extract email ID from search results
	const idMatch = searchText.match(/ID: ([^\s\n]+)/);
	if (!idMatch) {
		console.error("Could not find email ID");
		await client.close();
		return;
	}
	const emailId = idMatch[1];
	console.log(`\nFound email ID: ${emailId}\n`);

	// List attachments to get blob ID
	console.log("=== Listing attachments ===");
	const attachListResult = await client.callTool({
		name: "list_attachments",
		arguments: { email_id: emailId },
	});
	const attachListText =
		(attachListResult.content as Array<{ text: string }>)[0]?.text ?? "";
	console.log(attachListText);

	// Extract blob ID from attachments list
	const blobMatch = attachListText.match(/Blob ID: ([^\s\n)]+)/);
	if (!blobMatch) {
		console.error("Could not find blob ID");
		await client.close();
		return;
	}
	const blobId = blobMatch[1];
	console.log(`\nFound blob ID: ${blobId}\n`);

	// Get the attachment
	console.log("=== Getting attachment ===");
	const attachResult = await client.callTool({
		name: "get_attachment",
		arguments: { email_id: emailId, blob_id: blobId },
	});

	// Write results to tmp dir
	mkdirSync("/tmp/mcp-test", { recursive: true });

	const content = attachResult.content as Array<{
		type: string;
		text?: string;
		data?: string;
		mimeType?: string;
	}>;
	console.log(`\nAttachment response has ${content.length} content blocks:`);

	for (let i = 0; i < content.length; i++) {
		const block = content[i];
		console.log(`  [${i}] type: ${block.type}`);
		if (block.type === "text") {
			console.log(`      text: ${block.text}`);
			writeFileSync(`/tmp/mcp-test/block-${i}.txt`, block.text || "");
		} else if (block.type === "image") {
			console.log(`      mimeType: ${block.mimeType}`);
			console.log(`      data length: ${block.data?.length} chars`);
			const buffer = Buffer.from(block.data || "", "base64");
			console.log(
				`      decoded size: ${buffer.length} bytes (${Math.round(buffer.length / 1024)}KB)`,
			);
			const ext = block.mimeType?.split("/")[1] || "bin";
			writeFileSync(`/tmp/mcp-test/block-${i}.${ext}`, buffer);
			console.log(`      wrote to /tmp/mcp-test/block-${i}.${ext}`);
		}
	}

	await client.close();
	console.log("\n=== Done ===");
}

main().catch((e) => {
	console.error("Test failed:", e);
	process.exit(1);
});
