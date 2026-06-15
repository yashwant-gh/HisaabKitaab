# 🪙 HisaabKitaab (हिसाब-किताब)

> A smart, secure, and beautiful expense-splitting & group settlement application featuring real-time exchange rates, consensus approvals, and an interactive CSV anomaly resolution wizard.

---

## ✨ Features

### 🎨 Premium Glassmorphic UI & Visuals
- **Modern Dark-Mode Aesthetic**: Curated glassmorphism panel styling, harmony-guided color schemes, fluid micro-animations, and responsive Flex/Grid layouts.
- **Personalized Visual Analytics**: An interactive, smooth line graph charting the logged-in user's monthly spending trends.
- **Responsive Workspace**: Seamless transition between desktop and mobile devices.

### 🛡️ Privacy & Security First
- **Secure Endpoints**: Full JWT-based session security. APIs verify ownership and group membership to prevent ID-harvesting and URL manipulation breaches.
- **Creator Rights**: Only the group creator possesses permissions to remove members from group lists.
- **Granular Debts**: General group ledger is filtered; members can only see their own pending debts (who they owe and who owes them) protecting individual transaction logs.

### ⚙️ Multi-Currency & Advanced Splits
- **Historical Currency Rates**: Converts foreign currency transactions (USD, EUR, GBP) to INR based on the **exact transaction date** using the Frankfurter API (with local static backups).
- **Consensus manual split approval**: Manual entries must be verified by all non-payer participants before registering as legitimate.
- **Import Error Wizard**: Scans uploaded CSV files for 11 distinct transaction inconsistencies (duplicates, conflicts, invalid dates/splits) and lets you resolve them interactively.

---

## 🚀 Tech Stack

- **Frontend**: Single-Page Architecture using semantic HTML5, Vanilla JavaScript, and Custom CSS.
- **Backend**: Node.js & Express framework.
- **Database Engine**: Supports both SQLite (local development) and PostgreSQL (production).
- **Email Engine**: Nodemailer (SMTP integration) for OTP authentication and manual expense approval notifications.
- **External APIs**: Frankfurter API for historical conversion rates.

---

## 📦 Directory Structure

```bash
HisaabKitaab/
├── public/                 # HTML templates, CSS styles, client-side JS
├── database.js             # SQLite / PostgreSQL dual database manager
├── server.js               # Express API and routes configuration
├── importer.js             # CSV parser and anomaly logic processor
├── Expenses Export.csv     # Sample CSV spreadsheet log
├── SCOPE.md                # Detailed database schema and CSV anomaly logs
├── README.md               # App documentation
├── package.json            # Dependencies and start scripts
└── .env                    # Secret environment parameters
```

---

## 🛠️ Getting Started

### 📋 Prerequisites
Ensure you have **Node.js** (version >= 18.0.0) installed on your system.

### 💻 Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/yashwant-gh/HisaabKitaab.git
   cd HisaabKitaab
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory and populate the required configuration settings:
   ```env
   PORT=3000
   JWT_SECRET=hisaab_kitaab_secret_key_2026

   # SMTP Configurations (for OTP and approvals)
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-smtp-app-password

   # OAuth Integration
   GOOGLE_CLIENT_ID=your-google-client-id

   # Production DB (Optional - Defaults to SQLite local file if blank)
   # POSTGRES_URL=postgres://user:password@host:port/database
   ```

4. **Launch Server**:
   For development or production, run:
   ```bash
   npm start
   ```
   *The application will initialize at [http://localhost:3000](http://localhost:3000)*.

---

## 📊 Database Schema Overview

The database uses 7 tables to manage authentication, groups, and multi-currency consensus splits:
- **`users`**: Manages emails, credential hashes, and profiles.
- **`groups`**: Contains group descriptions and records the creator name/ID.
- **`group_members`**: Records timelines of users joining or leaving the group.
- **`expenses`**: Tracks splits, categories, status, and conversion rates.
- **`expense_splits`**: Computes specific participant share weights in INR.
- **`group_invitations`**: Stores join invitations sent to prospective members.
- **`expense_approvals`**: Tracks approvals for manual splits.

> [!TIP]
> For detailed SQLite and PostgreSQL table definitions, DDL code blocks, and the full CSV anomaly log analysis, refer to [SCOPE.md](file:///c:/Users/91870/Downloads/HisaabKitaab/SCOPE.md).

---

## 🤝 Contributing

Contributions are welcome! Please feel free to open a Pull Request or report bugs via issues.

---

## 📄 License
Distributed under the MIT License. See `LICENSE` for more information.
