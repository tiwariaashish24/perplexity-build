import type { NextFunction, Request, Response } from "express";
import { createSupabaseClient } from "./client";
import { prisma } from "./db";

const client = createSupabaseClient();

export async function middleware(req: Request, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    res.status(401).json({ message: "A valid Supabase access token is required." });
    return;
  }

  try {
    const { data, error } = await client.auth.getUser(token);
    const authUser = data.user;
    if (error || !authUser) {
      res.status(401).json({ message: "Your session is invalid or has expired. Please sign in again." });
      return;
    }

    const email = authUser.email?.trim().toLowerCase();
    if (!email) {
      res.status(400).json({ message: "Your account must have an email address to use search." });
      return;
    }

    const authProvider = authUser.app_metadata.provider;
    if (authProvider !== "google" && authProvider !== "github") {
      res.status(400).json({ message: "This sign-in provider is not supported." });
      return;
    }

    const displayName =
      authUser.user_metadata.full_name?.trim() ||
      authUser.user_metadata.name?.trim() ||
      email.split("@")[0] ||
      email;

    // Use the local database ID for conversation ownership; an existing account
    // matched by email may not have the same ID as its Supabase auth user.
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        id: authUser.id,
        email,
        provider: authProvider === "google" ? "Google" : "Github",
        name: displayName,
      },
      update: {
        provider: authProvider === "google" ? "Google" : "Github",
        name: displayName,
      },
      select: { id: true },
    });

    req.userId = user.id;
    next();
  } catch (error) {
    console.error("Authentication or user provisioning failed:", error);
    res.status(500).json({ message: "Unable to prepare your account. Please try again." });
  }
}
