import fetch from "node-fetch";

import { getCronAdmin } from "./cronShopify.js";
import { processCSV } from "./csvProcessor.js";


// 👇 Your Google Sheet CSV Export Link
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1yvYDi5IwqAuFAkZDCLMban7oLwG_Ig9PC1P37V6DgEc/export?format=csv";


export async function runAutoSync() {

  const admin = await getCronAdmin();

const test = await admin.query({
  data: {
    query: `{
      shop {
        name
      }
    }`,
  },
});

console.log("AUTH SUCCESS:", test.body.data.shop.name);

  try {

    console.log("⏳ Auto Sync Started...");

    const admin = await getCronAdmin();


    /* ================= DOWNLOAD ================= */

    const res = await fetch(SHEET_URL);

    if (!res.ok) {
      console.log("❌ Failed to download sheet");
      return;
    }

    const text = await res.text();


    /* ================= SAME PARSING AS UPLOAD ================= */

    const lines = text
      .split("\n")
      .map(line => line.trim())
      .filter(line => line !== "");


    if (lines.length < 2) {
      console.log("❌ CSV empty or invalid");
      return;
    }


    // Remove header
    const dataLines = lines.slice(1);


    const data = dataLines.map(line => {

      // Same separator ;
      const values = line.split(";");

      const sku = values[0]?.replace(/"/g, "").trim();
      const price = values[1]?.replace(/"/g, "").trim();

      return { sku, price };

    }).filter(item => item.sku && item.price);


    if (data.length === 0) {
      console.log("❌ No valid SKU/Price rows found");
      return;
    }


    console.log("📦 Rows found:", data.length);


    /* ================= UPDATE ================= */

    await processCSV(data, admin);

    console.log("✅ Auto Sync Done:", data.length, "items");


  } catch (err) {

    console.error("AUTO SYNC ERROR:", err);

  }
}