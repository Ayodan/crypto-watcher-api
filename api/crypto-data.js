// api/crypto-data.js
import dotenv from "dotenv";

// ✅ Load .env.local only when NOT in production (Vercel handles env injection automatically)
if (process.env.NODE_ENV !== "production") {
    dotenv.config({ path: ".env.local" });
}

export default async function handler(req, res) {
    // ✅ Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "GET")
        return res.status(405).json({ error: "Method not allowed" });

    try {
        // ✅ Read from env (works locally + on Vercel)
        console.log("Loaded ENV URL:", process.env.PUBLIC_SHEET_URL);
        const SHEET_CSV_URL = process.env.PUBLIC_SHEET_URL;

        if (!SHEET_CSV_URL) {
            return res.status(500).json({
                error: "Missing PUBLIC_SHEET_URL",
                message: "Set PUBLIC_SHEET_URL in .env.local (for local dev) and in Vercel dashboard (for production)",
            });
        }

        // ✅ Fetch Google Sheet CSV
        const response = await fetch(SHEET_CSV_URL);
        if (!response.ok) {
            throw new Error(`Google returned ${response.status} ${response.statusText}`);
        }

        const csv = await response.text();

        // ✅ Parse CSV → JSON
        const [headerLine, ...lines] = csv.trim().split("\n");
        const headers = headerLine.split(",").map((h) => h.trim());

        const coins = lines.map((line) => {
            const cols = line.split(",");
            return headers.reduce((obj, header, i) => {
                obj[header.toLowerCase().replace(/\s+/g, "_")] = cols[i]?.trim() || "";
                return obj;
            }, {});
        });

        res.status(200).json({
            success: true,
            count: coins.length,
            coins,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error("Error fetching sheet:", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch published sheet",
            message: error.message,
            timestamp: new Date().toISOString(),
        });
    }
}