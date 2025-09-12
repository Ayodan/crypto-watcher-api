const { GoogleSpreadsheet } = require('google-spreadsheet');

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Validate environment variables
        if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
            return res.status(500).json({
                error: 'Missing required environment variables',
                required: ['GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']
            });
        }

        // Initialize the sheet
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

        // Process the private key
        let privateKey = process.env.GOOGLE_PRIVATE_KEY;
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
            privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
        }
        privateKey = privateKey.replace(/\\n/g, '\n');

        // Authenticate with service account
        await doc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: privateKey,
        });

        // Load document info
        await doc.loadInfo();
        console.log(`Loaded sheet: ${doc.title}`);

        // Get the first sheet (your main crypto data)
        const sheet = doc.sheetsByIndex[0];
        if (!sheet) {
            return res.status(404).json({ error: 'No sheets found in spreadsheet' });
        }

        // Load header row and get all rows
        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();

        if (rows.length === 0) {
            return res.status(404).json({ error: 'No data found in spreadsheet' });
        }

        // Convert rows to JSON (adjust based on your actual column structure)
        const coins = rows.map(row => {
            // Get headers dynamically
            const rowData = {};
            sheet.headerValues.forEach((header, index) => {
                rowData[header.toLowerCase().replace(/\s+/g, '_')] = row._rawData[index] || '';
            });
            return rowData;
        });

        // Try to get alerts if there's an alerts sheet
        let recentAlerts = [];
        try {
            const alertsSheet = doc.sheetsByTitle['alerts_log'] || doc.sheetsByTitle['Alerts'] || doc.sheetsByTitle['alerts'];
            if (alertsSheet) {
                await alertsSheet.loadHeaderRow();
                const alertRows = await alertsSheet.getRows();
                recentAlerts = alertRows.slice(-20).map(row => {
                    const alertData = {};
                    alertsSheet.headerValues.forEach((header, index) => {
                        alertData[header.toLowerCase().replace(/\s+/g, '_')] = row._rawData[index] || '';
                    });
                    return alertData;
                });
            }
        } catch (alertError) {
            console.log('No alerts sheet found:', alertError.message);
        }

        // Response format
        const response = {
            success: true,
            timestamp: new Date().toISOString(),
            sheet_title: doc.title,
            coins: coins,
            alerts: recentAlerts,
            count: coins.length
        };

        res.status(200).json(response);

    } catch (error) {
        console.error('Error fetching crypto data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch crypto data',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}