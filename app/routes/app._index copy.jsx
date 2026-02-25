import { useLoaderData, Link } from "@remix-run/react";

import {
  Page,
  Card,
  Button,
  DataTable,
  TextField,
  Collapsible,
  Badge,
  InlineStack,
  Box,
  Divider,
} from "@shopify/polaris";

import { useState } from "react";

import { authenticate } from "../shopify.server";


// ================= LOADER =================

export async function loader({ request }) {

  const { admin } = await authenticate.admin(request);

  const query = `
  {
    products(first: 50) {
      edges {
        node {
          id
          title
          totalInventory

          variants(first: 20) {
            edges {
              node {
                id
                sku
                price
                inventoryQuantity
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

  return json.data.products.edges.map(e => e.node);
}



// ================= HELPERS =================

function getStockStatus(qty) {

  if (qty <= 10) {
    return { tone: "critical", label: "Low Stock" };
  }

  if (qty <= 30) {
    return { tone: "warning", label: "Medium" };
  }

  return { tone: "success", label: "Healthy" };
}



// ================= UI =================

export default function Dashboard() {

  const products = useLoaderData();

  const [open, setOpen] = useState({});
  const [search, setSearch] = useState("");


  /* Sort: Low stock first */
  const sorted = [...products].sort(
    (a, b) => a.totalInventory - b.totalInventory
  );


  /* Search */
  const filtered = sorted.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );


  return (
    <Page
      title="Inventory Dashboard"
      primaryAction={{
        content: "📂 Upload CSV",
        url: "/app/upload",
      }}
    >


      {/* SEARCH */}
      <Card sectioned>

        <TextField
          label="Search Product"
          placeholder="Search by name..."
          value={search}
          onChange={setSearch}
          autoComplete="off"
        />

      </Card>


      <br />


      {/* PRODUCTS */}
      {filtered.map(product => {

        const stock = product.totalInventory;

        const status = getStockStatus(stock);


        return (

          <Card key={product.id} sectioned>

            {/* PRODUCT HEADER */}
            <InlineStack
              align="space-between"
              gap="400"
            >

              <Box>

                <h3 style={{ margin: 0 }}>
                  {product.title}
                </h3>

                <p style={{ margin: "4px 0" }}>
                  Total Stock: <b>{stock}</b>
                </p>

              </Box>


              {/* STATUS + ACTIONS */}
              <InlineStack gap="300">

                <Badge tone={status.tone}>
                  {status.label}
                </Badge>


                <Button
                  onClick={() =>
                    setOpen({
                      ...open,
                      [product.id]: !open[product.id],
                    })
                  }
                >
                  {open[product.id]
                    ? "Hide Variants"
                    : "Show Variants"}
                </Button>


                <Link
                  to={`/app/product/${encodeURIComponent(product.id)}`}
                >
                  <Button primary>
                    Manage
                  </Button>
                </Link>

              </InlineStack>

            </InlineStack>


            <Divider />


            {/* VARIANTS */}
            <Collapsible open={open[product.id]}>

              <br />

              <DataTable
                columnContentTypes={[
                  "text",
                  "numeric",
                  "numeric",
                  "text",
                ]}
                headings={[
                  "SKU",
                  "Price",
                  "Stock",
                  "Variant ID",
                ]}
                rows={product.variants.edges.map(v => {

                  const vStock = v.node.inventoryQuantity;

                  const vStatus =
                    getStockStatus(vStock);

                  return [
                    v.node.sku || "N/A",

                    "₹" + v.node.price,

                    <InlineStack gap="200" key={v.node.id}>
                      <span>{vStock}</span>
                      <Badge tone={vStatus.tone}>
                        {vStatus.label}
                      </Badge>
                    </InlineStack>,

                    v.node.id,
                  ];
                })}
              />

            </Collapsible>

          </Card>
        );
      })}

    </Page>
  );
}