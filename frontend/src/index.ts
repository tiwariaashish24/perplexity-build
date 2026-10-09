import { serve } from "bun";
import index from "./index.html";

const server = serve({
  port: Number(process.env.PORT ?? 3001),
  routes: {
    "/api/config": {
      GET() {
        const supabaseUrl = process.env.BUN_PUBLIC_SUPABASE_URL;
        const supabasePublishableKey = process.env.BUN_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

        if (!supabaseUrl || !supabasePublishableKey) {
          return Response.json({ error: "Missing Supabase environment variables" }, { status: 500 });
        }

        return Response.json({ supabaseUrl, supabasePublishableKey });
      },
    },
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
