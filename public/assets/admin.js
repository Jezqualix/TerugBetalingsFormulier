function adminApp() {
  return {
    denied: false,
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
    // 401 = Easy Auth session gone -> reload so the platform redirects to login.
    // 403 = authenticated but not in the Admin role -> show the denied message.
    async apiFetch(url, opts) {
      const res = await fetch(url, opts);
      if (res.status === 401) { location.reload(); return null; }
      if (res.status === 403) { this.denied = true; return null; }
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

    fmtDate(dt) {
      return new Date(dt).toLocaleString('nl-BE', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    },
  };
}
