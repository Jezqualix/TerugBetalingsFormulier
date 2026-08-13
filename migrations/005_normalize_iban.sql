-- Normalises existing IBANs to the ISO 13616 electronic format: no separators,
-- upper case. Rows were stored both ways ("BE68 5390 0754 7034" next to
-- "BE07789589900666") because the form only stripped spaces for its mod-97 check
-- and then submitted the raw input. The app now normalises on write
-- (src/routes/submissions.js), so this file is the one-off cleanup of what is
-- already in the table.
--
-- Re-running is safe: rows that are already canonical do not match the WHERE.
--
--   sqlcmd -S vw-sql-2.dockx.be -d DockxDB -U AI_RW -P '<db pw>' -i 005_normalize_iban.sql

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- CROSS APPLY (VALUES ...) so the cleaning expression is written once and can be
-- used in both SET and WHERE. Strips space, tab, CR, LF and the non-breaking space
-- that pastes out of Word and Excel -- NCHAR(160) matters, LTRIM/RTRIM and N' '
-- leave it behind.
UPDATE s
   SET s.iban = NULLIF(c.iban_clean, N'')
  FROM tbf.submissions AS s
 CROSS APPLY (VALUES (
        UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            s.iban, N' ', N''), NCHAR(9), N''), NCHAR(13), N''), NCHAR(10), N''), NCHAR(160), N''))
      )) AS c(iban_clean)
 WHERE s.iban IS NOT NULL
   -- BIN2 collation: the database default is case-insensitive, so without it
   -- 'be68...' = 'BE68...' and a row needing only an upper-case fix is skipped.
   AND s.iban <> c.iban_clean COLLATE Latin1_General_BIN2;

PRINT CONCAT(@@ROWCOUNT, ' iban value(s) normalized');
GO
