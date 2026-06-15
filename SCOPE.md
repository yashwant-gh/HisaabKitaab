# HisaabKitaab — Project Scope & Database Documentation

HisaabKitaab is a collaborative, privacy-oriented expense-sharing and balance-tracking web application designed for group households, trips, and shared events. The application supports multi-currency expenses, automated CSV history imports, historical currency exchange conversion, split validation, and multi-factor approval workflows.

---

## 1. Project Scope & Architecture

### Tech Stack
- **Backend**: Node.js & Express framework.
- **Database**: Dual-engine support via a unified query interface in `database.js`. Uses **SQLite** (`hisaab.db`) for local development and supports **PostgreSQL** for production environments via connection strings.
- **Frontend**: Clean single-page application (SPA) architecture built with semantic HTML5, Vanilla JavaScript, and customized modern dark-mode CSS with glassmorphic elements.
- **Authentication**: Dual secure flows supporting traditional email-password credentials (secured via bcrypt hashing) and modern passwordless integration (Google OAuth 2.0 and Email OTP verification).

### Key Features & Security Mechanics
1. **Secure Endpoints & Privacy Control**:
   - Access tokens are signed using JWT.
   - Strict server-side validation checks block cross-user detail leakage. A user cannot access or view another user's personal details or transactional balances by altering parameter IDs or names in the API endpoints.
2. **Creator-Only Group Administration**:
   - Group modification logic specifies a group creator field (`created_by`).
   - Only the original group creator is authorized to remove members from the group.
3. **Interactive CSV Import Wizard**:
   - Parses CSV data exports containing arbitrary header capitalization and minor format anomalies.
   - Detects 11 distinct types of database or transactional inconsistencies (detailed below) and presents them in a cleanup wizard for human verification before writing rows to the database.
4. **Manual Expense Log & Consensus Approval**:
   - Allows users to log expenses manually by specifying description, amount, date, category (Food, Grocery, Travel, others), list of participants, and split types (Equal split or Percentage split).
   - manual entries start with a `pending` state and remain inactive for debt calculations until approved.
   - In-app and email notifications are sent to all designated participants to approve the transaction.
   - **Optimization**: The user entering the manual expense (payer/submitter) is automatically marked as approved, so they do not receive redundant notifications.
   - The expense is marked `approved` and active only when consensus is reached (all participants approve).
5. **Historical Exchange Rate Integration**:
   - Non-INR currency transactions (such as USD, EUR, and GBP) are converted to INR using historical exchange rates matching the **exact transaction date** instead of the log date.
   - Converts currency by making historical API queries to the Frankfurter API, falling back to static historical currency data in case of connection limits or API unavailability.
6. **Privacy-First Balance Sheet**:
   - Users are restricted to viewing only their own pending debts and credits (e.g., who they owe and who owes them) inside the group view rather than a public ledger displaying everyone's private balances.
   - Users see a "Fully Settled" notice only when their personal net balance is precisely 0.
7. **Spend Visualizations & Statements**:
   - Traditional bar charts on the dashboard are replaced with a high-fidelity line chart tracking only the logged-in user's monthly spending trends.
   - Built-in options to download monthly expense statements in standard CSV format.

---

## 2. CSV Anomaly Log

Below is the detailed log of the 11 anomalies detected in `Expenses Export.csv` during parsing, along with how they were programmatically flagged and resolved in the wizard:

