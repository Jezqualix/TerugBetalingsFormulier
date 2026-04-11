-- Onkostennota expense items (stored as JSON array) and ProPlanner checkbox.
-- Run this against your MS SQL Server database.

ALTER TABLE submissions ADD onkosten_items          NVARCHAR(MAX)  NULL;
ALTER TABLE submissions ADD proplanner_aangevraagd  BIT            NOT NULL CONSTRAINT DF_submissions_proplanner DEFAULT 0;
