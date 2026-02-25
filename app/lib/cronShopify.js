import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
import prisma from "../db.server.js";
import "dotenv/config";

// Create standalone Shopify API client
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES?.split(","),
  hostName: process.env.SHOPIFY_APP_URL?.replace(/^https?:\/\//, ""),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});

export async function getCronAdmin() {
  // Get offline session
  const session = await prisma.session.findFirst({
    where: {
      isOnline: false,
    },
  });

  if (!session) {
    throw new Error("No offline session found. Reinstall the app.");
  }

  // Create GraphQL client (WORKS IN CRON)
  return new shopify.clients.Graphql({
    session,
  });
}