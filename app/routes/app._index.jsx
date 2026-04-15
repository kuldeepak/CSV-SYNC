import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useNavigation } from "@remix-run/react";

import {
  Page,
  Card,
  Thumbnail,
  Button,
  InlineStack,
  Badge,
  Text,
  TextField,
  Spinner,
} from "@shopify/polaris";

/* =======================
   HELPERS (Search & Status)
======================= */
function escapeShopifyQueryValue(input) {
  if (!input) return "";
  return String(input)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/"/g, '\\"');
}

function buildProductsQuery(raw) {
  const q = (raw || "").trim();
  if (!q) return null;

  const looksAdvanced =
    q.includes(":") ||
    /\b(AND|OR|NOT)\b/i.test(q) ||
    q.includes("(") ||
    q.includes(")");

  if (looksAdvanced) return q;

  const val = escapeShopifyQueryValue(q);
  const quoted = q.includes(" ") ? `"${val}"` : val;

  // 🧠 Detect ID search (Shopify GID)
  if (q.startsWith("gid://")) {
    return `id:${val}`;
  }

  // 🧠 Detect numeric ID (optional case)
  if (/^\d+$/.test(q)) {
    return `id:${val}`;
  }

  // 🧠 Detect variant id (if user types like variant:123)
  if (q.startsWith("variant:")) {
    const id = q.split(":")[1];
    return `variant_id:${escapeShopifyQueryValue(id)}`;
  }

  // 🧠 Default search (Title + SKU)
  return `title:${quoted} OR sku:${quoted}`;
}

// Stock status
const getStockStatus = (qty) => {
  const count = Number(qty) || 0;
  if (count <= 5) return { label: "Low", tone: "critical" };
  if (count <= 20) return { label: "Medium", tone: "warning" };
  return { label: "Healthy", tone: "success" };
};

