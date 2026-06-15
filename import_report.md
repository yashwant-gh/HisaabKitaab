# HisaabKitaab CSV Import Report

- **Generated On**: 6/15/2026, 6:07:00 AM
- **Target Group ID**: 1
- **Total Expenses Successfully Cleaned & Imported**: 32

## Anomalies Resolved

| Anomaly ID | Type | Description | Action Taken |
| :--- | :--- | :--- | :--- |
| `duplicate_3` | **duplicate** | Duplicate entries detected on 08-02-2026 for "Dinner at Marina Bites" (3200 INR) by Dev. | `Keep first, discard duplicates` |
| `conflict_22` | **conflict** | Conflicting records for similar event on 11-03-2026: "Dinner at Thalassa" (logged by Aisha for 2400) vs "Thalassa dinner" (logged by Rohan for 2450). | `Keep Aisha's log` |
| `missing_payer_11` | **missing_payer** | Expense "House cleaning supplies" of 780 has no payer designated. | `Set payer to Aisha` |
| `settlement_detected_12` | **settlement_detected** | "Rohan paid Aisha back" looks like a settlement/direct payment from Rohan to Aisha instead of a split expense. | `Convert to direct settlement` |
| `invalid_percentage_13` | **invalid_percentage** | Percentage split for "Pizza Friday" sums to 110% instead of 100%. | `Normalize percentages to 100%` |
| `missing_currency_26` | **missing_currency** | Expense "Groceries DMart" has no currency code specified. | `Set currency to INR` |
| `invalid_percentage_30` | **invalid_percentage** | Percentage split for "Weekend brunch" sums to 110% instead of 100%. | `Normalize percentages to 100%` |
| `ambiguous_date_32` | **ambiguous_date** | Date format for "Deep cleaning service" (04-05-2026) is ambiguous. Notes ask if it's April 5 or May 4. | `Set date to 2026-04-05` |
| `membership_violation_meera_34` | **membership_violation** | Meera is charged for "Groceries BigBasket" on 02-04-2026, but she moved out on March 31, 2026. | `Remove Meera from split` |
| `settlement_detected_36` | **settlement_detected** | "Sam deposit share" looks like a settlement/direct payment from Sam to Aisha instead of a split expense. | `Convert to direct settlement` |
| `missing_member_Meera` | **missing_member** | User "Meera" is referenced in the CSV but is not a member of the active group. | `Automatically add user to group` |
