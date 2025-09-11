import { GoogleSpreadsheet } from 'google-spreadsheet';

export default async function handler(req, res) {
    // CORS headers for your Lovable frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // Initialize Google Sheets
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

        await doc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });

        await doc.loadInfo();

        // Get live data sheet
        const liveDataSheet = doc.sheetsByTitle['live_data'];
        const rows = await liveDataSheet.getRows();

        // Convert to JSON format expected by frontend
        const coins = rows.map(row => ({
            id: row.coin_id,
            name: row.name,
            symbol: row.symbol,
            current_price: parseFloat(row.current_price) || 0,
            price_change_percentage_24h: parseFloat(row.price_change_24h) || 0,
            market_cap: parseFloat(row.market_cap) || 0,
            total_volume: parseFloat(row.total_volume) || 0,
            image: row.image_url,
            trending: row.trending === 'true',
            last_updated: row.timestamp
        }));

        // Get recent alerts
        const alertsSheet = doc.sheetsByTitle['alerts_log'];
        const alertRows = await alertsSheet.getRows();

        const recentAlerts = alertRows.slice(-20).map(row => ({
            id: `alert-${row.coin_id}-${row.timestamp}`,
            coin_id: row.coin_id,
            name: row.name,
            symbol: row.symbol,
            current_price: parseFloat(row.current_price) || 0,
            price_change: parseFloat(row.price_change_24h),
            alert_type: row.alert_type,
            severity: row.severity,
            timestamp: row.timestamp,
            image: row.image_url,
            notification_sent: row.notification_sent
        }));

        // Response format
        const response = {
            success: true,
            coins: coins,
            alerts: recentAlerts,
            lastUpdated: new Date().toISOString(),
            count: coins.length
        };

        res.status(200).json(response);
    } catch (error) {
        console.error('Error fetching crypto data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch crypto data',
            message: error.message
        });
    }
}