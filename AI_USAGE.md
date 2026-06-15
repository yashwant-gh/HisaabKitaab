# HisaabKitaab — AI Usage Report

This document outlines the role of Artificial Intelligence in the development of the HisaabKitaab application.

---

## 1. AI Tools Used & Extent of Usage
- **AI Tool**: **Antigravity** (Google DeepMind Advanced Agentic Coding Assistant) was the **single** AI tool consulted during this project.
- **Extent of Usage**: Very minimal. The codebase was primarily authored and structured manually. Antigravity was used sparingly for targeted design reviews, quick database queries, and regex extraction debugging.

---

## 2. Key Prompts Utilized
- *"Review database.js to ensure both SQLite and PostgreSQL schemas support auto-incrementing ID syntaxes concurrently."*
- *"Provide a regex template to identify common settlement keywords (e.g. 'paid back', 'deposit share') from arbitrary transaction descriptions."*
- *"Debug why the line chart canvas element flickers when updating the month view filter."*

---

## 3. Concrete Cases of AI Errors, Detection, & Resolutions

### Case 1: Silent SQLite Migration Crashes
- **What the AI produced wrong**: The AI suggested running database migrations on startup using standard `ALTER TABLE` DDL queries. However, it did not account for SQLite throwing an error if the column already existed (e.g., `SQLITE_ERROR: duplicate column name: created_by`), which crashed the server on subsequent startups.
- **How we caught it**: When starting up the backend server (`npm start`), the console logs showed server crashes with SQLite error codes.
- **How we fixed it**: Wrapped each structural modification query (e.g., adding `created_by`, `category`, `status`) inside independent `try...catch` blocks to gracefully log and ignore duplicate column exceptions.

### Case 2: Hardcoded Settlement Labels in Import Wizard
- **What the AI produced wrong**: The AI generated a suggestion template for settlement options that used a static string: `"Convert to a direct Settlement (Rohan paid Aisha)"`. When Sam or Priya imported a settlement, the option text still referenced Rohan.
- **How we caught it**: Inspected the UI during the CSV import test wizard run. The card for `"Sam deposit share"` mistakenly read `"Convert to a direct Settlement (Rohan paid Aisha)"`.
- **How we fixed it**: Replaced the static string with a dynamic template literal in `public/app.js`: `` `Convert to a direct Settlement (${row.paidBy} paid ${row.splitWith[0]})` ``.

### Case 3: Canvas Redraw/Flickering CPU Spikes
- **What the AI produced wrong**: The AI provided an implementation for the personal line chart that instantiated a new chart object on every dashboard refresh loop. It did not clean up the old chart context.
- **How we caught it**: In testing, changing months caused the chart to flicker rapidly, and the browser tab eventually crashed due to high CPU usage from multiple overlapping chart instances.
- **How we fixed it**: Tracked the active chart instance globally as a variable (`let currentChart = null;`). Before instantiating a new chart, we called `if (currentChart) { currentChart.destroy(); }` to free memory and prevent canvas collisions.
