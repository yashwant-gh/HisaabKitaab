require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const db = require('./database');
const importer = require('./importer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'hisaab_kitaab_secret_key_2026';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer for CSV upload (memory storage is clean and fast)
const upload = multer({ storage: multer.memoryStorage() });

// In-memory OTP Cache
const otpCache = {};

// Nodemailer SMTP Transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Helper to send email OTP
async function sendOTPEmail(email, otp) {
  const mailOptions = {
    from: `"Hisaab Kitaab" <${process.env.SMTP_USER || 'no-reply@hisaab.com'}>`,
    to: email,
    subject: 'Your Hisaab Kitaab Verification Code',
    text: `Hello,\n\nYour 6-digit verification code for Hisaab Kitaab signup is: ${otp}\n\nThis code will expire in 5 minutes.\n\nBest regards,\nThe Hisaab Kitaab Team`,
    html: `
      <div style="font-family: 'Nunito', sans-serif; padding: 20px; border: 1px solid #edf2f7; border-radius: 12px; max-width: 500px; margin: 0 auto; background-color: #f7fafc;">
        <h2 style="color: #5d5bf6; font-family: 'Fredoka', sans-serif; text-align: center; margin-bottom: 20px;">💸 Hisaab Kitaab</h2>
        <p style="font-size: 1rem; color: #2b2d42;">Hello,</p>
        <p style="font-size: 1rem; color: #2b2d42;">Your verification code for signing up to Hisaab Kitaab is:</p>
        <div style="text-align: center; margin: 24px 0;">
          <span style="font-size: 2.2rem; font-weight: 800; color: #5d5bf6; letter-spacing: 5px; background: white; padding: 10px 24px; border-radius: 8px; border: 2px dashed #5d5bf6;">${otp}</span>
        </div>
        <p style="font-size: 0.9rem; color: #6c757d; text-align: center;">This code will expire in 5 minutes.</p>
        <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 20px 0;">
        <p style="font-size: 0.8rem; color: #a0aec0; text-align: center;">Hisaab Kitaab App — Splitting expenses made easy, clean, and playful!</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

// --- Exchange Rate Helper ---
async function getExchangeRate(currency, dateStr) {
  if (!currency || currency.toUpperCase() === 'INR') return 1.0;
  
  const date = dateStr || new Date().toISOString().split('T')[0];
  try {
    const res = await fetch(`https://api.frankfurter.app/${date}?from=${currency.toUpperCase()}&to=INR`);
    if (res.ok) {
      const data = await res.json();
      if (data.rates && data.rates.INR) {
        return parseFloat(data.rates.INR);
      }
    }
  } catch (err) {
    console.warn(`Frankfurter rate fetch failed for ${currency} on ${date}. Trying fallback.`, err);
  }
  
  // Static Fallbacks
  const c = currency.toUpperCase();
  if (c === 'USD') return 83.5;
  if (c === 'EUR') return 90.0;
  if (c === 'GBP') return 105.0;
  return 1.0;
}

// --- Auth Middleware ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Unauthorized: Access token missing' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden: Invalid token' });
    req.user = user;
    next();
  });
}

// ==========================================
// AUTHENTICATION ROUTING
// ==========================================



// Google Login Simulation
app.post('/api/auth/google-login', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Member name is required' });

  try {
    // Check if user exists
    let users = await db.query(`SELECT * FROM users WHERE name = ?`, [name]);
    let user;

    if (users.length === 0) {
      // Auto-create Google user if they don't exist
      const email = `${name.toLowerCase()}@hisaab.com`;
      const avatarUrl = `https://api.dicebear.com/7.x/adventurer/svg?seed=${name}`;
      const result = await db.run(
        `INSERT INTO users (name, email, password_hash, avatar_url) VALUES (?, ?, NULL, ?)`,
        [name, email, avatarUrl]
      );
      user = { id: result.lastID, name, email, avatar_url: avatarUrl };
    } else {
      user = users[0];
    }

    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error during Google Sign-in' });
  }
});

