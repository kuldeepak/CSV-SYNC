// import { findVariant, updateVariantPrice } from "./shopifyApi.js";



// export async function processCSV(data, admin) {

//   for (const item of data) {

//     const sku = item.sku;
//     const price = item.price;

//     if (!sku || !price) continue;

//     // Find variant
//     const variant = await findVariant(admin, sku);

//     if (!variant) {
//       console.log("❌ Not found:", sku);
//       continue;
//     }

//     const variantId = variant.id;
//     const productId = variant.product.id;

//     // Update price
//     await updateVariantPrice(
//       admin,
//       variantId,
//       productId,
//       price
//     );

//     console.log("✅ Updated:", sku, price);
//   }
// }

// Find product variant by SKU


import { findVariant, updatePrice } from "./shopifyApi.js";


export async function processCSV(data, admin) {

  for (const row of data) {

    try {

      const { sku, price } = row;

      const variant = await findVariant(admin, sku);

      if (!variant) {
        console.log(`⚠️ SKU not found: ${sku}`);
        continue;
      }

      await updatePrice(admin, variant.id, price);

      console.log(`✅ Updated ${sku} → ${price}`);

    } catch (err) {

      console.log(
        `❌ Failed ${row.sku}:`,
        err.message
      );

    }
  }
}