// import axios from "axios";
// import csv from "csv-parser";
// import { Readable } from "stream";

// const SHEET_URL =
//   "https://docs.google.com/spreadsheets/d/1yvYDi5IwqAuFAkZDCLMban7oLwG_Ig9PC1P37V6DgEc/gviz/tq?tqx=out:csv";

// export async function readSheetCSV() {
//   try {
//     const response = await axios.get(SHEET_URL, {
//       responseType: "text",
//       responseEncoding: "utf8",
//       timeout: 20000,
//     });

//     const rows = [];

//     return await new Promise((resolve, reject) => {
//       Readable.from(response.data)
//         .pipe(
//           csv({
//             quote: '"',
//             escape: '"',
//             strict: false,
//             trim: false, // ❗ don't trim (keeps symbols/spaces)
//           })
//         )
//         .on("data", (row) => {
//           // Log raw row for debugging
//           console.log("RAW ROW:", row);

//           rows.push(row); // push everything
//         })
//         .on("end", () => {
//           console.log("✅ Loaded", rows.length, "rows");
//           resolve(rows);
//         })
//         .on("error", reject);
//     });
//   } catch (err) {
//     console.error("❌ Fetch Error:", err.message);
//     throw new Error("Google Sheet read failed");
//   }
// }