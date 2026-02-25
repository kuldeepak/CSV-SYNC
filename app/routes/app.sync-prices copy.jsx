

// import { json } from "@remix-run/node";
// import { useLoaderData } from "@remix-run/react";

// import { readSheetCSV } from "../lib/readSheet.server";
// import { authenticate } from "../../app/shopify.server";



// // ======================================
// // GET VARIANT FROM PRODUCT ID + SKU
// // ======================================
// async function findVariantByProductAndSKU(admin, productId, sku) {
//   const query = `
//   {
//     product(id: "gid://shopify/Product/${productId}") {
//       id
//       variants(first: 100) {
//         edges {
//           node {
//             id
//             sku
//             price
//           }
//         }
//       }
//     }
//   }
//   `;

//   const res = await admin.graphql(query);
//   const data = await res.json();

//   const variants =
//     data.data.product?.variants?.edges || [];

//   // Find matching SKU
//   return variants.find(v => v.node.sku === sku)?.node || null;
// }



// // ======================================
// // UPDATE PRICE
// // ======================================
// async function updatePrice(admin, productId, variantId, price) {
//   const mutation = `
//   mutation {
//     productVariantsBulkUpdate(
//       productId: "gid://shopify/Product/${productId}",
//       variants: [{
//         id: "${variantId}",
//         price: "${price}"
//       }]
//     ) {
//       userErrors {
//         message
//       }
//     }
//   }
//   `;

//   const res = await admin.graphql(mutation);
//   const data = await res.json();

//   const errors =
//     data.data.productVariantsBulkUpdate.userErrors;

//   if (errors.length) {
//     throw new Error(errors[0].message);
//   }
// }



// // ======================================
// // AUTO SYNC
// // ======================================
// export async function loader({ request }) {
//   try {
//     const { admin } = await authenticate.admin(request);

//     const rows = await readSheetCSV();

//     let updated = 0;
//     const skipped = [];
//     const failed = [];

//     for (const row of rows) {
//       const sku = row["product sku"]?.trim();
//       const price = row["recommended price"];
//       const productId = row["internal product id"]; // numeric ID

//       // Validation
//       if (!sku || !price || !productId) {
//         skipped.push({
//           sku,
//           reason: "Missing SKU / Price / Product ID",
//         });
//         continue;
//       }

//       try {
//         // 🔍 Find variant using Product ID + SKU
//         const variant = await findVariantByProductAndSKU(
//           admin,
//           productId,
//           sku
//         );

//         if (!variant) {
//           skipped.push({
//             sku,
//             reason: "SKU not found in product",
//           });
//           continue;
//         }

//         // ✅ Update price
//         await updatePrice(
//           admin,
//           productId,
//           variant.id,
//           price
//         );

//         updated++;

//         // Rate limit safety
//         await new Promise(r => setTimeout(r, 300));

//       } catch (err) {
//         failed.push({
//           sku,
//           reason: err.message,
//         });
//       }
//     }

//     return json({
//       success: true,
//       totalRows: rows.length,
//       updated,
//       skipped,
//       failed,
//     });

//   } catch (err) {
//     console.error("SYNC ERROR:", err);

//     return json({
//       success: false,
//       error: err.message,
//     });
//   }
// }



// // ======================================
// // UI
// // ======================================
// export default function SyncPage() {
//   const data = useLoaderData();

//   return (
//     <div style={{ padding: 20 }}>
//       <h2>CSV → Shopify Product+SKU Sync</h2>

//       {data.success ? (
//         <>
//           <p>Total Rows: {data.totalRows}</p>
//           <p>Updated: {data.updated}</p>
//           <p>Skipped: {data.skipped.length}</p>

//           {data.failed.length > 0 && (
//             <>
//               <h4>Failed</h4>
//               <ul>
//                 {data.failed.map((f, i) => (
//                   <li key={i}>
//                     {f.sku} - {f.reason}
//                   </li>
//                 ))}
//               </ul>
//             </>
//           )}

//           {data.skipped.length > 0 && (
//             <>
//               <h4>Skipped</h4>
//               <ul>
//                 {data.skipped.map((s, i) => (
//                   <li key={i}>
//                     {s.sku} - {s.reason}
//                   </li>
//                 ))}
//               </ul>
//             </>
//           )}
//         </>
//       ) : (
//         <p style={{ color: "red" }}>
//           Error: {data.error}
//         </p>
//       )}
//     </div>
//   );
// }