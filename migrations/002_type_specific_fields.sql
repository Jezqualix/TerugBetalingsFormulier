-- Add type-specific fields for the 5 payment types.
-- Run this against your MS SQL Server database.

ALTER TABLE submissions ADD reden_urgentie              NVARCHAR(MAX)  NULL;
ALTER TABLE submissions ADD contract                    NVARCHAR(MAX)  NULL;
ALTER TABLE submissions ADD klant                       NVARCHAR(MAX)  NULL;
ALTER TABLE submissions ADD referentie_boete            NVARCHAR(255)  NULL;
ALTER TABLE submissions ADD vervaldatum_boete           DATE           NULL;
ALTER TABLE submissions ADD gedetailleerde_omschrijving NVARCHAR(MAX)  NULL;
