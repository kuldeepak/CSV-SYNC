import { Form, useActionData } from "@remix-run/react";

import {
  Page,
  Card,
  Button,
  Text,
  DataTable,
  Banner,
  InlineStack,
  Box,
  Divider,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { processCSV } from "../lib/csvProcessor";


// ================= UI =================

export default function Upload() {

  const data = useActionData();


  return (
    <Page
      // title="CSV Price Sync"
      // subtitle="Bulk update product prices using CSV"
      // primaryAction={{
      //   content: "Download Sample",
      //   url: "/sample.csv", // optional
      // }}
    >


      {/* STATUS */}
      {data?.success && (

        <Banner tone="success" title="Update Complete">
          Prices were updated successfully.
        </Banner>

      )}

      {data?.error && (

        <Banner tone="critical" title="Upload Failed">
          {data.error}
        </Banner>

      )}


      {/* STEP 1 */}
      <Card title="Step 1 — Upload CSV" sectioned>

        <InlineStack gap="600" align="center">

          <Box width="50%">

            <Text as="h3" variant="headingMd">
              Upload your price file
            </Text>

            <Text tone="subdued">
              Select a CSV file containing SKU and price columns.
            </Text>

            <br />

            <Form method="post" encType="multipart/form-data">

              <div
                style={{
                  border: "2px dashed #c9cccf",
                  borderRadius: 8,
                  padding: 20,
                  textAlign: "center",
                  background: "#fafbfb",
                }}
              >

                <input
                  type="file"
                  name="file"
                  accept=".csv"
                  required
                  style={{
                    width: "100%",
                  }}
                />

                <br /><br />

                <Button submit primary size="large">
                  📤 Upload & Preview
                </Button>

              </div>

            </Form>

          </Box>


          {/* HELP */}
          <Box width="50%">

            <Card subdued>

              <Text as="h4" variant="headingSm">
                File Requirements
              </Text>

              <Divider />

              <ul style={{ paddingLeft: 20 }}>

                <li>CSV format only</li>
                <li>Columns: product id, recommended price</li>
                <li>Semicolon (;) separated</li>
                <li>UTF-8 encoding</li>

              </ul>

            </Card>

          </Box>

        </InlineStack>

      </Card>


      <br />


      {/* STEP 2 — PREVIEW */}
      {data?.preview && (

        <Card
          title={`Step 2 — Preview (${data.preview.length} Items)`}
          sectioned
        >

          <Text tone="subdued">
            Review changes before applying.
          </Text>

          <br />

          <DataTable
            columnContentTypes={["text", "numeric"]}
            headings={["SKU", "New Price"]}
            rows={data.preview.map(item => [
              item.sku,
              "₹" + item.price,
            ])}
          />

          <br />


          {/* CONFIRM */}
          <InlineStack align="end">

            <Form method="post">

              <input
                type="hidden"
                name="confirm"
                value="yes"
              />

              <input
                type="hidden"
                name="data"
                value={JSON.stringify(data.preview)}
              />

              <Button
                submit
                primary
                size="large"
                tone="success"
              >
                ✅ Confirm & Update
              </Button>

            </Form>

          </InlineStack>

        </Card>
      )}

    </Page>
  );
}



// ================= BACKEND =================

export async function action({ request }) {

  try {

    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    // ===== CONFIRM STEP =====
    if (formData.get("confirm") === "yes") {

      const data = JSON.parse(formData.get("data"));

      await processCSV(data, admin);

      return { success: true };
    }

    // ===== UPLOAD STEP =====

    const file = formData.get("file");

    if (!file) {
      return { error: "No file uploaded" };
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Convert file to text
    const text = buffer.toString("utf-8");

    // Split lines
    const lines = text
      .split("\n")
      .map(line => line.trim())
      .filter(line => line !== "");

    if (lines.length < 2) {
      return { error: "CSV file is empty or invalid" };
    }

    // Remove header
    const dataLines = lines.slice(1);

    const preview = dataLines.map(line => {

      const values = line.split(";");

      const sku = values[0]?.replace(/"/g, "").trim();
      const price = values[1]?.replace(/"/g, "").trim();

      return { sku, price };

    }).filter(item => item.sku && item.price);

    if (preview.length === 0) {
      return { error: "No valid SKU/Price rows found" };
    }

    return { preview };

  } catch (err) {

    console.error("UPLOAD ERROR:", err);

    return {
      error: err.message || "Server error"
    };
  }
}