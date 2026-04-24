#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:3000/v1/brave";
const PROJECT_TOKEN = process.env.OPENCLAW_PROJECT_TOKEN;

if (!PROJECT_TOKEN) {
    console.error("Error: OPENCLAW_PROJECT_TOKEN environment variable is required.");
    process.exit(1);
}

const server = new Server(
    {
        name: "brave-search-gateway-mcp",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "brave_web_search",
                description:
                    "Search the web using Brave Search API (routed through OpenClaw Gateway). Use this for general queries, news, and finding web pages. Supports modifiers like freshness (pd, pw, pm, py) and country codes.",
                inputSchema: {
                    type: "object",
                    properties: {
                        q: {
                            type: "string",
                            description: "The user's search query term. Supports operators (e.g., 'climate change' or filetype:pdf).",
                        },
                        count: {
                            type: "number",
                            description: "Number of search results to return (max 20, default 10).",
                            minimum: 1,
                            maximum: 20,
                        },
                        freshness: {
                            type: "string",
                            description: "Filters results by time. Use: pd (24h), pw (7 days), pm (31 days), py (year), or a custom range like '2022-04-01to2022-07-30'.",
                        },
                        country: {
                            type: "string",
                            description: "Target search results for a specific country using 2-character country code (e.g., US, UK, DE, ES).",
                        },
                    },
                    required: ["q"],
                },
            },
            {
                name: "brave_local_pois",
                description:
                    "Fetch detailed Point of Interest (POI) data (like addresses, reviews, hours) from Brave Search using location IDs returned by brave_web_search.",
                inputSchema: {
                    type: "object",
                    properties: {
                        ids: {
                            type: "array",
                            items: { type: "string" },
                            description: "List of location IDs (max 20) retrieved from a previous brave_web_search call.",
                        },
                    },
                    required: ["ids"],
                },
            },
            {
                name: "brave_local_descriptions",
                description:
                    "Fetch AI-generated descriptions for locations using their Brave Search location IDs. Use after brave_web_search returns location results.",
                inputSchema: {
                    type: "object",
                    properties: {
                        ids: {
                            type: "array",
                            items: { type: "string" },
                            description: "List of location IDs (max 20) retrieved from a previous brave_web_search call.",
                        },
                    },
                    required: ["ids"],
                },
            },
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        if (request.params.name === "brave_web_search") {
            const { q, count = 10, freshness, country } = request.params.arguments as any;

            const url = new URL(`${GATEWAY_URL}/search`);
            url.searchParams.append("q", q);
            url.searchParams.append("count", count.toString());
            if (freshness) url.searchParams.append("freshness", freshness);
            if (country) url.searchParams.append("country", country);

            const response = await fetch(url.toString(), {
                headers: {
                    "Authorization": `Bearer ${PROJECT_TOKEN}`,
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gateway returned ${response.status}: ${errorText}`);
            }

            const data = await response.json();

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(data, null, 2),
                    },
                ],
            };
        } else if (request.params.name === "brave_local_pois") {
            const { ids } = request.params.arguments as any;

            const url = new URL(`${GATEWAY_URL}/local/pois`);
            for (const id of ids) {
                url.searchParams.append("ids", id);
            }

            const response = await fetch(url.toString(), {
                headers: {
                    "Authorization": `Bearer ${PROJECT_TOKEN}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gateway returned ${response.status}: ${errorText}`);
            }

            const data = await response.json();

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(data, null, 2),
                    },
                ],
            };
        } else if (request.params.name === "brave_local_descriptions") {
            const { ids } = request.params.arguments as any;

            const url = new URL(`${GATEWAY_URL}/local/descriptions`);
            for (const id of ids) {
                url.searchParams.append("ids", id);
            }

            const response = await fetch(url.toString(), {
                headers: {
                    "Authorization": `Bearer ${PROJECT_TOKEN}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gateway returned ${response.status}: ${errorText}`);
            }

            const data = await response.json();

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(data, null, 2),
                    },
                ],
            };
        }

        throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error: any) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error executing ${request.params.name}: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});

async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Brave Search Gateway MCP Server running on stdio");
}

run().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
