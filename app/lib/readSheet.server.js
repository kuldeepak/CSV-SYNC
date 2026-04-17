import axios from "axios";
import csv from "csv-parser";
import { Readable } from "stream";

const SHEET_URL =
  "https://api.patagona.de/api/2/v/contracts/hlsoer/feeds/0210b28a-d30d-44ed-b6b1-baff07ff0434/export/feed.csv";

export async function readSheetCSV() {
  try {
    const response = await axios.get(SHEET_URL, {
      responseType: "arraybuffer",
      timeout: 20000,
    });

    const rows = [];

    // ⭐ Buffer → STRING stream (THIS is the missing piece)
    const stream = Readable.from(response.data.toString("utf8"));

    return await new Promise((resolve, reject) => {
      stream
        .pipe(
          csv({
            separator: ";",
            quote: '"',
            escape: '"',
            strict: false,
            trim: true,
            mapHeaders: ({ header }) =>
              header.replace(/"/g, "").trim(),
          })
        )
        .on("data", (row) => {
  // keep exact CSV value but make Shopify-compatible
  if (row["recommended price"]) {
    const rawPrice = row["recommended price"].toString().trim();

    // remove trailing semicolon if exists + convert decimal separator
    row["recommended price"] = rawPrice
      .replace(";", "")
      .replace(",", ".");
  }

  rows.push(row);
})
        .on("end", () => {
          console.log("✅ CSV Loaded:", rows.length, "rows");
          resolve(rows);
        })
        .on("error", reject);
    });
  } catch (err) {
    console.error("❌ Fetch Error:", err.message);
    throw new Error("Sheet read failed");
  }
}