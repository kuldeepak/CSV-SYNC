import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { authenticate } from "../shopify.server";
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
  const { admin } = await authenticate.admin(request);
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
        sortKey: INVENTORY_TOTAL
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
    }
  );

  const data = await res.json();

  return json({
    products: data.data.products.edges,
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

  if (type === "delete") {
    await admin.graphql(
      `mutation productDelete($id: ID!) {
        productDelete(input: { id: $id }) { deletedProductId }
      }`,
      { variables: { id: form.get("productId") } }
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
      { variables: { productId, variants: [{ id: variantId, price }] } }
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
      { variables: { id: inventoryItemId } }
    );

    const locData = await locRes.json();
    const locationId =
      locData.data?.inventoryItem?.inventoryLevels?.edges[0]?.node?.location?.id;

    if (!locationId) return json({ success: false, error: "Location not found" });

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
      }
    );

    const invData = await invRes.json();
    const errors = invData.data?.inventorySetQuantities?.userErrors;
    if (errors?.length) return json({ success: false, errors });
    return json({ success: true });
  }

  return json({ success: false, error: "Unknown action type" });
};

/* =======================
   STYLES
======================= */
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: "14px" };
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
        border: "1px solid transparent",
        transition: "all 0.15s",
        display: "inline-block",
        minWidth: 60,
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
    return products?.length
      ? products[products.length - 1].cursor
      : null;
  }, [products]);



  // ✅ cursor history for Previous button (stable)
  const [cursorStack, setCursorStack] = useState([]);

  const [openVariantProductId, setOpenVariantProductId] = useState(null);
  const [editingCell, setEditingCell] = useState(null);

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
    const price = String(rawPrice || "").replace("₹", "").trim();
    submit({ type: "variant-price", productId, variantId, price }, { method: "post" });
  };

  const saveInventoryByInventoryItem = (inventoryItemId, quantity) => {
    submit({ type: "variant-inventory", inventoryItemId, quantity }, { method: "post" });
  };

  const deleteProduct = (productId) =>
    submit({ type: "delete", productId }, { method: "post" });

  // ✅ unified qty source (badge + inventory same)
  const getRowInfo = (node) => {
    const variants = node.variants.edges.map((e) => e.node);
    const firstVariant = variants[0];

    const hasRealVariants =
      variants.length > 1 || firstVariant?.title !== "Default Title";

    const qty = hasRealVariants
      ? Number(node.totalInventory ?? 0)
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
              <Button disabled={!q} onClick={() => navigate(buildUrl({ q: "" }))}>
                Clear
              </Button>
            </InlineStack>
          </InlineStack>

          <div style={{ marginTop: 8 }}>
            <Text as="p" variant="bodySm" tone="subdued">
              Sorted: Low → Medium → Healthy (by total inventory)
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
                <th style={thStyle}>Image</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Stock Level</th>
                <th style={thStyle}>Price</th>
                <th style={thStyle}>Inventory</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {products.map(({ node, cursor }) => {
                const { variants, firstVariant, hasRealVariants, qty } = getRowInfo(node);
                const isOpen = openVariantProductId === node.id;
                const stockStatus = getStockStatus(qty);

                // ✅ Only allow “row inventory edit” for single-variant products
                const canEditRowInventory = !hasRealVariants;

                return (
                  <Fragment key={node.id}>
                    <tr>
                      <td style={tdStyle}>
                        <Thumbnail
                          source={node.featuredImage?.url || ""}
                          size="small"
                          alt={node.title}
                        />
                      </td>

                      <td style={{ ...tdStyle, minWidth: 220 }}>
                        <Text as="p" variant="bodyMd">
                          {node.title}
                        </Text>
                      </td>

                      <td style={tdStyle}>
                        <Badge tone={node.status === "ACTIVE" ? "success" : undefined}>
                          {node.status}
                        </Badge>
                      </td>

                      <td style={tdStyle}>
                        <Badge tone={stockStatus.tone}>{stockStatus.label}</Badge>
                      </td>

                      <td style={{ ...tdStyle, minWidth: 120 }}>
                        <InlineEditable
                          value={firstVariant?.price ? `₹${firstVariant.price}` : "—"}
                          editing={isEditing("product", node.id, "price")}
                          onStartEdit={() => startEdit("product", node.id, "price")}
                          onCancelEdit={cancelEdit}
                          onSave={(v) => saveProductPrice(node.id, firstVariant?.id, v)}
                          type="text"
                        />
                      </td>

                      <td style={{ ...tdStyle, minWidth: 110 }}>
                        {canEditRowInventory ? (
                          <InlineEditable
                            value={String(qty)}
                            editing={isEditing("product", node.id, "inventory")}
                            onStartEdit={() => startEdit("product", node.id, "inventory")}
                            onCancelEdit={cancelEdit}
                            onSave={(v) =>
                              saveInventoryByInventoryItem(firstVariant?.inventoryItem?.id, v)
                            }
                            type="number"
                          />
                        ) : (
                          <Text as="p">{String(qty)}</Text>
                        )}
                      </td>

                      <td style={{ ...tdStyle, minWidth: 260 }}>
                        <InlineStack gap="200">
                          {hasRealVariants && (
                            <Button
                              size="slim"
                              onClick={() => {
                                cancelEdit();
                                setOpenVariantProductId(isOpen ? null : node.id);
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
                          style={{ ...tdStyle, background: "#f6f6f7", paddingLeft: 40 }}
                        >
                          <Text variant="headingSm" as="p">
                            Variants
                          </Text>

                          <div
                            style={{
                              marginTop: 8,
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            {variants.map((vr) => {
                              const vrStock = getStockStatus(vr.inventoryQuantity);
                              return (
                                <div
                                  key={vr.id}
                                  style={{
                                    background: "#fff",
                                    border: "1px solid #e1e3e5",
                                    borderRadius: 8,
                                    padding: "10px 14px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <span style={{ flex: 1, minWidth: 200 }}>
                                    <strong>{vr.title}</strong>
                                    {vr.sku ? (
                                      <span style={{ marginLeft: 8, opacity: 0.75 }}>
                                        SKU: {vr.sku}
                                      </span>
                                    ) : null}
                                  </span>

                                  <div style={{ minWidth: 100 }}>
                                    <Badge tone={vrStock.tone}>{vrStock.label}</Badge>
                                  </div>

                                  <div style={{ minWidth: 140 }}>
                                    <InlineEditable
                                      value={vr.price ? `₹${vr.price}` : "—"}
                                      editing={isEditing("variant", vr.id, "price")}
                                      onStartEdit={() => startEdit("variant", vr.id, "price")}
                                      onCancelEdit={cancelEdit}
                                      onSave={(v) => saveProductPrice(node.id, vr.id, v)}
                                      type="text"
                                    />
                                  </div>

                                  <div style={{ minWidth: 120 }}>
                                    <InlineEditable
                                      value={String(vr.inventoryQuantity ?? "")}
                                      editing={isEditing("variant", vr.id, "inventory")}
                                      onStartEdit={() =>
                                        startEdit("variant", vr.id, "inventory")
                                      }
                                      onCancelEdit={cancelEdit}
                                      onSave={(v) =>
                                        saveInventoryByInventoryItem(vr.inventoryItem?.id, v)
                                      }
                                      type="number"
                                    />
                                  </div>
                                </div>
                              );
                            })}
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