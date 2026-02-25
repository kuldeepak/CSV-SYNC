// Find product variant by SKU
export async function findVariant(admin, sku) {

  const query = `
  {
    productVariants(first: 1, query: "sku:${sku}") {
      edges {
        node {
          id
          price
        }
      }
    }
  }
  `;

  const res = await admin.request(query);

  return res.data.productVariants.edges[0]?.node;
}


// Update variant price
export async function updatePrice(admin, variantId, price) {

  const mutation = `
  mutation {
    productVariantsBulkUpdate(
      variants: [{
        id: "${variantId}",
        price: "${price}"
      }]
    ) {
      userErrors {
        message
      }
    }
  }
  `;

  const res = await admin.request(mutation);

  const errors =
    res.data.productVariantsBulkUpdate.userErrors;

  if (errors.length) {
    throw new Error(errors[0].message);
  }
}