import  { tavily } from '@tavily/core';
import { Output, streamText } from "ai"; 
import express from "express";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from './prompt';
import z, { string } from 'zod';

const client = tavily({apiKey: process.env.TAVILY_API_KEY})
const app = express();

app.post("/Perplexity_ask", async (req, res) =>{
    //get the query from the user 
    const query = req.body.query;


    //make sure the user has access/credits to hit the endpoint


    //check if we have web search indexed for a similar query

    // web search to gather resources
   const webSearchResponse = await  client.search(query, {
        searchDepth: "advanced"
    })

    const webSearchResult = webSearchResponse.results;


    // do some context engineering on the prompt + web search responses

    //hit the LLM and stream back the response

    const prompt = PROMPT_TEMPLATE
    .replace("{{WEB_SEARCH_RESULTS}}", JSON.stringify(webSearchResult))
    .replace("{{USER_QUERY}}", query)

        const result = streamText({
            model: 'openai/gpt-5.4',
            prompt: prompt,
            system: SYSTEM_PROMPT,
            output: Output.object({
                schema: z.object({
                  followUps: z.array(z.string()),
                  answer: z.string()
                }),
              }),
            
        });

        for await (const textPart of result.textStream){
            process.stdout.write(textPart)
        }


    // also stream back the sources and the follow up questions (which we can get another  parallel LLm call)

    //close the event stream




})



app.listen(3000, () =>{
    console.log("Server is running on 3000")
})