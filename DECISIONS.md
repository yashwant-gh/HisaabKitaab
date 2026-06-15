# HisaabKitaab — Architectural & Design Decisions Log

This document serves as the official record of significant design and technical decisions made during the development of the HisaabKitaab application, documenting the options considered and the rationale behind each choice.

---

## 1. Database Portability (Dual-Engine Architecture)
- **Context**: The app needs to support simple local development and easy cloud hosting.
- **Options Considered**:
  1. *SQLite only*: Very fast and zero-config for local development, but does not scale well in serverless or highly concurrent cloud environments.
  2. *PostgreSQL only*: Production-ready and highly scalable, but requires every developer to install and maintain a local Postgres instance.
  3. *Dual SQLite & PostgreSQL Engine (Chosen)*: A abstraction layer implemented in `database.js` that checks for a `POSTGRES_URL` environment variable. If present, it initiates a Postgres pool; otherwise, it falls back to a local SQLite database (`hisaab.db`).
- **Rationale**: This gives the best of both worlds. It enables a "plug-and-play" local development environment while maintaining full production compatibility with deployment platforms (like Vercel, Heroku, or AWS) using PostgreSQL.

## 2. API Security & Access Control Validation
- **Context**: Ensuring users cannot view or modify other users' sensitive transactional histories.
- **Options Considered**:
  1. *Frontend Validation*: Relying on UI-level filtering to restrict access. (High vulnerability to API scanning/URL manipulation).
  2. *Strict JWT Payload Ownership Checks (Chosen)*: Validating the JWT token payload against the requested `user_name` or `group_id` parameter directly on the server for all database queries.
- **Rationale**: Frontend validation is insecure. Implementing backend parameter matching ensures that even if a user manually changes route queries in the address bar or calls endpoints directly, the API blocks access unless the authenticated token shows they are a member of the requested resource.

## 3. Group Administration Model (Creator Privileges)
- **Context**: Setting rules for member management inside shared flats or trip groups.
- **Options Considered**:
  1. *Flat Access*: Allow any group member to invite or remove other members. (High risk of user conflicts or accidental evictions).
  2. *Creator-Only Restrictions (Chosen)*: Adding a `created_by` field to groups and restricting member deletions to only the creator of the group.
- **Rationale**: Keeps group membership lists stable. It prevents disgruntled members from maliciously evicting other members and designates the group creator as the sole administrator of the list.

## 4. CSV Import Resolution (Interactive Wizard)
- **Context**: Handling inconsistent CSV spreadsheet exports containing duplicates, invalid currency splits, and mismatched dates.
- **Options Considered**:
  1. *Silent Failures or Auto-Corrects*: Silently dropping duplicates or using default assumptions for date/currency anomalies.
  2. *Interactive Step-by-Step Cleanup Wizard (Chosen)*: Detecting anomalies on upload and displaying a cleanup wizard to the user to choose resolution options before writing clean rows to the database.
- **Rationale**: Financial applications require absolute accuracy. Auto-correcting or silently dropping data can distort balances without the user's knowledge. The wizard allows users to explicitly specify how to resolve issues (e.g. which duplicate to keep, how to normalize splits) and outputs an `import_report.md` log.

## 5. Manual Expense Approval Flow
- **Context**: Logging manual entries on behalf of multiple participants.
- **Options Considered**:
  1. *Trust-Based Instant Logging*: Allowing any member to log a manual split that immediately adjusts group balances. (High risk of human error or unauthorized charges).
  2. *Consensus-Based Approval Flow (Chosen)*: Manual expenses start as `pending` and trigger in-app/email approval notifications. The expense only becomes active once all participants approve.
  - *Optimization*: The user who submits the manual entry is auto-approved, preventing redundant notifications.
- **Rationale**: The consensus flow prevents single-user errors or fraudulent logging. Auto-approving the submitter keeps the experience smooth, preventing unnecessary self-approvals.

## 6. Multi-Currency Conversion (Historical Rates)
- **Context**: Splitting expenses paid in non-INR currencies (USD, EUR, GBP) months in the past.
- **Options Considered**:
  1. *Current Rates*: Convert using the live conversion rates on the day the expense is logged. (Inaccurate due to currency exchange rate fluctuations).
  2. *Transaction-Date Historical Rates (Chosen)*: Fetching exchange rates matching the exact date of the transaction from the Frankfurter API, falling back to static historical values.
- **Rationale**: Financial accuracy. Converting an expense paid 8 months ago using today's exchange rates introduces substantial variance. Utilizing historical rates ensures splits reflect the actual value of the money at the time of purchase.

## 7. Privacy-Oriented Balance Views
- **Context**: Presenting who owes whom to group members.
- **Options Considered**:
  1. *Global Ledger*: Displaying a table of all group members' balances and mutual debts to everyone. (Breaches privacy, as users can see other members' individual debt transactions).
  2. *Personalized Balance Sheet (Chosen)*: Displaying only details relevant to the logged-in user (who they owe and who owes them), displaying "Fully Settled" only when their personal net balance is 0.
- **Rationale**: Respects user privacy. Flatmates do not need to inspect the personal lending agreements of their peers.

## 8. Dashboard Analytics (User Spending Visualization)
- **Context**: Displaying monthly spend trends on the homepage.
- **Options Considered**:
  1. *Global Group Bar Chart*: A bar chart displaying overall group spending, which looked generic and cluttered.
  2. *Personalized Smooth Line Chart (Chosen)*: Changing the chart to a line chart displaying only the monthly expenses of the logged-in user.
- **Rationale**: A line chart is visually superior for observing trends over time. Restricting it to the individual user preserves privacy while delivering a highly relevant personal overview.