/* =======================
   LOADER (Stable global sort + stable pagination)
   ✅ only forward cursor pagination (first/after)
   ✅ sortKey INVENTORY_TOTAL (low stock top)
======================= */
function toPositiveInt(v, fallback = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i >= 1 ? i : fallback;
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const qParam = url.searchParams.get("q") || "";
  const after = url.searchParams.get("after") || null;

  const query = buildProductsQuery(qParam);

  const PAGE_SIZE = 10;

  const res = await admin.graphql(
    `query Products($first: Int!, $after: String, $query: String) {
      products(
  first: $first
  after: $after
  query: $query
  sortKey: TITLE
  reverse: false
) {
        edges {
          cursor
          node {
            id
            title
            status
            totalInventory
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  inventoryQuantity
                  inventoryItem { id }
                }
              }
            }
            featuredImage { url }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }`,
    {
      variables: {
        first: PAGE_SIZE,
        after,
        query,
      },
    },
  );

  const data = await res.json();
  // 🟢 Collect product IDs from Shopify response
  const productIds = data.data.products.edges.map((e) => e.node.id);

  // 🟢 Fetch warehouses from your DB
  const warehouses = await db.externalWarehouse.findMany({
    where: {
      productId: { in: productIds },
    },
  });

  // 🟢 Convert to lookup map
  const warehouseMap = Object.fromEntries(
    warehouses.map((w) => [w.productId, w.warehouse]),
  );

  // 🟢 Attach warehouse to each product
  const productsWithWarehouse = data.data.products.edges.map((edge) => ({
    ...edge,
    node: {
      ...edge.node,
      externalWarehouse: warehouseMap[edge.node.id] || "",
    },
  }));

  return json({
    products: productsWithWarehouse,
    pageInfo: data.data.products.pageInfo,
    q: qParam,
    after,
  });
};
/* =======================
   ACTION
======================= */
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const type = form.get("type");

  if (type === "delete-variant") {
  const variantId = form.get("variantId");

  await admin.graphql(
    `mutation productVariantDelete($id: ID!) {
      productVariantDelete(id: $id) {
        deletedProductVariantId
        userErrors { field message }
      }
    }`,
    { variables: { id: variantId } }
  );

  return json({ success: true });
}

  if (type === "delete") {
    await admin.graphql(
      `mutation productDelete($id: ID!) {
        productDelete(input: { id: $id }) { deletedProductId }
      }`,
      { variables: { id: form.get("productId") } },
    );
    return json({ success: true });
  }

  if (type === "variant-price") {
    const productId = form.get("productId");
    const variantId = form.get("variantId");
    const price = form.get("price");

    const result = await admin.graphql(
      `mutation variantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price }
          userErrors { field message }
        }
      }`,
      { variables: { productId, variants: [{ id: variantId, price }] } },
    );

    const d = await result.json();
    const errors = d.data?.productVariantsBulkUpdate?.userErrors;
    if (errors?.length) return json({ success: false, errors });
    return json({ success: true });
  }

  if (type === "variant-inventory") {
    const inventoryItemId = form.get("inventoryItemId");
    const quantity = parseInt(form.get("quantity"), 10);

    const locRes = await admin.graphql(
      `query getLocation($id: ID!) {
        inventoryItem(id: $id) {
          inventoryLevels(first: 1) {
            edges { node { location { id } } }
          }
        }
      }`,
      { variables: { id: inventoryItemId } },
    );

    const locData = await locRes.json();
    const locationId =
      locData.data?.inventoryItem?.inventoryLevels?.edges[0]?.node?.location
        ?.id;

    if (!locationId)
      return json({ success: false, error: "Location not found" });

    const invRes = await admin.graphql(
      `mutation inventorySet($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            name: "available",
            reason: "correction",
            ignoreCompareQuantity: true,
            quantities: [{ inventoryItemId, locationId, quantity }],
          },
        },
      },
    );

    const invData = await invRes.json();
    const errors = invData.data?.inventorySetQuantities?.userErrors;
    if (errors?.length) return json({ success: false, errors });
    return json({ success: true });
  }

  if (type === "transfer-inventory") {
  const productId = form.get("productId");
  const inventoryItemId = form.get("inventoryItemId");
  const newShopifyQty = parseInt(form.get("newShopifyQty"), 10);
  const newExternalQty = parseInt(form.get("newExternalQty"), 10);

  // 1️⃣ Get location
  const locRes = await admin.graphql(`
    query getLocation($id: ID!) {
      inventoryItem(id: $id) {
        inventoryLevels(first: 1) {
          edges { node { location { id } } }
        }
      }
    }
  `, { variables: { id: inventoryItemId } });

  const locData = await locRes.json();
  const locationId =
    locData.data?.inventoryItem?.inventoryLevels?.edges[0]?.node?.location?.id;

  if (!locationId) {
    return json({ success: false, error: "Location not found" });
  }

  // 2️⃣ Update Shopify inventory
  const invRes = await admin.graphql(`
    mutation inventorySet($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        userErrors { field message }
      }
    }
  `, {
    variables: {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        quantities: [
          { inventoryItemId, locationId, quantity: newShopifyQty },
        ],
      },
    },
  });

  const invData = await invRes.json();
  const errors = invData.data?.inventorySetQuantities?.userErrors;

  if (errors?.length) {
    return json({ success: false, errors });
  }

  // 3️⃣ Update external warehouse ONLY if Shopify success
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  await db.externalWarehouse.upsert({
    where: { shop_productId: { shop, productId } },
   update: { warehouse: String(newExternalQty) },
create: { shop, productId, warehouse: String(newExternalQty) },
  });

  return json({ success: true });
}

  /* =======================
   SAVE EXTERNAL WAREHOUSE
======================= */
  if (type === "external-warehouse") {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const productId = form.get("productId");
    const warehouse = form.get("warehouse");

    await db.externalWarehouse.upsert({
      where: {
        shop_productId: { shop, productId },
      },
      update: { warehouse },
      create: { shop, productId, warehouse },
    });

    return json({ success: true });
  }

  return json({ success: false, error: "Unknown action type" });
};

/* =======================
   STYLES
======================= */
const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
};
const thStyle = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "2px solid #e1e3e5",
  color: "#6d7175",
  fontWeight: 600,
  background: "#f6f6f7",
};
const tdStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid #e1e3e5",
  verticalAlign: "middle",
};

/* =======================
   INLINE EDIT CELL
======================= */
function InlineEditable({
  value,
  onSave,
  type = "text",
  editing,
  onStartEdit,
  onCancelEdit,
}) {
  const [val, setVal] = useState(value);

  useEffect(() => setVal(value), [value, editing]);

  const handleSave = () => {
    onCancelEdit();
    if (String(val) !== String(value)) onSave(val);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      setVal(value);
      onCancelEdit();
    }
  };

  if (editing) {
    return (
      <div style={{ minWidth: 110 }}>
        <TextField
          value={val}
          onChange={setVal}
          onBlur={handleSave}
          autoFocus
          type={type}
          onKeyDown={handleKeyDown}
        />
      </div>
    );
  }

  return (
    <div
      onClick={onStartEdit}
      title="Click to edit"
      style={{
        cursor: "pointer",
        padding: "4px 6px",
        borderRadius: 6,
        border: "1px solid #e1e3e5",
        transition: "all 0.15s",
        display: "inline-block",
        minWidth: 60,
        background: "#f6f6f7",
        height: "30px",
        textAlign: "center",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.border = "1px solid #bbb";
        e.currentTarget.style.background = "#f6f6f7";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.border = "1px solid transparent";
        e.currentTarget.style.background = "transparent";
      }}
    >
      {value ?? "—"}
    </div>
  );
}

/* =======================
   MAIN COMPONENT (Clean + Stable)
======================= */
export default function Index() {
  // const { products, pageInfo, q } = useLoaderData();

  const { products, pageInfo, q, after } = useLoaderData();
  const navigate = useNavigate();
  const submit = useSubmit();

  const navigation = useNavigation();
  const isPageLoading =
    navigation.state === "loading" || navigation.state === "submitting";

  const lastCursor = useMemo(() => {
    return products?.length ? products[products.length - 1].cursor : null;
  }, [products]);

  // ✅ cursor history for Previous button (stable)
  const [cursorStack, setCursorStack] = useState([]);

  const [openVariantProductId, setOpenVariantProductId] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [tempWarehouse2, setTempWarehouse2] = useState({});

  // Search UI
  const [search, setSearch] = useState(q || "");
  useEffect(() => setSearch(q || ""), [q]);

  // ✅ whenever query changes (new search / clear) reset pagination history
  useEffect(() => {
    setCursorStack([]);
  }, [q]);

  const buildUrl = ({ q, after }) => {
    const sp = new URLSearchParams();

    if (q) sp.set("q", q);
    if (after) sp.set("after", after);

    return `?${sp.toString()}`;
  };

  const isEditing = (scope, id, field) =>
    editingCell?.scope === scope &&
    editingCell?.id === id &&
    editingCell?.field === field;

  const startEdit = (scope, id, field) => setEditingCell({ scope, id, field });
  const cancelEdit = () => setEditingCell(null);

  const saveProductPrice = (productId, variantId, rawPrice) => {
    const price = String(rawPrice || "")
      .replace("₹", "")
      .trim();
    submit(
      { type: "variant-price", productId, variantId, price },
      { method: "post" },
    );
  };

  const saveInventoryByInventoryItem = (inventoryItemId, quantity) => {
    submit(
      { type: "variant-inventory", inventoryItemId, quantity },
      { method: "post" },
    );
  };

  const saveWarehouse = (productId, warehouse) => {
    submit(
      { type: "external-warehouse", productId, warehouse },
      { method: "post" },
    );
  };

//   const saveWarehouse2Local = (productId, value) => {
//   setTempWarehouse2((prev) => ({
//     ...prev,
//     [productId]: value,
//   }));
// };

// const transferFromExternalWarehouse = async (
//   productId,
//   inventoryItemId,
//   shopifyQty,
//   externalQty,
//   transferQty
// ) => {
//   const moveQty = Number(transferQty) || 0;
//   if (moveQty <= 0) return;

//   if (moveQty > externalQty) {
//     alert("Not enough stock in External Warehouse");
//     return;
//   }

//   const newShopifyQty = shopifyQty + moveQty;
//   const newExternalQty = externalQty - moveQty;

//   // 1️⃣ Update Shopify inventory FIRST
//   submit(
//     {
//       type: "variant-inventory",
//       inventoryItemId,
//       quantity: newShopifyQty,
//     },
//     { method: "post" }
//   );

//   // ⏱️ Wait 500ms, then update external warehouse
//   setTimeout(() => {
//     // 2️⃣ Update DB external warehouse
//     submit(
//       {
//         type: "external-warehouse",
//         productId,
//         warehouse: newExternalQty,
//       },
//       { method: "post" }
//     );

//     // 3️⃣ Reset NEW warehouse field to 0
//     setTempWarehouse2((prev) => ({
//       ...prev,
//       [productId]: "",
//     }));
//   }, 500);
// };

const transferFromExternalWarehouse = async (
  productId,
  inventoryItemId,
  shopifyQty,
  externalQty,
  transferQty
) => {
  const moveQty = Number(transferQty) || 0;

  if (moveQty <= 0) return;

  if (moveQty > externalQty) {
    alert("Not enough stock in External Warehouse");
    return;
  }

  const newShopifyQty = shopifyQty + moveQty;
  const newExternalQty = externalQty - moveQty;

  // ✅ SINGLE REQUEST (no race condition)
  submit(
    {
      type: "transfer-inventory",
      productId,
      inventoryItemId,
      newShopifyQty,
      newExternalQty,
    },
    { method: "post" }
  );

  // ✅ Reset input immediately (UI clean)
  setTempWarehouse2((prev) => ({
    ...prev,
    [productId]: "",
  }));
};

  const deleteProduct = (productId) =>
    submit({ type: "delete", productId }, { method: "post" });

  // ✅ unified qty source (badge + inventory same)
  const getRowInfo = (node) => {
    let variants = node.variants.edges.map((e) => e.node);

    // ✅ If search exists, filter variants by SKU match
    if (q && !q.includes(":")) {
  const searchLower = q.toLowerCase();

  const filtered = variants.filter((v) =>
    v.sku?.toLowerCase().includes(searchLower) ||
    v.id?.toLowerCase().includes(searchLower)
  );

  if (filtered.length > 0) {
    variants = filtered;
  }
}

    const firstVariant = variants[0];

    const hasRealVariants =
      variants.length > 1 || firstVariant?.title !== "Default Title";

    const qty = hasRealVariants
      ? variants.reduce((sum, v) => sum + Number(v.inventoryQuantity || 0), 0)
      : Number(firstVariant?.inventoryQuantity ?? node.totalInventory ?? 0);

    return { variants, firstVariant, hasRealVariants, qty };
  };
  return (
    <>
      {isPageLoading && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: "40px 60px",
              borderRadius: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
              textAlign: "center",
            }}
          >
            <Spinner size="large" />
            <div style={{ marginTop: 16, fontSize: 16, fontWeight: 500 }}>
              Please wait...
            </div>
          </div>
        </div>
      )}
      <Page title="Inventory Manager">
        <Card>
          {/* SEARCH */}
          <div style={{ padding: 16, borderBottom: "1px solid #e1e3e5" }}>
            <InlineStack gap="300" align="space-between">
              <div style={{ flex: 1, minWidth: 280 }}>
                <TextField
                  label="Search by Title or SKU"
                  labelHidden
                  placeholder='Search... (e.g. "Nike" or "sku:ABC123")'
                  value={search}
                  onChange={setSearch}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      navigate(buildUrl({ q: search.trim() || "" }));
                    }
                  }}
                  clearButton
                  onClearButtonClick={() => navigate(`.`)}
                />
              </div>

              <InlineStack gap="200">
                <Button
                  variant="primary"
                  onClick={() => navigate(buildUrl({ q: search.trim() || "" }))}
                >
                  Search
                </Button>
                <Button
                  disabled={!q}
                  onClick={() => navigate(buildUrl({ q: "" }))}
                >
                  Clear
                </Button>
              </InlineStack>
            </InlineStack>

            <div style={{ marginTop: 8 }}>
              <Text as="p" variant="bodySm" tone="subdued">
                Sorted by Title
                {q ? (
                  <>
                    {" "}
                    | Query: <strong>{q}</strong>
                  </>
                ) : null}
              </Text>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Title</th>
                  
                  <th style={thStyle}>Price</th>
                  <th style={thStyle}>Inventory</th>
                  <th style={thStyle}>external warehouse</th>
                  <th style={thStyle}>external Warehouse new</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>

              <tbody>
                {products.map(({ node, cursor }) => {
                  const { variants, firstVariant, hasRealVariants, qty } =
                    getRowInfo(node);
                  const isOpen = openVariantProductId === node.id;
                  const warehouseQty = Number(node.externalWarehouse) || 0;
                  const remainingQty = qty - warehouseQty;

                  // ✅ Only allow “row inventory edit” for single-variant products
                  const canEditRowInventory = !hasRealVariants;

                  return (
                    <Fragment key={node.id}>
                      <tr>
                        <td style={{ ...tdStyle, minWidth: 220 }}>
  <div>
    {/* Product Title */}
    <Text as="p" variant="bodyMd">
      {node.title}
    </Text>

    {/* SKU below title */}
    {firstVariant?.sku ? (
      <Text as="p" variant="bodySm" tone="subdued">
        SKU: {firstVariant.sku}
      </Text>
    ) : null}
  </div>
</td>

                        <td style={{ ...tdStyle, minWidth: 120 }}>
                          <InlineEditable
                            value={
                              firstVariant?.price
                                ? `₹${firstVariant.price}`
                                : "—"
                            }
                            editing={isEditing("product", node.id, "price")}
                            onStartEdit={() =>
                              startEdit("product", node.id, "price")
                            }
                            onCancelEdit={cancelEdit}
                            onSave={(v) =>
                              saveProductPrice(node.id, firstVariant?.id, v)
                            }
                            type="text"
                          />
                        </td>

                        <td style={{ ...tdStyle, minWidth: 110 }}>
                          {canEditRowInventory ? (
                            <InlineEditable
                              value={String(qty)}
                              editing={isEditing(
                                "product",
                                node.id,
                                "inventory",
                              )}
                              onStartEdit={() =>
                                startEdit("product", node.id, "inventory")
                              }
                              onCancelEdit={cancelEdit}
                              onSave={(v) =>
                                saveInventoryByInventoryItem(
                                  firstVariant?.inventoryItem?.id,
                                  v,
                                )
                              }
                              type="number"
                            />
                          ) : (
                            <Text as="p">{String(qty)}</Text>
                          )}
                        </td>

                       <td style={{ ...tdStyle, minWidth: 180 }}>
  {!hasRealVariants ? (
    <InlineEditable
      value={node.externalWarehouse || ""}
      editing={isEditing("product", node.id, "warehouse")}
      onStartEdit={() =>
        startEdit("product", node.id, "warehouse")
      }
      onCancelEdit={cancelEdit}
      onSave={(v) => saveWarehouse(node.id, v)}
      type="text"
    />
  ) : (
    <Text as="p" tone="subdued">
      —
    </Text>
  )}
</td>

                        <td style={{ ...tdStyle, minWidth: 180 }}>
 <td style={{ ...tdStyle, minWidth: 180 }}>
  {!hasRealVariants ? (
    <InlineEditable
      value={tempWarehouse2[node.id] || ""}
      editing={isEditing("product", node.id, "warehouse2")}
      onStartEdit={() => startEdit("product", node.id, "warehouse2")}
      onCancelEdit={cancelEdit}
      onSave={(v) =>
        transferFromExternalWarehouse(
          node.id,
          firstVariant?.inventoryItem?.id,
          qty,
          warehouseQty,
          v
        )
      }
      type="number"
    />
  ) : (
    <Text as="p" tone="subdued">
      —
    </Text>
  )}
</td>
</td>

                        <td style={{ ...tdStyle, minWidth: 260 }}>
                          <InlineStack gap="200">
                            {hasRealVariants && (
                              <Button
                                size="slim"
                                onClick={() => {
                                  cancelEdit();
                                  setOpenVariantProductId(
                                    isOpen ? null : node.id,
                                  );
                                }}
                              >
                                {isOpen ? "Hide Variants" : "Variants"}
                              </Button>
                            )}

                            <Button
                              tone="critical"
                              size="slim"
                              onClick={() => deleteProduct(node.id)}
                            >
                              Delete
                            </Button>
                          </InlineStack>
                        </td>
                      </tr>

                      {hasRealVariants && isOpen && (
                        <tr>
                          <td
                            colSpan={7}
                            style={{
                              ...tdStyle,
                              background: "#f6f6f7",
                              paddingLeft: 40,
                            }}
                          >
                            <Text variant="headingSm" as="p">
                              Variants
                            </Text>

                            <div style={{ marginTop: 10 }}>
  <table style={{ width: "100%", borderCollapse: "collapse" }}>
    
    {/* Header */}
    <thead>
      <tr style={{ background: "#f6f6f7" }}>
        <th style={{ padding: 8, textAlign: "left" }}>Title</th>
        <th style={{ padding: 8, textAlign: "left" }}>Price</th>
        <th style={{ padding: 8, textAlign: "left" }}>Inventory</th>
        <th style={{ padding: 8, textAlign: "left" }}>Action</th>
      </tr>
    </thead>

    {/* Body */}
    <tbody>
      {variants.map((vr) => (
        <tr key={vr.id} style={{ borderTop: "1px solid #e1e3e5" }}>
          
          {/* Title */}
          <td style={{ padding: 8, width: 255 }}>
            <strong>{vr.title}</strong>
            {vr.sku ? (
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                SKU: {vr.sku}
              </div>
            ) : null}
          </td>

          {/* Price */}
          <td style={{ padding: 8 }}>
            <InlineEditable
  value={vr.price ? `₹${vr.price}` : "—"}
  editing={isEditing("variant", vr.id, "price")}
  onStartEdit={() =>
    startEdit("variant", vr.id, "price")
  }
  onCancelEdit={cancelEdit}
  onSave={(v) =>
    saveProductPrice(node.id, vr.id, v)
  }
  type="text"
/>
          </td>

          {/* Inventory */}
        <td style={{ padding: 8 }}>
  <InlineEditable
    value={String(vr.inventoryQuantity ?? "")}
    editing={isEditing("variant", vr.id, "inventory")}
    onStartEdit={() =>
      startEdit("variant", vr.id, "inventory")
    }
    onCancelEdit={cancelEdit}
    onSave={(v) =>
      saveInventoryByInventoryItem(
        vr.inventoryItem?.id,
        v
      )
    }
    type="number"
  />
</td>

          {/* Action */}
          <td style={{ padding: 8 }}>
            <Button
              tone="critical"
              size="slim"
              onClick={() =>
                submit(
                  { type: "delete-variant", variantId: vr.id },
                  { method: "post" }
                )

              }
            >
              Delete
            </Button>
          </td>

        </tr>
      ))}
    </tbody>
  </table>
</div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <br />

          {/* PAGINATION (Stable) */}
          {/* PAGINATION (Page Based) */}
          <InlineStack align="space-between" gap="300">
            {/* Previous */}
            <Button
              disabled={cursorStack.length === 0}
              onClick={() => {
                cancelEdit();

                const prev = cursorStack[cursorStack.length - 1];

                setCursorStack((s) => s.slice(0, -1));

                navigate(buildUrl({ q: q || "", after: prev || "" }));
              }}
            >
              Previous
            </Button>

            <Text as="p" variant="bodySm" tone="subdued">
              {cursorStack.length + 1}
            </Text>

            {/* Next */}
            <Button
              disabled={!pageInfo?.hasNextPage}
              variant="primary"
              onClick={() => {
                cancelEdit();

                setCursorStack((s) => [...s, after]);

                navigate(buildUrl({ q: q || "", after: lastCursor }));
              }}
            >
              Next
            </Button>
          </InlineStack>
        </Card>
      </Page>
    </>
  );
}
