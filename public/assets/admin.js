// The table has eleven columns and every cell is nowrap, so on anything narrower
// than a wide desktop it scrolled sideways. Columns can now be switched off; the
// choice is per browser (localStorage), not per user account, which keeps it a
// pure view preference with no API or migration behind it.
const ADMIN_COLUMNS = [
  { key: 'id',                 label: 'ID' },
  { key: 'created_at',         label: 'Datum' },
  { key: 'naam_aanvrager',     label: 'Naam aanvrager' },
  { key: 'email_aanvrager',    label: 'E-mail' },
  { key: 'type_betaling',      label: 'Type betaling' },
  { key: 'naam_terugstorting', label: 'Naam begunstigde' },
  { key: 'iban',               label: 'IBAN' },
  { key: 'omschrijving',       label: 'Omschrijving' },
  { key: 'status',             label: 'Status' },
  { key: 'taal',               label: 'Taal' },
  { key: 'uploads',            label: 'Bijlagen' },
];
// Off on first visit: e-mail follows from the name, and language is rarely acted on.
const HIDDEN_BY_DEFAULT = ['email_aanvrager', 'taal'];
const COLS_KEY = 'tbf.adminColumns';

function defaultCols() {
  const cols = {};
  for (const c of ADMIN_COLUMNS) cols[c.key] = !HIDDEN_BY_DEFAULT.includes(c.key);
  return cols;
}

function loadCols() {
  const cols = defaultCols();
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_KEY) || '{}');
    // Only keys that still exist, so a stale entry from an older column set can
    // never hide a column that has no checkbox left to switch it back on.
    for (const c of ADMIN_COLUMNS) {
      if (typeof saved[c.key] === 'boolean') cols[c.key] = saved[c.key];
    }
  } catch (e) {
    // Corrupt entry — fall back to the defaults rather than showing an empty table.
  }
  return cols;
}

function adminApp() {
  return {
    denied: false,
    columns: ADMIN_COLUMNS,
    cols: loadCols(),
    colPickerOpen: false,
    rows: [],
    total: 0,
    page: 1,
    pageSize: 20,
    loading: false,
    filters: { from: '', to: '', status: '' },
    uploadsFor: null,
    uploads: [],
    uploadsLoading: false,

    init() {
      this.loadSubmissions();
    },

    // Same-origin fetch: the Easy Auth session cookie is sent automatically.
    // 401 = Easy Auth session gone -> reload ONCE so the platform redirects to
    //       login. Guard against an infinite reload loop when the reload does
    //       not fix the 401 (e.g. running locally with no Easy Auth in front):
    //       reload at most once, then show the denied message instead.
    // 403 = authenticated but not in the Admin role -> show the denied message.
    async apiFetch(url, opts) {
      const res = await fetch(url, opts);
      if (res.status === 401) {
        if (sessionStorage.getItem('authReloaded')) { this.denied = true; return null; }
        sessionStorage.setItem('authReloaded', '1');
        location.reload();
        return null;
      }
      if (res.status === 403) { this.denied = true; return null; }
      sessionStorage.removeItem('authReloaded'); // successful auth -> reset guard
      return res;
    },

    async loadSubmissions() {
      this.loading = true;
      const p = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
      if (this.filters.from)   p.set('from', this.filters.from);
      if (this.filters.to)     p.set('to', this.filters.to);
      if (this.filters.status) p.set('status', this.filters.status);
      try {
        const res = await this.apiFetch(`/api/submissions?${p}`);
        if (!res) return;
        const data = await res.json();
        this.rows = data.rows;
        this.total = data.total;
      } catch (e) {
        console.error('Load failed', e);
      } finally {
        this.loading = false;
      }
    },

    prevPage() { if (this.page > 1) { this.page--; this.loadSubmissions(); } },
    nextPage() { this.page++; this.loadSubmissions(); },

    async updateStatus(row) {
      try {
        const res = await this.apiFetch(`/api/submissions/${row.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: row.status }),
        });
        if (!res) return;
        if (!res.ok) { alert('Status wijzigen mislukt'); this.loadSubmissions(); }
      } catch (e) {
        alert('Status wijzigen mislukt');
        this.loadSubmissions();
      }
    },

    async showUploads(row) {
      if (this.uploadsFor && this.uploadsFor.id === row.id) { this.closeUploads(); return; }
      this.uploadsFor = row;
      this.uploads = [];
      this.uploadsLoading = true;
      try {
        const res = await this.apiFetch(`/api/submissions/${row.id}/uploads`);
        if (!res) { this.uploadsFor = null; return; }
        if (!res.ok) { alert('Bijlagen laden mislukt'); this.uploadsFor = null; return; }
        const data = await res.json();
        this.uploads = data.uploads;
      } catch (e) {
        alert('Bijlagen laden mislukt');
        this.uploadsFor = null;
      } finally {
        this.uploadsLoading = false;
      }
    },

    closeUploads() {
      this.uploadsFor = null;
      this.uploads = [];
    },

    async downloadUpload(u) {
      try {
        const res = await this.apiFetch(`/api/uploads/${encodeURIComponent(u.stored_name)}`);
        if (!res) return;
        if (!res.ok) { alert('Download mislukt'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = u.original_name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('Download mislukt');
      }
    },

    fmtSize(bytes) {
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
      return `${bytes} B`;
    },

    async exportData(format) {
      const p = new URLSearchParams({ format });
      if (this.filters.from)   p.set('from', this.filters.from);
      if (this.filters.to)     p.set('to', this.filters.to);
      if (this.filters.status) p.set('status', this.filters.status);
      try {
        const res = await this.apiFetch(`/api/export?${p}`);
        if (!res) return;
        if (!res.ok) { alert('Export mislukt'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `submissions.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('Export mislukt');
      }
    },

    toggleCol(key) {
      this.cols[key] = !this.cols[key];
      this.saveCols();
    },

    resetCols() {
      this.cols = defaultCols();
      this.saveCols();
    },

    saveCols() {
      try {
        localStorage.setItem(COLS_KEY, JSON.stringify(this.cols));
      } catch (e) {
        // Private mode / full quota: the choice just does not survive a reload.
      }
    },

    // Drives the colspan of the empty-state row, so it keeps spanning the table
    // when columns are switched off.
    get visibleColCount() {
      return Object.values(this.cols).filter(Boolean).length || 1;
    },

    // Date only — the time lives in the cell's title attribute. The column used to
    // be the widest in the table purely because of "00:00" that nobody sorts on.
    fmtDate(dt) {
      return new Date(dt).toLocaleDateString('nl-BE', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
    },

    fmtDateTime(dt) {
      return new Date(dt).toLocaleString('nl-BE', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    },
  };
}
