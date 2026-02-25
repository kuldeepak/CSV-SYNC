import {
    Page,
    Card,
    Button,
    TextField,
    InlineStack,
    Thumbnail,
    Text,
    Badge,
    Divider,
} from "@shopify/polaris";

import {
    useLoaderData,
    useActionData,
    Form,
} from "@remix-run/react";

import { useState } from "react";

import { authenticate } from "../shopify.server";


// ================= LOADER =================

export async function loader({ request, params }) {

    const { admin } = await authenticate.admin(request);

    const productId = decodeURIComponent(params.id);

    const query = `
  {
    product(id: "${productId}") {
      title

      variants(first: 50) {
        edges {
          node {
            id
            sku
            price

            image {
              url
            }

            inventoryItem {
              id

              inventoryLevels(first: 5) {
  edges {
    node {

      quantities(names: ["available"]) {
        name
        quantity
      }

      location {
        id
        name
      }
    }
  }
}
            }
          }
        }
      }
    }
  }
  `;

    const res = await admin.graphql(query);
    const json = await res.json();

    return json.data.product;
}



// ================= ACTION =================

export async function action({ request, params }) {

    const { admin } = await authenticate.admin(request);

    const productId = decodeURIComponent(params.id);

    const form = await request.formData();

    const variantId = form.get("variantId");
    const inventoryItemId = form.get("inventoryItemId");
    const locationId = form.get("locationId");

    const price = form.get("price");
    const stock = form.get("stock");

    try {

        /* ===== PRICE ===== */

        if (price && variantId) {

            const priceMutation = `
      mutation {
        productVariantsBulkUpdate(
          productId: "${productId}",
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

            const res = await admin.graphql(priceMutation);
            const json = await res.json();

            const errors =
                json.data.productVariantsBulkUpdate.userErrors;

            if (errors.length) {
                return { error: errors[0].message };
            }
        }


        /* ===== STOCK (AUTO LOCATION) ===== */

        if (stock && inventoryItemId && locationId) {

            const stockMutation = `
      mutation {
        inventorySetOnHandQuantities(
          input: {
            reason: "correction"
            setQuantities: [{
              inventoryItemId: "${inventoryItemId}"
              locationId: "${locationId}"
              quantity: ${parseInt(stock)}
            }]
          }
        ) {
          userErrors {
            message
          }
        }
      }
      `;

            const res = await admin.graphql(stockMutation);
            const json = await res.json();

            const errors =
                json.data.inventorySetOnHandQuantities.userErrors;

            if (errors.length) {
                return { error: errors[0].message };
            }
        }

        return { success: true };

    } catch (err) {

        console.error("UPDATE ERROR:", err);

        return {
            error: "Update failed"
        };
    }
}



// ================= UI =================

export default function ProductManage() {

    const product = useLoaderData();
    const actionData = useActionData();


    // Controlled inputs
    const [values, setValues] = useState(() => {

        const obj = {};

        product.variants.edges.forEach(v => {

            const level =
                v.node.inventoryItem.inventoryLevels.edges[0]?.node;

            obj[v.node.id] = {
                price: v.node.price,
                stock: level?.available?.toString() || "0",
            };
        });

        return obj;
    });


    function handleChange(id, field, value) {

        setValues(prev => ({
            ...prev,
            [id]: {
                ...prev[id],
                [field]: value,
            },
        }));
    }


    return (
        <Page title={product.title}>

            {/* STATUS */}
            {actionData?.success && (
                <Card sectioned>
                    <Text tone="success">
                        ✅ Updated successfully
                    </Text>
                </Card>
            )}

            {actionData?.error && (
                <Card sectioned>
                    <Text tone="critical">
                        ❌ {actionData.error}
                    </Text>
                </Card>
            )}


            <Card title="Inventory Manager" sectioned>

                {product.variants.edges.map(v => {

                    const variant = v.node;

                    const level =
                        variant.inventoryItem.inventoryLevels.edges[0]?.node;

                    const locationId = level?.location.id || "";
                    const locationName = level?.location.name || "Not stocked";

                    const state = values[variant.id];

                    return (

                        <Form method="post" key={variant.id}>

                            <Card sectioned>

                                <InlineStack gap="600" align="start">


                                    {/* IMAGE */}
                                    <div style={{ width: 90 }}>

                                        {variant.image?.url ? (

                                            <Thumbnail
                                                source={variant.image.url}
                                                alt="Variant"
                                                size="large"
                                            />

                                        ) : (

                                            <div
                                                style={{
                                                    width: 90,
                                                    height: 90,
                                                    background: "#f6f6f7",
                                                    border: "1px dashed #ccc",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    fontSize: "12px",
                                                }}
                                            >
                                                No Image
                                            </div>

                                        )}

                                    </div>


                                    {/* INFO */}
                                    <div style={{ minWidth: 220 }}>

                                        <p><b>SKU:</b> {variant.sku || "N/A"}</p>

                                        <p>
                                            <b>Location:</b>{" "}
                                            <Badge tone="info">
                                                {locationName}
                                            </Badge>
                                        </p>

                                        <p><b>Old Price:</b> ₹{variant.price}</p>

                                        <p>
                                            <b>Old Stock:</b>{" "}
                                            {level?.available ?? 0}
                                        </p>

                                    </div>


                                    {/* EDIT */}
                                    <div style={{ width: 260 }}>

                                        <input
                                            type="hidden"
                                            name="variantId"
                                            value={variant.id}
                                        />

                                        <input
                                            type="hidden"
                                            name="inventoryItemId"
                                            value={variant.inventoryItem.id}
                                        />

                                        <input
                                            type="hidden"
                                            name="locationId"
                                            value={locationId}
                                        />


                                        <TextField
                                            label="New Price"
                                            value={state.price}
                                            onChange={(val) =>
                                                handleChange(
                                                    variant.id,
                                                    "price",
                                                    val
                                                )
                                            }
                                            name="price"
                                        />

                                        <br />


                                        <TextField
                                            label="New Stock"
                                            type="number"
                                            value={state.stock}
                                            onChange={(val) =>
                                                handleChange(
                                                    variant.id,
                                                    "stock",
                                                    val
                                                )
                                            }
                                            name="stock"
                                        />

                                        <br />


                                        <Button submit primary fullWidth>
                                            Update
                                        </Button>

                                    </div>

                                </InlineStack>

                                <Divider />

                            </Card>

                        </Form>
                    );
                })}

            </Card>

        </Page>
    );
}