import { shopifyApi } from "@shopify/shopify-api";
import "@shopify/shopify-api/adapters/node";


// Use env values
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: [],
  hostName: process.env.SHOPIFY_HOST,
  apiVersion: "2024-01",
});


export async function getShopifyAdmin() {

  const session = {
    shop: process.env.SHOPIFY_SHOP,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
  };

  return new shopify.clients.Graphql({
    session,
  });
}