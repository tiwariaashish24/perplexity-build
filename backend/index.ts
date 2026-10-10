import "dotenv/config";
import { tavily } from "@tavily/core";
import express from "express";
import OpenAI from "openai";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompt";
import { middleware } from "./middleware";
import cors from "cors";
import { prisma } from "./db";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
  }
}

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const aiProvider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
app.use(express.json());
app.use(cors());

const OPENAI_MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"] as const;
type OpenAIModel = (typeof OPENAI_MODELS)[number];
const DEFAULT_MODEL: OpenAIModel = "gpt-4o-mini";

function getSearchOptions(body: unknown): { model: OpenAIModel; webSearch: boolean } | null {
  if (typeof body !== "object" || body === null) return null;
  const requestBody = body as Record<string, unknown>;
  const model = requestBody.model ?? DEFAULT_MODEL;
  const webSearch = requestBody.webSearch ?? true;
  if (
    typeof model !== "string" ||
    !OPENAI_MODELS.includes(model as OpenAIModel) ||
    typeof webSearch !== "boolean"
  ) {
    return null;
  }
  return { model: model as OpenAIModel, webSearch };
}

async function searchWeb(query: string, enabled: boolean) {
  if (!enabled) return [];
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("Web search is unavailable because TAVILY_API_KEY is not configured.");
  }
  const response = await tavilyClient.search(query, { searchDepth: "advanced" });
  return response.results;
}

function buildPrompt(query: string, searchResults: unknown[]) {
  return PROMPT_TEMPLATE
    .replace("{{WEB_SEARCH_RESULTS}}", JSON.stringify(searchResults))
    .replace("{{USER_QUERY}}", query);
}

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      services: {
        database: "connected",
        openai: process.env.OPENAI_API_KEY ? "configured" : "missing",
        webSearch: process.env.TAVILY_API_KEY ? "configured" : "missing",
      },
    });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(503).json({ status: "error", services: { database: "disconnected" } });
  }
});

function slugify(text: string) {
  const base = text
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60) || "chat";
  return `${base}-${crypto
    .randomUUID()
    .slice(0, 8)}`;
}

function sourcesBlock(results: { title: string; url: string }[]) {
  return `\n<SOURCES>\n${JSON.stringify(results.map(({ title, url }) => ({ title, url })))}\n</SOURCES>\n`;
}

app.get("/conversations", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const conversations = await prisma.conversation.findMany({
      where: { userId: req.userId },
      select: { id: true, title: true, slug: true },
      orderBy: { id: "desc" },
    });
    res.json({ conversations });
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({ message: "Failed to get conversations" });
  }
});

app.get("/conversations/:conversationId", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const conversationId = req.params.conversationId;
    if (typeof conversationId !== "string") {
      res.status(400).json({ message: "Invalid conversation ID" });
      return;
    }
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: req.userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    res.json({ conversation });
  } catch (error) {
    console.error("Get conversation error:", error);
    res.status(500).json({ message: "Failed to get conversation" });
  }
});

app.post("/Perplexity_ask", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const query = req.body.query;
    if (typeof query !== "string" || !query.trim()) {
      res.status(400).json({ error: "Query is required" });
      return;
    }
    const options = getSearchOptions(req.body);
    if (!options) {
      res.status(400).json({
        error: `Choose a supported model (${OPENAI_MODELS.join(", ")}) and a valid web-search setting.`,
      });
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ error: "OpenAI is not configured on the backend." });
      return;
    }
    const cleanQuery = query.trim();
    const webSearchResult = await searchWeb(cleanQuery, options.webSearch);
    const response = await openaiClient.responses.create({
      model: options.model,
      instructions: SYSTEM_PROMPT,
      input: buildPrompt(cleanQuery, webSearchResult),
    });
    const answer = response.output_text;
    if (!answer.trim()) {
      throw new Error("The selected OpenAI model returned an empty answer.");
    }
    const persistedAnswer = options.webSearch
      ? answer + sourcesBlock(webSearchResult)
      : answer;
    const conversation = await prisma.conversation.create({
      data: {
        title: cleanQuery.slice(0, 80),
        slug: slugify(cleanQuery),
        userId: req.userId,
        messages: {
          create: [
            { content: cleanQuery, role: "User" },
            { content: persistedAnswer, role: "Assistant" },
          ],
        },
      },
    });
    res.json({
      conversationId: conversation.id,
      answer,
      sources: webSearchResult.map((result) => ({ title: result.title, url: result.url })),
    });
  } catch (error) {
    console.error("Search request failed:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Search failed. Please try again.",
    });
  }
});

app.post("/Perplexity_ask/follow_up", middleware, async (req, res) => {
  const query = req.body.query;
  const conversationId = req.body.conversationId;
  if (typeof query !== "string" || !query.trim() || typeof conversationId !== "string") {
    res.status(400).json({ message: "Missing query or conversationId" });
    return;
  }
  try {
    if (!req.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const options = getSearchOptions(req.body);
    if (!options) {
      res.status(400).json({
        error: `Choose a supported model (${OPENAI_MODELS.join(", ")}) and a valid web-search setting.`,
      });
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ error: "OpenAI is not configured on the backend." });
      return;
    }
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: req.userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    const webSearchResult = await searchWeb(query.trim(), options.webSearch);
    const history = conversation.messages.map((message) => ({
      role: message.role === "User" ? "user" as const : "assistant" as const,
      content: message.content,
    }));
    const currentPrompt = buildPrompt(query.trim(), webSearchResult);
    await prisma.message.create({
      data: { content: query.trim(), role: "User", conversationId: conversation.id },
    });
    const result = streamText({
      model: aiProvider(options.model),
      system: SYSTEM_PROMPT,
      messages: [...history, { role: "user", content: currentPrompt }],
    });
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Conversation-Id", conversation.id);
    let assistantText = "";
    for await (const textPart of result.textStream) {
      assistantText += textPart;
      res.write(textPart);
    }
    const sources = options.webSearch ? sourcesBlock(webSearchResult) : "";
    res.write(sources);
    res.end();
    await prisma.message.create({
      data: { content: assistantText + sources, role: "Assistant", conversationId: conversation.id },
    });
  } catch (error) {
    console.error("Follow-up error:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Search failed. Please try again." });
    } else {
      res.end();
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});