// import cron from "node-cron";
// import prisma from "./db.server";
// import { readSheetCSV } from "./lib/readSheet.server";
// import { json } from "@remix-run/node";

// const API_VERSION = "2024-10";

// /* ================================
//    Shopify GraphQL Helper
// ================================ */

// async function graphqlForShop(shop, token, query) {
//   const res = await fetch(
//     `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
//     {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "X-Shopify-Access-Token": token,
//       },
//       body: JSON.stringify({ query }),
//     }
//   );

//   const jsonData = await res.json();

//   if (!res.ok || jsonData.errors) {
//     throw new Error(JSON.stringify(jsonData.errors || jsonData));
//   }

//   return jsonData.data;
// }

// /* ================================
//    Get Offline Token
// ================================ */

// async function getOfflineSession() {
//   const offline = await prisma.session.findFirst({
//     where: { id: { startsWith: "offline_" } },
//     select: { id: true, accessToken: true },
//   });

//   if (!offline?.accessToken) {
//     throw new Error("No offline token found. Reinstall app.");
//   }

//   return {
//     shop: offline.id.replace("offline_", ""),
//     token: offline.accessToken,
//   };
// }

// /* ================================
//    Find Variant by SKU
// ================================ */

// async function findVariantByProductAndSKU(
//   shop,
//   token,
//   productId,
//   sku
// ) {
//   const query = `
//     {
//       product(id: "gid://shopify/Product/${productId}") {
//         variants(first: 100) {
//           edges {
//             node {
//               id
//               sku
//             }
//           }
//         }
//       }
//     }
//   `;

//   const data = await graphqlForShop(shop, token, query);

//   const variants =
//     data?.product?.variants?.edges || [];

//   const match = variants.find(
//     (v) => v.node.sku?.trim() === sku
//   );

//   return match ? match.node : null;
// }

// /* ================================
//    Update Price
// ================================ */

// async function updatePrice(shop, token, productId, variantId, price) {
//   const mutation = `
//     mutation {
//       productVariantsBulkUpdate(
//         productId: "gid://shopify/Product/${productId}",
//         variants: [
//           {
//             id: "${variantId}",
//             price: "${price}"
//           }
//         ]
//       ) {
//         userErrors {
//           message
//         }
//       }
//     }
//   `;

//   const data = await graphqlForShop(
//     shop,
//     token,
//     mutation
//   );

//   const errors =
//     data?.productVariantsBulkUpdate?.userErrors;

//   if (errors?.length) {
//     throw new Error(
//       errors.map((e) => e.message).join(", ")
//     );
//   }
// }

// /* ================================
//    Main Sync Function
// ================================ */

// async function runOnce() {
//   try {
//     console.log("⏳ Sync Started...");

//     const { shop, token } =
//       await getOfflineSession();

//     // Auth check
//     const ping = await graphqlForShop(
//       shop,
//       token,
//       `query { shop { name } }`
//     );

//     console.log("✅ Auth:", ping.shop.name);

//     const rows = await readSheetCSV();

//     const BATCH_SIZE = 10;

//     // Only "u"
//     const validRows = rows.filter((row) => {
//       const status = (row["status"] || "")
//         .toString()
//         .trim()
//         .toLowerCase();

//       return status === "u";
//     });

//     const batch = validRows.slice(0, BATCH_SIZE);

//     let updated = [];
//     let failed = [];
//     let skipped = [];

//     console.log(`📦 Processing ${batch.length} rows`);

//     for (const row of batch) {
//       const sku =
//         row["product sku"]?.trim();
//       const price =
//         row["recommended price"];
//       const productId =
//         row["internal product id"];

//       if (!sku || !price || !productId) {
//         skipped.push({
//           sku,
//           reason: "Missing data",
//         });
//         continue;
//       }

//       try {
//         const variant =
//           await findVariantByProductAndSKU(
//             shop,
//             token,
//             productId,
//             sku
//           );

//         if (!variant) {
//           skipped.push({
//             sku,
//             reason: "Variant not found",
//           });
//           continue;
//         }

//         await updatePrice(
//           shop,
//           token,
//           productId,
//           variant.id,
//           price
//         );

//         updated.push(sku);

//         // Rate limit safety
//         await new Promise((r) =>
//           setTimeout(r, 300)
//         );
//       } catch (err) {
//         failed.push({
//           sku,
//           reason: err.message,
//         });
//       }
//     }

//     console.log("✅ Updated:", updated);
//     console.log("❌ Failed:", failed);
//     console.log("⏭ Skipped:", skipped);

//     console.log("🎉 Batch Done");

//   } catch (err) {
//     console.error("❌ Sync Error:", err);
//   }
// }

// /* ================================
//    Remix Loader (Manual Run)
// ================================ */

// export async function loader() {
//   try {
//     await runOnce();

//     return json({
//       success: true,
//       message: "Sync executed",
//     });

//   } catch (err) {
//     return json({
//       success: false,
//       error: err.message,
//     });
//   }
// }

// /* ================================
//    Cron (Auto Run)
// ================================ */

// // Run on server start
// runOnce();

// // Run every minute
// cron.schedule("* * * * *", runOnce);