| # | Anomaly Type | Description / CSV Row Reference | Detection Rule / Suggestion | Chosen Resolution & Handling |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Duplicate Record** | Rows 5 & 6:<br>`08-02-2026,Dinner at Marina Bites,Dev,3200,INR,equal...`<br>`08-02-2026,dinner - marina bites,Dev,3200,INR,equal...` | Date, amount, payer, and description similarity match.<br>*Suggestion: Keep one, delete duplicates.* | **Keep first record** containing notes `"Dev visiting for the weekend"`; discarded the second record. |
| **2** | **Conflict Record** | Rows 24 & 25:<br>`11-03-2026,Dinner at Thalassa,Aisha,2400,INR,equal...`<br>`11-03-2026,Thalassa dinner,Rohan,2450,INR,equal...` | Similar descriptions, same date, but differing amounts and payers.<br>*Suggestion: Select correct log.* | **Keep Aisha's log**: ₹2400 ("Dinner at Thalassa") and discard Rohan's conflicting log. |
| **3** | **Missing Payer** | Row 13:<br>`22-02-2026,House cleaning supplies,,780,INR,equal...` | Blank/null value in `paid_by` field.<br>*Suggestion: Specify who paid.* | **Set Aisha** as the designated payer. |
| **4** | **Settlement Detected** | Row 14:<br>`25-02-2026,Rohan paid Aisha back,Rohan,5000,INR,,Aisha...` | Single split target with description containing "paid back" or "settled".<br>*Suggestion: Record as settlement.* | **Convert to a direct Settlement** from Rohan to Aisha (bypasses regular splits). |
| **5** | **Invalid Percentage** | Row 15:<br>`28-02-2026,Pizza Friday,Aisha,1440,INR,percentage...`<br>`Aisha 30%; Rohan 30%; Priya 30%; Meera 20%` | Custom split percentages sum to 110% instead of 100%.<br>*Suggestion: Normalize to sum to 100%.* | **Auto-Normalize percentages** proportionally to 100% (30/30/30/20% becomes 27.27/27.27/27.27/18.18%). |
| **6** | **Missing Currency** | Row 28:<br>`15-03-2026,Groceries DMart,Priya,2105,,equal...` | Missing currency identifier.<br>*Suggestion: Set currency code.* | **Set currency to INR (₹)**. |
| **7** | **Invalid Percentage** | Row 32:<br>`25-03-2026,Weekend brunch,Meera,2200,INR,percentage...`<br>`Aisha 30%; Rohan 30%; Priya 30%; Meera 20%` | Custom split percentages sum to 110% instead of 100%.<br>*Suggestion: Normalize to sum to 100%.* | **Auto-Normalize percentages** proportionally to 100% (30/30/30/20% becomes 27.27/27.27/27.27/18.18%). |
| **8** | **Ambiguous Date** | Row 34:<br>`04-05-2026,Deep cleaning service,Rohan,2500,INR,equal...` | Date text matches ambiguous formats (like DD-MM or MM-DD).<br>*Suggestion: Select correct date.* | **Set date to April 5, 2026** (confirming DD-MM format). |
| **9** | **Membership Violation** | Row 36:<br>`02-04-2026,Groceries BigBasket,Priya,2640,INR,equal...`<br>*(Meera is in the split but left the group on March 31, 2026)* | Date of transaction is after user's configured exit date.<br>*Suggestion: Remove member from split.* | **Remove Meera from split** and re-split her share among remaining active participants. |
| **10** | **Settlement Detected** | Row 38:<br>`08-04-2026,Sam deposit share,Sam,15000,INR,equal,Aisha` | Single split target with description containing "deposit share" or "settled".<br>*Suggestion: Record as settlement.* | **Convert to a direct Settlement** from Sam to Aisha (resolved correctly despite a minor UI label typo). |
| **11** | **Missing Member** | References to Meera in early February rows before group memberships were fully aligned. | Reference to a user who is not registered in the database.<br>*Suggestion: Add member or skip.* | **Automatically add Meera** to the active group (Joined date set to `2026-02-01`). |

---

## 3. Database Schema

HisaabKitaab supports both SQLite (default development) and PostgreSQL (production deployment) structures.

### 1. `users` Table
Stores registered users, authentication tokens, and user credentials.
- **SQLite DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_hash TEXT,
    name TEXT UNIQUE,
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```
- **PostgreSQL DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    name TEXT UNIQUE,
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```

### 2. `groups` Table
Stores details of user groups.
- **SQLite DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```
- **PostgreSQL DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    name TEXT,
    description TEXT,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```

### 3. `group_members` Table
Associates users to groups, tracking membership timelines for transaction validation.
- **SQLite DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER,
    user_name TEXT,
    joined_at DATE,
    left_at DATE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );
  ```
- **PostgreSQL DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    user_name TEXT,
    joined_at DATE,
    left_at DATE
  );
  ```

### 4. `expenses` Table
Stores split transactions and debt settlements.
- **SQLite DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER,
    description TEXT,
    paid_by TEXT,
    amount REAL,
    currency TEXT,
    exchange_rate REAL DEFAULT 1.0,
    split_type TEXT,
    date DATE,
    notes TEXT,
    is_settlement INTEGER DEFAULT 0,
    category TEXT,
    status TEXT DEFAULT 'approved',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );
  ```
- **PostgreSQL DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    description TEXT,
    paid_by TEXT,
    amount DOUBLE PRECISION,
    currency TEXT,
    exchange_rate DOUBLE PRECISION DEFAULT 1.0,
    split_type TEXT,
    date DATE,
    notes TEXT,
    is_settlement INTEGER DEFAULT 0,
    category TEXT,
    status TEXT DEFAULT 'approved',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```

### 5. `expense_splits` Table
Stores individual shares and calculated split balances in both original currency and INR.
- **SQLite DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS expense_splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER,
    user_name TEXT,
    split_value REAL,
    calculated_amount REAL,
    calculated_amount_inr REAL,
    FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
  );
  ```
- **PostgreSQL DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS expense_splits (
    id SERIAL PRIMARY KEY,
    expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
    user_name TEXT,
    split_value DOUBLE PRECISION,
    calculated_amount DOUBLE PRECISION,
    calculated_amount_inr DOUBLE PRECISION
  );
  ```

### 6. `group_invitations` Table
Manages invites sent to users to join groups.
- **SQLite DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS group_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER,
    invited_by TEXT,
    invitee_email TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );
  ```
- **PostgreSQL DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS group_invitations (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    invited_by TEXT,
    invitee_email TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```

### 7. `expense_approvals` Table
Tracks manual entry confirmation approvals from participants.
- **SQLite DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS expense_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER,
    user_name TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
  );
  ```
- **PostgreSQL DDL**:
  ```sql
  CREATE TABLE IF NOT EXISTS expense_approvals (
    id SERIAL PRIMARY KEY,
    expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
    user_name TEXT,
    status TEXT DEFAULT 'pending'
  );
  ```
