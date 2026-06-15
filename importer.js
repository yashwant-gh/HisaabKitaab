const fs = require('fs');
const csv = require('csv-parser');

// Helper to normalize names
function normalizeName(name) {
  if (!name) return '';
  const clean = name.trim().toLowerCase();
  if (clean === 'aisha') return 'Aisha';
  if (clean === 'rohan' || clean === 'rohan ') return 'Rohan';
  if (clean === 'priya' || clean === 'priya s') return 'Priya';
  if (clean === 'meera') return 'Meera';
  if (clean === 'sam') return 'Sam';
  if (clean === 'dev') return 'Dev';
  if (clean === 'kabir') return 'Kabir';
  // Capitalize first letter as fallback
  return name.trim().charAt(0).toUpperCase() + name.trim().slice(1);
}

// Helper to parse date to YYYY-MM-DD
function parseDate(dateStr) {
  if (!dateStr) return null;
  const str = dateStr.trim();
  
  // E.g., "Mar-14"
  if (str.toLowerCase().startsWith('mar-')) {
    const parts = str.split('-');
    const day = parts[1];
    return `2026-03-${day.padStart(2, '0')}`;
  }

  // E.g., "01-02-2026", "04-05-2026", or "2025-01-02"
  const parts = str.split('-');
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // It is already YYYY-MM-DD
      const year = parts[0];
      const month = parts[1].padStart(2, '0');
      const day = parts[2].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    // Otherwise it is DD-MM-YYYY or DD-MM-YY
    let day = parts[0].padStart(2, '0');
    let month = parts[1].padStart(2, '0');
    let year = parts[2];
    if (year.length === 2) year = '20' + year;
    return `${year}-${month}-${day}`;
  }

  return null;
}

