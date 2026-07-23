function adminApp() {
  return {
    authenticated: false,
    tokenInput: '',
    token: '',
    loginError: false,
    loggingIn: false,
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
      const saved = localStorage.getItem('dockx_admin_token');
      if (saved) {
        this.token = saved;
        this.authenticated = true;
        this.$nextTick(() => this.loadSubmissions());
      }
    },

    async login() {
      this.loginError = false;
      this.loggingIn = true;
      try {
        const res = await fetch('/api/submissions?pageSize=1', {
          headers: { 'Authorization': `Bearer ${this.tokenInput}` },
        });
        if (res.ok) {
          this.token = this.tokenInput;
          localStorage.setItem('dockx_admin_token', this.token);
          this.authenticated = true;
          this.tokenInput = '';
          this.$nextTick(() => this.loadSubmissions());
        } else {
          this.loginError = true;
        }
      } catch (e) {
        this.loginError = true;
      } finally {
        this.loggingIn = false;
      }
    },

    logout() {
      localStorage.removeItem('dockx_admin_token');
      this.token = '';
      this.tokenInput = '';
      this.authenticated = false;
      this.rows = [];
      this.total = 0;
    },

    async loadSubmissions() {
      this.loading = true;
      const p = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
      if (this.filters.from)   p.set('from', this.filters.from);
      if (this.filters.to)     p.set('to', this.filters.to);
      if (this.filters.status) p.set('status', this.filters.status);

      try {
        const res = await fetch(`/api/submissions?${p}`, {
          headers: { 'Authorization': `Bearer ${this.token}` },
        });
        if (res.status === 401) { this.logout(); return; }
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
      const newStatus = row.status;
      try {
        const res = await fetch(`/api/submissions/${row.id}/status`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: newStatus }),
        });
        if (res.status === 401) { this.logout(); return; }
        if (!res.ok) {
          alert('Status wijzigen mislukt');
          this.loadSubmissions();
        }
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
        const res = await fetch(`/api/submissions/${row.id}/uploads`, {
          headers: { 'Authorization': `Bearer ${this.token}` },
        });
        if (res.status === 401) { this.logout(); return; }
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
        const res = await fetch(`/api/uploads/${encodeURIComponent(u.stored_name)}`, {
          headers: { 'Authorization': `Bearer ${this.token}` },
        });
        if (res.status === 401) { this.logout(); return; }
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
        const res = await fetch(`/api/export?${p}`, {
          headers: { 'Authorization': `Bearer ${this.token}` },
        });
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
