import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import path from 'path';
import fs from 'fs';
//this flow did not work
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        let serviceAccountAuth;
        let serviceAccount;

        // Method 1: Try using local JSON file first (for local development)
        try {
            const serviceAccountPath = path.join(process.cwd(), 'service-account-key.json');

            if (fs.existsSync(serviceAccountPath)) {
                console.log('Using local service account JSON file');
                serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
            } else {
                throw new Error('Local JSON file not found');
            }
        } catch (jsonError) {
            console.log('Local JSON file not found, trying environment variables');

            // Method 2: Try base64 encoded JSON (recommended for production)
            if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
                try {
                    console.log('Using base64 encoded service account');
                    console.log('Base64 string length:', process.env.GOOGLE_SERVICE_ACCOUNT_BASE64.length);

                    const jsonString = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
                    console.log('Decoded JSON string length:', jsonString.length);
                    console.log('JSON string starts with:', jsonString.substring(0, 50));

                    serviceAccount = JSON.parse(jsonString);
                    console.log('Service account parsed successfully');
                    console.log('Client email:', serviceAccount.client_email);

                    // DEBUG: Check private key format
                    if (serviceAccount.private_key) {
                        console.log('Private key length:', serviceAccount.private_key.length);
                        console.log('Private key starts with:', serviceAccount.private_key.substring(0, 50));
                        console.log('Private key ends with:', serviceAccount.private_key.substring(serviceAccount.private_key.length - 50));

                        // Check if we have literal \n vs actual newlines
                        const hasLiteralNewlines = serviceAccount.private_key.includes('\\n');
                        const hasActualNewlines = serviceAccount.private_key.includes('\n');
                        console.log('Has literal \\n:', hasLiteralNewlines);
                        console.log('Has actual newlines:', hasActualNewlines);

                        // If we have literal \n, convert them to actual newlines
                        if (hasLiteralNewlines && !hasActualNewlines) {
                            console.log('Converting literal \\n to actual newlines');
                            serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
                            console.log('After conversion - starts with:', serviceAccount.private_key.substring(0, 50));
                            console.log('After conversion - ends with:', serviceAccount.private_key.substring(serviceAccount.private_key.length - 50));
                        }
                    }
                } catch (base64Error) {
                    console.error('Failed to decode base64 service account:', base64Error.message);
                    console.error('Base64Error stack:', base64Error.stack);
                    throw base64Error;
                }
            }
            // Method 3: Fallback to individual environment variables
            else if (
                process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
                process.env.GOOGLE_PRIVATE_KEY
            ) {
                console.log('Using individual environment variables');

                let privateKey = process.env.GOOGLE_PRIVATE_KEY;

                // Handle different quote scenarios
                if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
                    privateKey = privateKey.slice(1, -1);
                }
                if (privateKey.startsWith("'") && privateKey.endsWith("'")) {
                    privateKey = privateKey.slice(1, -1);
                }

                // Handle escaped newlines
                privateKey = privateKey.replace(/\\n/g, '\n');

                serviceAccount = {
                    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                    private_key: privateKey
                };
            } else {
                return res.status(500).json({
                    error: "Missing service account credentials",
                    message: "Provide either GOOGLE_SERVICE_ACCOUNT_BASE64 or individual env vars",
                    required: [
                        "GOOGLE_SERVICE_ACCOUNT_BASE64 (recommended)",
                        "OR: GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY"
                    ],
                });
            }
        }

        // Validate service account
        if (!serviceAccount.client_email || !serviceAccount.private_key) {
            throw new Error('Invalid service account: missing client_email or private_key');
        }

        console.log('Creating JWT auth...');
        console.log('Email:', serviceAccount.client_email);
        console.log('Private key format check - starts with BEGIN:', serviceAccount.private_key.startsWith('-----BEGIN'));
        console.log('Private key format check - ends with END:', serviceAccount.private_key.includes('-----END'));

        // Create JWT auth
        serviceAccountAuth = new JWT({
            email: serviceAccount.client_email,
            key: serviceAccount.private_key,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });

        // Test authentication
        try {
            console.log('Attempting authentication...');
            await serviceAccountAuth.authorize();
            console.log('Authentication successful');
        } catch (authError) {
            console.error('Authentication failed:', authError.message);
            console.error('Auth error code:', authError.code);
            console.error('Auth error stack:', authError.stack);

            // Additional debugging for the specific decoder error
            if (authError.message.includes('DECODER routines')) {
                console.error('DECODER ERROR - This usually means the private key format is incorrect');
                console.error('Private key sample (first 100 chars):', serviceAccount.private_key.substring(0, 100));
                console.error('Private key contains \\n literals:', serviceAccount.private_key.includes('\\n'));
                console.error('Private key contains actual newlines:', serviceAccount.private_key.split('\n').length > 1);
            }

            return res.status(401).json({
                error: "Authentication failed",
                message: authError.message,
                timestamp: new Date().toISOString()
            });
        }

        // Connect to Google Sheets
        if (!process.env.GOOGLE_SHEET_ID) {
            return res.status(500).json({
                error: "GOOGLE_SHEET_ID environment variable is required"
            });
        }

        const doc = new GoogleSpreadsheet(
            process.env.GOOGLE_SHEET_ID,
            serviceAccountAuth
        );

        await doc.loadInfo();

        const sheet = doc.sheetsByIndex[0];
        if (!sheet) {
            return res.status(404).json({ error: "No sheets found in spreadsheet" });
        }

        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();

        const coins = rows.map((row) => {
            const rowData = {};
            sheet.headerValues.forEach((header, index) => {
                rowData[header.toLowerCase().replace(/\s+/g, "_")] =
                    row._rawData[index] || "";
            });
            return rowData;
        });

        let recentAlerts = [];
        try {
            const alertsSheet =
                doc.sheetsByTitle["alerts_log"] ||
                doc.sheetsByTitle["Alerts"] ||
                doc.sheetsByTitle["alerts"];
            if (alertsSheet) {
                await alertsSheet.loadHeaderRow();
                const alertRows = await alertsSheet.getRows();
                recentAlerts = alertRows.slice(-20).map((row) => {
                    const alertData = {};
                    alertsSheet.headerValues.forEach((header, index) => {
                        alertData[header.toLowerCase().replace(/\s+/g, "_")] =
                            row._rawData[index] || "";
                    });
                    return alertData;
                });
            }
        } catch (alertError) {
            console.log("No alerts sheet found:", alertError.message);
        }

        res.status(200).json({
            success: true,
            timestamp: new Date().toISOString(),
            sheet_title: doc.title,
            coins,
            alerts: recentAlerts,
            count: coins.length,
        });
    } catch (error) {
        console.error("Error fetching crypto data:", error);

        let errorMessage = error.message;
        if (error.message.includes('DECODER routines')) {
            errorMessage = "Private key decoding failed. Please check your private key format.";
        } else if (error.message.includes('No permission')) {
            errorMessage = "Service account lacks permission to access the spreadsheet.";
        }

        res.status(500).json({
            success: false,
            error: "Failed to fetch crypto data",
            message: errorMessage,
            timestamp: new Date().toISOString(),
        });
    }
}