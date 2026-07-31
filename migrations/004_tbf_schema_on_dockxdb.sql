-- Creates the application schema from scratch on DockxDB (vw-sql-2), replacing
-- the dbo tables on the retiring Azure SQL server dockxazsql1.
--
-- This is 001, 002 and 003 folded into one CREATE TABLE per table: there is no
-- data to carry over, so replaying three migrations to reach the same shape
-- would only invite drift. Those three stay in the repo as the history of the
-- old database; this file is the definition of the new one.
--
-- Run against DockxDB. Re-running is safe -- every step checks first, and no
-- step drops anything.
--
--   sqlcmd -S vw-sql-2.dockx.be -d DockxDB -i 004_tbf_schema_on_dockxdb.sql

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF SCHEMA_ID('tbf') IS NULL
BEGIN
    EXEC('CREATE SCHEMA tbf AUTHORIZATION dbo;');
    PRINT 'schema tbf created';
END
ELSE
    PRINT 'schema tbf already present';
GO

IF OBJECT_ID('tbf.submissions', 'U') IS NULL
BEGIN
    CREATE TABLE tbf.submissions (
        id                          INT IDENTITY(1,1)  NOT NULL
            CONSTRAINT PK_tbf_submissions PRIMARY KEY,
        aanvraagnummer              NVARCHAR(100)      NULL,
        naam_aanvrager              NVARCHAR(255)      NOT NULL,
        email_aanvrager             NVARCHAR(255)      NOT NULL,
        type_betaling               NVARCHAR(50)       NOT NULL,
        naam_terugstorting          NVARCHAR(255)      NOT NULL,
        iban                        NVARCHAR(34)       NULL,
        omschrijving                NVARCHAR(MAX)      NULL,
        status                      NVARCHAR(50)       NOT NULL
            CONSTRAINT DF_tbf_submissions_status DEFAULT 'nieuw',
        taal                        NVARCHAR(5)        NOT NULL
            CONSTRAINT DF_tbf_submissions_taal DEFAULT 'nl',
        created_at                  DATETIME2          NOT NULL
            CONSTRAINT DF_tbf_submissions_created DEFAULT GETDATE(),

        -- 002: fields that only apply to certain payment types
        reden_urgentie              NVARCHAR(MAX)      NULL,
        contract                    NVARCHAR(MAX)      NULL,
        klant                       NVARCHAR(MAX)      NULL,
        referentie_boete            NVARCHAR(255)      NULL,
        vervaldatum_boete           DATE               NULL,
        gedetailleerde_omschrijving NVARCHAR(MAX)      NULL,

        -- 003: expense lines and the ProPlanner flag
        onkosten_items              NVARCHAR(MAX)      NULL,
        proplanner_aangevraagd      BIT                NOT NULL
            CONSTRAINT DF_tbf_submissions_proplanner DEFAULT 0
    );
    PRINT 'table tbf.submissions created';
END
ELSE
    PRINT 'table tbf.submissions already present';
GO

IF OBJECT_ID('tbf.uploads', 'U') IS NULL
BEGIN
    CREATE TABLE tbf.uploads (
        id            INT IDENTITY(1,1)  NOT NULL
            CONSTRAINT PK_tbf_uploads PRIMARY KEY,
        submission_id INT                NOT NULL
            CONSTRAINT FK_tbf_uploads_submission
                REFERENCES tbf.submissions(id) ON DELETE CASCADE,
        original_name NVARCHAR(255)      NOT NULL,
        stored_name   NVARCHAR(255)      NOT NULL,
        mime_type     NVARCHAR(100)      NOT NULL,
        size_bytes    INT                NOT NULL,
        created_at    DATETIME2          NOT NULL
            CONSTRAINT DF_tbf_uploads_created DEFAULT GETDATE()
    );
    PRINT 'table tbf.uploads created';
END
ELSE
    PRINT 'table tbf.uploads already present';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_tbf_uploads_submission_id'
                 AND object_id = OBJECT_ID('tbf.uploads'))
BEGIN
    CREATE INDEX IX_tbf_uploads_submission_id ON tbf.uploads(submission_id);
    PRINT 'index IX_tbf_uploads_submission_id created';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_tbf_submissions_status'
                 AND object_id = OBJECT_ID('tbf.submissions'))
BEGIN
    CREATE INDEX IX_tbf_submissions_status ON tbf.submissions(status);
    PRINT 'index IX_tbf_submissions_status created';
END
GO

-- Grant the application login what it needs and nothing else. The app never
-- issues DDL, so schema ownership stays with dbo. Adjust the principal name if
-- the login differs.
--
--   CREATE LOGIN tbf_app WITH PASSWORD = '...';
--   CREATE USER  tbf_app FOR LOGIN tbf_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::tbf TO tbf_app;
GO