// Request Signup OTP
app.post('/api/auth/signup-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpCache[email] = {
    otp,
    expires: Date.now() + 5 * 60 * 1000 // 5 minutes validity
  };

  try {
    await sendOTPEmail(email, otp);
    res.json({ message: 'Verification OTP sent to your email successfully!' });
  } catch (err) {
    console.error('Error sending email:', err);
    console.log(`\n==================================================`);
    console.log(`[SMTP FALLBACK] Verification OTP for ${email} is: ${otp}`);
    console.log(`==================================================\n`);
    res.status(500).json({ 
      error: 'Failed to send verification email. Please check your SMTP credentials in .env. (Backup: Check your terminal console for the verification OTP code so you can log in!)'
    });
  }
});

// Verify OTP
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

  const record = otpCache[email];
  if (!record) return res.status(400).json({ error: 'No OTP generated for this email' });
  if (record.expires < Date.now()) return res.status(400).json({ error: 'OTP has expired' });
  if (record.otp !== otp.trim()) return res.status(400).json({ error: 'Invalid OTP' });

  res.json({ message: 'OTP verified successfully' });
});

// Signup Complete (Set Password)
app.post('/api/auth/signup-complete', async (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: 'Email, name, and password are required' });

  try {
    const existingUser = await db.query(`SELECT * FROM users WHERE email = ? OR name = ?`, [email, name]);
    if (existingUser.length > 0) {
      // If a placeholder user (seeded by name) exists, update their record
      const user = existingUser[0];
      if (user.password_hash === null && user.email === email) {
        const hash = await bcrypt.hash(password, 10);
        await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, user.id]);
        const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url } });
      }
      return res.status(400).json({ error: 'User with this email or name already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const avatarUrl = `https://api.dicebear.com/7.x/adventurer/svg?seed=${name}`;
    const result = await db.run(
      `INSERT INTO users (name, email, password_hash, avatar_url) VALUES (?, ?, ?, ?)`,
      [name, email, hash, avatarUrl]
    );

    const token = jwt.sign({ id: result.lastID, name, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: result.lastID, name, email, avatar_url: avatarUrl } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error during registration complete' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  try {
    const users = await db.query(`SELECT * FROM users WHERE email = ?`, [email]);
    if (users.length === 0) return res.status(400).json({ error: 'Invalid email or password' });

    const user = users[0];
    if (!user.password_hash) {
      return res.status(400).json({ error: 'This account was created via social sign-in. Use Google Login.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Get Current Profile
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// ==========================================
// GROUP MANAGEMENT
// ==========================================

// Get user's groups
app.get('/api/groups', authenticateToken, async (req, res) => {
  try {
    // For simplicity, returns all groups since this is a shared workspace flatmate app
    const groups = await db.query(`SELECT * FROM groups`);
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Get group details and members
app.get('/api/groups/:id', authenticateToken, async (req, res) => {
  try {
    const group = await db.query(`SELECT * FROM groups WHERE id = ?`, [req.params.id]);
    if (group.length === 0) return res.status(404).json({ error: 'Group not found' });

    const members = await db.query(
      `SELECT * FROM group_members WHERE group_id = ? ORDER BY joined_at ASC`,
      [req.params.id]
    );

    res.json({ ...group[0], members });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch group details' });
  }
});

// Manage members (add / update membership dates)
app.post('/api/groups/:id/members', authenticateToken, async (req, res) => {
  const { user_name, joined_at, left_at } = req.body;
  if (!user_name || !joined_at) return res.status(400).json({ error: 'Member name and join date are required' });

  try {
    // Create placeholder user if doesn't exist
    const userExist = await db.query(`SELECT * FROM users WHERE name = ?`, [user_name]);
    if (userExist.length === 0) {
      const email = `${user_name.toLowerCase()}@hisaab.com`;
      const avatarUrl = `https://api.dicebear.com/7.x/adventurer/svg?seed=${user_name}`;
      await db.run(
        `INSERT INTO users (name, email, password_hash, avatar_url) VALUES (?, ?, NULL, ?)`,
        [user_name, email, avatarUrl]
      );
    }

    // Check if already group member
    const existingMember = await db.query(
      `SELECT * FROM group_members WHERE group_id = ? AND user_name = ?`,
      [req.params.id, user_name]
    );

    if (existingMember.length > 0) {
      await db.run(
        `UPDATE group_members SET joined_at = ?, left_at = ? WHERE group_id = ? AND user_name = ?`,
        [joined_at, left_at || null, req.params.id, user_name]
      );
    } else {
      await db.run(
        `INSERT INTO group_members (group_id, user_name, joined_at, left_at) VALUES (?, ?, ?, ?)`,
        [req.params.id, user_name, joined_at, left_at || null]
      );
    }

    res.json({ message: 'Group membership updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// ==========================================
// EXPENSES & BALANCES (PERSPECTIVES & AUDITS)
// ==========================================

// Get exchange rate lookup API
app.get('/api/exchange-rate', async (req, res) => {
  const { currency, date } = req.query;
  const rate = await getExchangeRate(currency, date);
  res.json({ rate });
});

// Get group expenses
app.get('/api/groups/:groupId/expenses', authenticateToken, async (req, res) => {
  try {
    const expenses = await db.query(
      `SELECT * FROM expenses WHERE group_id = ? ORDER BY date DESC, id DESC`,
      [req.params.groupId]
    );

    // Fetch splits for each expense
    for (const exp of expenses) {
      exp.splits = await db.query(
        `SELECT user_name, split_value, calculated_amount, calculated_amount_inr FROM expense_splits WHERE expense_id = ?`,
        [exp.id]
      );
    }

    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// Delete an expense
app.delete('/api/groups/:groupId/expenses/:expenseId', authenticateToken, async (req, res) => {
  try {
    await db.run(`DELETE FROM expenses WHERE id = ? AND group_id = ?`, [req.params.expenseId, req.params.groupId]);
    res.json({ message: 'Expense deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

// Create a new expense
app.post('/api/groups/:groupId/expenses', authenticateToken, async (req, res) => {
  const {
    description,
    paid_by,
    amount,
    currency,
    split_type,
    date,
    notes,
    is_settlement,
    splits // Array of { userName, value }
  } = req.body;

  if (!description || !paid_by || amount === undefined || !split_type || !date || !splits) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const exchangeRate = await getExchangeRate(currency, date);
    const amountInr = amount * exchangeRate;

    const result = await db.run(
      `INSERT INTO expenses (group_id, description, paid_by, amount, currency, exchange_rate, split_type, date, notes, is_settlement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.groupId, description, paid_by, amount, currency, exchangeRate, split_type, date, notes || '', is_settlement ? 1 : 0]
    );
    const expenseId = result.lastID;

    // Calculate splits
    const totalAmount = parseFloat(amount);
    let calculatedSplits = [];

    if (split_type === 'equal') {
      const share = totalAmount / splits.length;
      calculatedSplits = splits.map(s => ({
        userName: s.userName,
        value: 1,
        calculated_amount: share,
        calculated_amount_inr: share * exchangeRate
      }));
    } else if (split_type === 'unequal') {
      calculatedSplits = splits.map(s => ({
        userName: s.userName,
        value: parseFloat(s.value),
        calculated_amount: parseFloat(s.value),
        calculated_amount_inr: parseFloat(s.value) * exchangeRate
      }));
    } else if (split_type === 'percentage') {
      calculatedSplits = splits.map(s => {
        const pct = parseFloat(s.value);
        const share = (pct / 100) * totalAmount;
        return {
          userName: s.userName,
          value: pct,
          calculated_amount: share,
          calculated_amount_inr: share * exchangeRate
        };
      });
    } else if (split_type === 'share') {
      const totalShares = splits.reduce((acc, curr) => acc + parseFloat(curr.value), 0);
      calculatedSplits = splits.map(s => {
        const sh = parseFloat(s.value);
        const share = (sh / totalShares) * totalAmount;
        return {
          userName: s.userName,
          value: sh,
          calculated_amount: share,
          calculated_amount_inr: share * exchangeRate
        };
      });
    }

    // Insert splits
    for (const cs of calculatedSplits) {
      await db.run(
        `INSERT INTO expense_splits (expense_id, user_name, split_value, calculated_amount, calculated_amount_inr)
         VALUES (?, ?, ?, ?, ?)`,
        [expenseId, cs.userName, cs.value, cs.calculated_amount, cs.calculated_amount_inr]
      );
    }

    res.json({ message: 'Expense created successfully', expenseId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

// Get Group Balances (Calculated, Simplified, Audit Breakdowns)
app.get('/api/groups/:groupId/balances', authenticateToken, async (req, res) => {
  const groupId = req.params.groupId;
  try {
    // 1. Fetch group members
    const members = await db.query(`SELECT * FROM group_members WHERE group_id = ?`, [groupId]);
    const memberNames = members.map(m => m.user_name);
    
    // Create member mapping with join/leave dates
    const memberMap = {};
    members.forEach(m => {
      memberMap[m.user_name] = {
        joined: m.joined_at,
        left: m.left_at
      };
    });

    // 2. Fetch all expenses and splits
    const expenses = await db.query(
      `SELECT * FROM expenses WHERE group_id = ? ORDER BY date ASC, id ASC`
    );
    for (const exp of expenses) {
      exp.splits = await db.query(
        `SELECT user_name, split_value, calculated_amount, calculated_amount_inr FROM expense_splits WHERE expense_id = ?`,
        [exp.id]
      );
    }

    // 3. Compute net balance for each group member
    // Net = Total Paid (as expense_payer) - Total Share (as split_member) + SettlementsPaid - SettlementsReceived
    const balances = {};
    memberNames.forEach(name => {
      balances[name] = 0.0;
    });

    expenses.forEach(exp => {
      const exchangeRate = exp.exchange_rate || 1.0;
      const amtInr = exp.amount * exchangeRate;

      if (exp.is_settlement) {
        // Payer increases balance (gave money)
        if (balances[exp.paid_by] !== undefined) {
          balances[exp.paid_by] += amtInr;
        }
        // Splits contain the receiver(s) (normally just 1 person)
        exp.splits.forEach(sp => {
          if (balances[sp.user_name] !== undefined) {
            balances[sp.user_name] -= sp.calculated_amount_inr; // receiver's balance decreases
          }
        });
      } else {
        // Normal expense
        // Payer gets credit
        if (balances[exp.paid_by] !== undefined) {
          balances[exp.paid_by] += amtInr;
        }
        // Splitters get charged
        exp.splits.forEach(sp => {
          if (balances[sp.user_name] !== undefined) {
            balances[sp.user_name] -= sp.calculated_amount_inr;
          }
        });
      }
    });

    // 4. AISHA'S PERSPECTIVE: Debt Simplification
    const payments = [];
    const debtors = [];
    const creditors = [];

    for (const name in balances) {
      const bal = balances[name];
      if (bal < -0.01) {
        debtors.push({ name, amount: -bal });
      } else if (bal > 0.01) {
        creditors.push({ name, amount: bal });
      }
    }

    // Sort to optimize payments (Min Cash Flow Algorithm)
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    let d = 0, c = 0;
    // Clone lists to avoid modifying original variables
    const dList = debtors.map(x => ({ ...x }));
    const cList = creditors.map(x => ({ ...x }));

    while (d < dList.length && c < cList.length) {
      const debtor = dList[d];
      const creditor = cList[c];

      const settleAmt = Math.min(debtor.amount, creditor.amount);
      if (settleAmt > 0.01) {
        payments.push({
          from: debtor.name,
          to: creditor.name,
          amount: Math.round(settleAmt * 100) / 100
        });
      }

      debtor.amount -= settleAmt;
      creditor.amount -= settleAmt;

      if (debtor.amount < 0.01) d++;
      if (creditor.amount < 0.01) c++;
    }

    // 5. ROHAN'S / PRIYA'S / SAM'S PERSPECTIVES: Audit Breakdown
    // For each user, construct their list of line-item ledger rows
    const audits = {};
    memberNames.forEach(name => {
      const auditTrail = [];
      let runningSum = 0;

      expenses.forEach(exp => {
        const isPayer = exp.paid_by === name;
        const mySplit = exp.splits.find(sp => sp.user_name === name);
        const exchangeRate = exp.exchange_rate || 1.0;
        
        if (!isPayer && !mySplit) return; // User not involved

        let shareAmtInr = mySplit ? mySplit.calculated_amount_inr : 0;
        let paidAmtInr = isPayer ? exp.amount * exchangeRate : 0;

        let change = 0;
        let details = '';

        if (exp.is_settlement) {
          if (isPayer) {
            // I paid someone back, my debt decreases (positive impact on balance)
            change = paidAmtInr;
            const receiverName = exp.splits[0] ? exp.splits[0].user_name : 'someone';
            details = `Settled: Paid ${receiverName}`;
          } else {
            // I was paid back by someone, my credit decreases (negative impact on balance)
            change = -shareAmtInr;
            details = `Settled: Received from ${exp.paid_by}`;
          }
        } else {
          change = paidAmtInr - shareAmtInr;
          if (isPayer && mySplit) {
            details = `You paid & split (Share: ${mySplit.calculated_amount.toFixed(2)} ${exp.currency})`;
          } else if (isPayer) {
            details = `You paid (Not in split)`;
          } else {
            details = `Split share (Paid by ${exp.paid_by})`;
          }
        }

        runningSum += change;

        auditTrail.push({
          id: exp.id,
          date: exp.date,
          description: exp.description,
          type: exp.is_settlement ? 'settlement' : 'expense',
          originalAmount: exp.amount,
          currency: exp.currency,
          exchangeRate,
          paidAmount: isPayer ? exp.amount : 0,
          shareAmount: mySplit ? mySplit.calculated_amount : 0,
          paidInr: paidAmtInr,
          shareInr: shareAmtInr,
          changeInr: change,
          runningSumInr: runningSum,
          details
        });
      });

      audits[name] = {
        auditTrail,
        finalBalance: runningSum
      };
    });

    res.json({
      balances,          // Raw balances
      payments,          // Aisha's paywhom transactions
      audits,            // Rohan's/Priya's detailed transaction trails
      memberMap          // Membership date details (helpful for Sam's validation UI)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compute balances' });
  }
});


// ==========================================
// CSV FILE ANALYSIS & CONFIRM ENDPOINTS
// ==========================================

// Parse & Analyze uploaded CSV
app.post('/api/import/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file upload is required' });

  try {
    // Write temporary file
    const tempPath = path.join(__dirname, 'temp_upload.csv');
    fs.writeFileSync(tempPath, req.file.buffer);

    const rawRows = await importer.parseCSV(tempPath);
    // Delete temp file
    fs.unlinkSync(tempPath);

    const analysis = importer.analyzeExpenses(rawRows);
    res.json(analysis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to parse and analyze CSV' });
  }
});

// Import Final Checked / Cleaned CSV rows
app.post('/api/import/confirm', authenticateToken, async (req, res) => {
  const { groupId, expenses } = req.body;
  if (!groupId || !expenses || !Array.isArray(expenses)) {
    return res.status(400).json({ error: 'groupId and expenses list are required' });
  }

  try {
    await db.run('BEGIN TRANSACTION');

    for (const exp of expenses) {
      const exchangeRate = parseFloat(exp.exchangeRate) || 1.0;
      const result = await db.run(
        `INSERT INTO expenses (group_id, description, paid_by, amount, currency, exchange_rate, split_type, date, notes, is_settlement)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          groupId,
          exp.description,
          exp.paidBy,
          exp.amount,
          exp.currency,
          exchangeRate,
          exp.splitType,
          exp.date,
          exp.notes || '',
          exp.isSettlement ? 1 : 0
        ]
      );
      
      const expenseId = result.lastID;

      // Insert splits
      for (const sp of exp.splits) {
        await db.run(
          `INSERT INTO expense_splits (expense_id, user_name, split_value, calculated_amount, calculated_amount_inr)
           VALUES (?, ?, ?, ?, ?)`,
          [
            expenseId,
            sp.userName,
            sp.value,
            sp.calculatedAmount,
            sp.calculatedAmountInr
          ]
        );
      }
    }

    await db.run('COMMIT');
    res.json({ message: `Successfully imported ${expenses.length} clean expenses!` });
  } catch (err) {
    await db.run('ROLLBACK');
    console.error('Import transaction error:', err);
    res.status(500).json({ error: 'Import failed and transactions were rolled back.' });
  }
});


// ==========================================
// STARTUP AND SEEDING
// ==========================================

async function startServer() {
  try {
    db.initDb();
    await db.setupSchema();
    await db.seedData();
    
    app.listen(PORT, () => {
      console.log(`\n==================================================`);
      console.log(`Hisaab Kitaab backend listening at http://localhost:${PORT}`);
      console.log(`==================================================\n`);
    });
  } catch (err) {
    console.error('Server startup failed:', err);
    process.exit(1);
  }
}

startServer();
