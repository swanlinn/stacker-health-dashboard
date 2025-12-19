export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  try {
    const SHEET_ID = process.env.SHEET_ID;
    const API_KEY = process.env.API_KEY;
    const SHEET_RANGE = process.env.SHEET_RANGE || 'Sheet1!A:H';

    if (!SHEET_ID || !API_KEY) {
      throw new Error('Missing environment variables');
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_RANGE}?key=${API_KEY}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google Sheets API error: ${response.statusText}`);
    }

    const jsonData = await response.json();
    if (!jsonData.values || jsonData.values.length === 0) {
      throw new Error('No data found in sheet');
    }

    const headers = jsonData.values[0];
    const rows = jsonData.values.slice(1);

    const processedData = processSheetData(rows, headers);
    
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');
    res.status(200).json(processedData);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}

function processSheetData(rows, headers) {
  const metrics = {};
  let weekEnding = '';

  rows.forEach(row => {
    const rowData = {};
    headers.forEach((h, i) => rowData[h.trim()] = row[i]);

    if (rowData.weekEnding && !weekEnding) weekEnding = rowData.weekEnding;

    const metricName = rowData.metricName;
    const timePeriod = rowData.timePeriod;
    const value = parseFloat(rowData.value) || 0;
    const previousValue = parseFloat(rowData.previousValue) || 0;
    const changePercent = parseFloat(rowData.changePercent) || 0;
    const historicalWeek = rowData.historicalWeek;
    const historicalValue = parseFloat(rowData.historicalValue) || 0;

    if (!metrics[metricName]) {
      metrics[metricName] = {
        current: null,
        fourWeek: null,
        thirteenWeek: null,
        historicalFourWeek: [],
        historicalThirteenWeek: []
      };
    }

    if (timePeriod && value) {
      metrics[metricName][timePeriod] = { value, previous: previousValue, change: changePercent };
    }

    if (historicalWeek && historicalValue) {
      const pt = { week: historicalWeek, value: historicalValue };
      const wNum = parseInt(historicalWeek.replace('W-', '').replace('W', ''));
      
      if (wNum <= 3 || historicalWeek === 'W0') {
        if (!metrics[metricName].historicalFourWeek.find(h => h.week === historicalWeek)) {
          metrics[metricName].historicalFourWeek.push(pt);
        }
      }
      if (wNum <= 12 || historicalWeek === 'W0') {
        if (!metrics[metricName].historicalThirteenWeek.find(h => h.week === historicalWeek)) {
          metrics[metricName].historicalThirteenWeek.push(pt);
        }
      }
    }
  });

  Object.keys(metrics).forEach(m => {
    const sortFn = (a, b) => {
      const aNum = a.week === 'W0' ? 0 : -parseInt(a.week.replace('W-', ''));
      const bNum = b.week === 'W0' ? 0 : -parseInt(b.week.replace('W-', ''));
      return bNum - aNum;
    };
    metrics[m].historicalFourWeek.sort(sortFn);
    metrics[m].historicalThirteenWeek.sort(sortFn);
  });

  return { weekEnding: weekEnding || new Date().toISOString().split('T')[0], metrics };
}
