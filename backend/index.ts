import "dotenv/config";
import { tavily } from "@tavily/core";
import express from "express";
import OpenAI from "openai";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompt";
import { middleware } from "./middleware";
import cors from "cors";

const tavilyClient = tavily({
  apiKey: process.env.TAVILY_API_KEY,
});

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
app.use(express.json());
app.use(cors());



// Get past conversations
app.get("/conversations", middleware, async (req, res) => {
  res.json({
    userId: req.userId,
  });
});

// Get a specific conversation
app.post("/conversations/:conversationId", middleware, async (req, res) => {
 
});



app.post("/Perplexity_ask", middleware, async (req, res) => {
  try {
    // 1. Get user query
    const query = req.body.query;

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        error: "Query is required",
      });
    }

    console.log("Query:", query);

    // 2. Search the web using Tavily
    const webSearchResponse = await tavilyClient.search(query, {
      searchDepth: "advanced",
    });

    const webSearchResult = webSearchResponse.results;

    console.log("Tavily search completed");

    // 3. Add Tavily results + user query to prompt
    const prompt = PROMPT_TEMPLATE
      .replace("{{WEB_SEARCH_RESULTS}}",JSON.stringify(webSearchResult))
      .replace("{{USER_QUERY}}", query);


    // 4. Send web information to OpenAI

    const response = await openaiClient.responses.create({
      model: "gpt-4o-mini",
      instructions: SYSTEM_PROMPT,
      input: prompt,
    });

    console.log("OpenAI response generated");


    // 5. Return answer + sources
    return res.json({
      answer: response.output_text,
      sources: webSearchResult.map((result) => ({
        title: result.title,
        url: result.url
      })),
    });
  } catch (error) {
    console.error("ERROR:", error);

    if (!res.headersSent) {
      return res.status(500).json({
        error:
          error instanceof Error ? error.message : String(error),
      });
    }
  }
});


app.post("/Perplexity_ask/follow_up",middleware, async (req, res) => {
    //step 1. get the existing the chat from db
    //step2. forward the full history to the llm
    //step 2.5 todo do the context engineering here 

    // step3. stream the response to the user

})

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});