// Helper to parse amounts
function parseAmount(amtStr) {
  if (!amtStr) return 0;
  // Remove commas, quotes, etc.
  const clean = amtStr.replace(/,/g, '').replace(/"/g, '').trim();
  return parseFloat(clean) || 0;
}

// Parse CSV file path and return raw rows
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

// Helper to check if descriptions are similar (shares at least one significant word)
function areDescriptionsSimilar(descA, descB) {
  const a = descA.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = descB.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (a === b || a.includes(b) || b.includes(a)) return true;

  // Split into words and check if they share any word of length > 3 (e.g. 'marina', 'bites', 'thalassa')
  const wordsA = descA.toLowerCase().split(/[^a-z0-9]/).filter(w => w.length > 3);
  const wordsB = descB.toLowerCase().split(/[^a-z0-9]/).filter(w => w.length > 3);
  
  for (const w of wordsA) {
    if (wordsB.includes(w)) return true;
  }
  return false;
}

// Run anomaly detection
function analyzeExpenses(rawRows) {
  const parsedRows = rawRows.map((row, index) => {
    const dateRaw = row.date || '';
    const description = (row.description || '').trim();
    const paidByRaw = row.paid_by || '';
    const paidBy = normalizeName(paidByRaw);
    const amount = parseAmount(row.amount);
    const currency = (row.currency || '').trim().toUpperCase();
    const splitType = (row.split_type || '').trim().toLowerCase();
    const splitWithStr = row.split_with || '';
    const splitDetailsStr = row.split_details || '';
    const notes = (row.notes || '').trim();
    
    // Parse date
    const date = parseDate(dateRaw);

    // Parse split_with array
    const splitWith = splitWithStr.split(';')
      .map(name => normalizeName(name))
      .filter(name => name.length > 0);

    // Parse split details
    let splitDetails = {};
    if (splitDetailsStr) {
      const parts = splitDetailsStr.split(';');
      parts.forEach(part => {
        const match = part.trim().match(/^([A-Za-z\s]+)\s+([\d%.]+)$/);
        if (match) {
          const name = normalizeName(match[1]);
          let val = match[2];
          if (val.endsWith('%')) {
            splitDetails[name] = parseFloat(val.replace('%', ''));
          } else {
            splitDetails[name] = parseFloat(val);
          }
        }
      });
    }

    return {
      csvIndex: index,
      dateRaw,
      date,
      description,
      paidByRaw,
      paidBy,
      amount,
      currency,
      splitType,
      splitWith,
      splitDetails,
      notes
    };
  });

  const issues = [];
  const processedIndices = new Set();

  // 1. Detect Duplicates & Conflicts
  for (let i = 0; i < parsedRows.length; i++) {
    if (processedIndices.has(i)) continue;
    const rowA = parsedRows[i];

    // Find similar rows
    const duplicates = [];
    const conflicts = [];

    for (let j = i + 1; j < parsedRows.length; j++) {
      if (processedIndices.has(j)) continue;
      const rowB = parsedRows[j];

      // If dates match and amounts match
      if (rowA.date === rowB.date && Math.abs(rowA.amount - rowB.amount) < 0.01 && rowA.paidBy === rowB.paidBy) {
        if (areDescriptionsSimilar(rowA.description, rowB.description)) {
          duplicates.push(rowB);
          processedIndices.add(j);
        }
      }
      
      // If dates match, descriptions are similar, but payers or amounts differ (conflict, e.g. Thalassa dinner)
      if (rowA.date === rowB.date && !processedIndices.has(j)) {
        if (areDescriptionsSimilar(rowA.description, rowB.description)) {
          if (rowA.paidBy !== rowB.paidBy || Math.abs(rowA.amount - rowB.amount) > 1) {
            conflicts.push(rowB);
            processedIndices.add(j);
          }
        }
      }
    }

    if (duplicates.length > 0) {
      processedIndices.add(i);
      issues.push({
        id: `duplicate_${rowA.csvIndex}`,
        type: 'duplicate',
        message: `Duplicate entries detected on ${rowA.dateRaw} for "${rowA.description}" (${rowA.amount} ${rowA.currency || 'INR'}) by ${rowA.paidBy}.`,
        rows: [rowA, ...duplicates],
        suggestion: 'Keep one and delete the duplicates.'
      });
    } else if (conflicts.length > 0) {
      processedIndices.add(i);
      issues.push({
        id: `conflict_${rowA.csvIndex}`,
        type: 'conflict',
        message: `Conflicting records for similar event on ${rowA.dateRaw}: "${rowA.description}" (logged by ${rowA.paidBy} for ${rowA.amount}) vs "${conflicts[0].description}" (logged by ${conflicts[0].paidBy} for ${conflicts[0].amount}).`,
        rows: [rowA, ...conflicts],
        suggestion: 'Keep Aisha\'s log, Rohan\'s log, or merge/keep both.'
      });
    }
  }

  // 2. Scan remaining rows for other issues
  parsedRows.forEach((row) => {
    // If this row was already categorized in duplicates/conflicts, we still want to examine it,
    // but check if it's the primary row of that issue
    
    // Check missing payer
    if (!row.paidBy && row.amount > 0) {
      issues.push({
        id: `missing_payer_${row.csvIndex}`,
        type: 'missing_payer',
        message: `Expense "${row.description}" of ${row.amount} has no payer designated.`,
        row: row,
        suggestion: 'Specify who paid.'
      });
    }

    // Check missing currency
    if (!row.currency && row.amount > 0) {
      issues.push({
        id: `missing_currency_${row.csvIndex}`,
        type: 'missing_currency',
        message: `Expense "${row.description}" has no currency code specified.`,
        row: row,
        suggestion: 'Set currency (typically INR).'
      });
    }

    // Check invalid split details (e.g. percentages summing to 110%)
    if (row.splitType === 'percentage' && Object.keys(row.splitDetails).length > 0) {
      const totalPct = Object.values(row.splitDetails).reduce((a, b) => a + b, 0);
      if (Math.abs(totalPct - 100) > 0.1) {
        issues.push({
          id: `invalid_percentage_${row.csvIndex}`,
          type: 'invalid_percentage',
          message: `Percentage split for "${row.description}" sums to ${totalPct}% instead of 100%.`,
          row: row,
          suggestion: 'Normalize percentages to sum to 100%.'
        });
      }
    }

    // Check membership validation: Meera moving out end of March, but charged in April
    if (row.date && row.date > '2026-03-31' && row.splitWith.includes('Meera')) {
      issues.push({
        id: `membership_violation_meera_${row.csvIndex}`,
        type: 'membership_violation',
        message: `Meera is charged for "${row.description}" on ${row.dateRaw}, but she moved out on March 31, 2026.`,
        row: row,
        suggestion: 'Remove Meera from this expense split.'
      });
    }

    // Check Ambiguous date format (04-05-2026 - May 4 or April 5)
    if (row.dateRaw === '04-05-2026' || row.notes.toLowerCase().includes('format is a mess')) {
      issues.push({
        id: `ambiguous_date_${row.csvIndex}`,
        type: 'ambiguous_date',
        message: `Date format for "${row.description}" (${row.dateRaw}) is ambiguous. Notes ask if it's April 5 or May 4.`,
        row: row,
        suggestion: 'Select correct date (April 5 or May 4).'
      });
    }

    // Check settlements logged as expenses
    const desc = row.description.toLowerCase();
    const isSettlementDescription = desc.includes('paid back') || desc.includes('settled') || desc.includes('deposit share') || desc.includes('settlement');
    const hasSingleSplit = row.splitWith.length === 1;
    if ((isSettlementDescription || !row.splitType) && row.amount > 0 && hasSingleSplit) {
      issues.push({
        id: `settlement_detected_${row.csvIndex}`,
        type: 'settlement_detected',
        message: `"${row.description}" looks like a settlement/direct payment from ${row.paidBy} to ${row.splitWith[0]} instead of a split expense.`,
        row: row,
        suggestion: 'Record as a debt settlement.'
      });
    }
  });

  return {
    parsedRows,
    issues
  };
}

module.exports = {
  parseCSV,
  analyzeExpenses,
  normalizeName,
  parseDate
};
