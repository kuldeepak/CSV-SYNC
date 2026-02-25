// import cron from "node-cron";
// import prisma from "./db.server";
// import { readSheetCSV } from "./lib/readSheet.server";

// const API_VERSION = "2024-10";

// async function graphqlForShop(shop, accessToken, query) {
//   const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       "X-Shopify-Access-Token": accessToken,
//     },
//     body: JSON.stringify({ query }),
//   });

//   const json = await res.json();
//   if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
//   if (json.errors) throw new Error(JSON.stringify(json.errors));
//   return json.data;
// }

// async function runOnce() {
//   // :white_check_mark: get your installed shop offline token
//   const offline = await prisma.session.findFirst({
//     where: { id: { startsWith: "offline_" } },
//     select: { id: true, accessToken: true },
//   });

//   if (!offline?.accessToken) {
//     throw new Error("No offline access token found. Install app on the store first.");
//   }

//   const shop = offline.id.replace("offline_", "");
//   const token = offline.accessToken;

//   // :white_check_mark: verify auth
//   const ping = await graphqlForShop(shop, token, `query { shop { name } }`);
//   console.log(":white_check_mark: Auth OK for:", shop, "-", ping.shop.name);

//   // --- your sync ---
//   const rows = await readSheetCSV();
//   let updated = 0;

//   for (const row of rows) {
//     const sku = row["product sku"]?.trim();
//     const price = row["recommended price"];
//     const productId = row["internal product id"];
//     if (!sku || !price || !productId) continue;

//     const data = await graphqlForShop(
//       shop,
//       token,
//       `{
//         product(id: "gid://shopify/Product/${productId}") {
//           variants(first: 100) { edges { node { id sku } } }
//         }
//       }`
//     );

//     const edges = data.product?.variants?.edges || [];
//     const variant = edges.find(e => e.node.sku === sku)?.node;
//     if (!variant) continue;

//     await graphqlForShop(
//       shop,
//       token,
//       `mutation {
//         productVariantsBulkUpdate(
//           productId: "gid://shopify/Product/${productId}",
//           variants: [{ id: "${variant.id}", price: "${price}" }]
//         ) { userErrors { message } }
//       }`
//     );

//     updated++;
//     await new Promise(r => setTimeout(r, 300));
//   }

//   console.log(`:white_check_mark: Done. Updated=${updated}/${rows.length}`);
// }

// runOnce();
// cron.schedule("* * * * *", runOnce);