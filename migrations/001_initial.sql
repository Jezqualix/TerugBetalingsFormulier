-- Run this against your MS SQL Server database before starting the app.

CREATE TABLE submissions (
  id                  INT IDENTITY(1,1)  PRIMARY KEY,
  aanvraagnummer      NVARCHAR(100)      NULL,
  naam_aanvrager      NVARCHAR(255)      NOT NULL,
  email_aanvrager     NVARCHAR(255)      NOT NULL,
  type_betaling       NVARCHAR(50)       NOT NULL,
  naam_terugstorting  NVARCHAR(255)      NOT NULL,
  iban                NVARCHAR(34)       NULL,
  omschrijving        NVARCHAR(MAX)      NULL,
  status              NVARCHAR(50)       NOT NULL CONSTRAINT DF_submissions_status   DEFAULT 'nieuw',
  taal                NVARCHAR(5)        NOT NULL CONSTRAINT DF_submissions_taal     DEFAULT 'nl',
  created_at          DATETIME2          NOT NULL CONSTRAINT DF_submissions_created  DEFAULT GETDATE()
);

CREATE TABLE uploads (
  id              INT IDENTITY(1,1)  PRIMARY KEY,
  submission_id   INT                NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  original_name   NVARCHAR(255)      NOT NULL,
  stored_name     NVARCHAR(255)      NOT NULL,
  mime_type       NVARCHAR(100)      NOT NULL,
  size_bytes      INT                NOT NULL,
  created_at      DATETIME2          NOT NULL CONSTRAINT DF_uploads_created DEFAULT GETDATE()
);
