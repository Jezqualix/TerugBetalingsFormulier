// Single source of truth for the field set, so startNew() clears exactly what
// submit() sends — a field added here needs no second edit to be reset.
function emptyForm() {
  return {
    aanvraagnummer: '',
    naam_aanvrager: '',
    email_aanvrager: '',
    type_betaling: '',
    naam_terugstorting: '',
    iban: '',
    omschrijving: '',
    reden_urgentie: '',
    contract: '',
    klant: '',
    referentie_boete: '',
    vervaldatum_boete: '',
    gedetailleerde_omschrijving: '',
    proplanner_aangevraagd: false,
  };
}

function formApp() {
  return {
    lang: 'nl',
    isAdmin: false,
    form: emptyForm(),
    onkostenItems: [{ datum: '', omschrijving: '', bedrag: '' }],
    files: [],
    fileErrors: [],
    errors: {},
    submitting: false,
    submitted: false,
    submitError: false,
    isDragging: false,
    csrfToken: '',

    t(key) {
      const parts = key.split('.');
      let val = window.i18n[this.lang];
      for (const p of parts) val = val?.[p];
      return val !== undefined ? val : key;
    },

    async init() {
      try {
        const res = await fetch('/api/csrf-token');
        const data = await res.json();
        this.csrfToken = data.token;
      } catch (e) {
        console.error('Could not fetch CSRF token');
      }
      await this.prefillFromLogin();
    },

    // Pre-fill the requester fields from the Entra login (Easy Auth). Best-effort:
    // the fields stay editable, so a failure or an empty response is not an error.
    // Also picks up isAdmin, which only decides whether the /admin link is shown.
    async prefillFromLogin() {
      try {
        const res = await fetch('/api/me');
        if (!res.ok) return;
        const me = await res.json();
        if (me.name) this.form.naam_aanvrager = me.name;
        if (me.email) this.form.email_aanvrager = me.email;
        this.isAdmin = !!me.isAdmin;
      } catch (e) {
        // No Easy Auth (local dev) or network hiccup — leave the fields empty.
      }
    },

    // Back to an empty form after a successful submit. The CSRF token stays valid
    // (csrf-csrf does not rotate on use), so only the state is cleared; the requester
    // fields get their Entra pre-fill back.
    async startNew() {
      this.form = emptyForm();
      this.onkostenItems = [{ datum: '', omschrijving: '', bedrag: '' }];
      this.files = [];
      this.fileErrors = [];
      this.errors = {};
      this.submitError = false;
      this.submitted = false;
      await this.prefillFromLogin();
    },

    // Rewrite the field to the ISO 13616 electronic format (no spaces, upper case)
    // — the shape it is stored in. The server normalises as well; doing it here too
    // keeps what the user sees identical to what lands in the database.
    normalizeIban() {
      this.form.iban = this.form.iban.replace(/\s/g, '').toUpperCase();
    },

    // IBAN validation (ISO 13616)
    validateIban(iban) {
      if (!iban) return true; // optional field
      const cleaned = iban.replace(/\s/g, '').toUpperCase();
      if (cleaned.length < 15 || cleaned.length > 34) return false;
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleaned)) return false;
      const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
      const digits = rearranged.replace(/[A-Z]/g, ch => (ch.charCodeAt(0) - 55).toString());
      let remainder = '';
      for (const ch of digits) {
        remainder += ch;
        remainder = (parseInt(remainder, 10) % 97).toString();
      }
      return parseInt(remainder, 10) === 1;
    },

    // Onkosten items
    addOnkostenItem() {
      this.onkostenItems.push({ datum: '', omschrijving: '', bedrag: '' });
    },

    removeOnkostenItem(i) {
      this.onkostenItems.splice(i, 1);
      if (this.onkostenItems.length === 0) this.addOnkostenItem();
    },

    // Files
    handleFileChange(event) {
      this.addFiles(Array.from(event.target.files));
      event.target.value = '';
    },

    handleDrop(event) {
      this.isDragging = false;
      this.addFiles(Array.from(event.dataTransfer.files));
    },

    addFiles(newFiles) {
      this.fileErrors = [];
      const MAX = 2 * 1024 * 1024;
      const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.docx', '.xlsx', '.zip']);

      for (const file of newFiles) {
        if (this.files.length >= 10) {
          this.fileErrors.push(this.t('maxFiles'));
          break;
        }
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!ALLOWED.has(ext)) {
          this.fileErrors.push(`${file.name}: ${this.t('fileTypeNotAllowed')}`);
          continue;
        }
        if (file.size > MAX) {
          this.fileErrors.push(`${file.name}: ${this.t('fileTooLarge')}`);
          continue;
        }
        this.files.push(file);
      }
    },

    removeFile(i) { this.files.splice(i, 1); },

    formatSize(b) {
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
      return (b / 1024 / 1024).toFixed(1) + ' MB';
    },

    validate() {
      this.errors = {};
      if (!this.form.naam_aanvrager.trim()) this.errors.naam_aanvrager = true;
      if (!this.form.email_aanvrager.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.form.email_aanvrager)) {
        this.errors.email_aanvrager = this.t('invalidEmail');
      }
      if (!this.form.type_betaling) this.errors.type_betaling = true;
      if (!this.form.naam_terugstorting.trim()) this.errors.naam_terugstorting = true;
      if (this.form.iban && !this.validateIban(this.form.iban)) this.errors.iban = true;

      // Type-specific validation
      if (this.form.type_betaling === 'onkostennota') {
        const hasInvalid = this.onkostenItems.some(
          it => !it.datum || !it.omschrijving.trim() || !it.bedrag.trim()
        );
        if (hasInvalid) this.errors.onkosten_items = true;
      }
      if (this.form.type_betaling === 'dringend' && !this.form.reden_urgentie.trim()) this.errors.reden_urgentie = true;
      if (this.form.type_betaling === 'boete') {
        if (!this.form.referentie_boete.trim()) this.errors.referentie_boete = true;
        if (!this.form.vervaldatum_boete) this.errors.vervaldatum_boete = true;
      }
      if (this.form.type_betaling === 'andere' && !this.form.gedetailleerde_omschrijving.trim()) this.errors.gedetailleerde_omschrijving = true;

      return Object.keys(this.errors).length === 0;
    },

    async submit() {
      if (!this.validate()) return;
      this.normalizeIban();
      this.submitting = true;
      this.submitError = false;

      const fd = new FormData();
      for (const [k, v] of Object.entries(this.form)) fd.append(k, v);
      fd.append('taal', this.lang);

      // Onkosten items as JSON
      if (this.form.type_betaling === 'onkostennota') {
        const items = this.onkostenItems.map(it => ({
          datum: it.datum,
          omschrijving: it.omschrijving.trim(),
          bedrag: it.bedrag.trim(),
        }));
        fd.append('onkosten_items', JSON.stringify(items));
      }

      for (const file of this.files) fd.append('bijlagen', file);

      try {
        const res = await fetch('/api/submissions', {
          method: 'POST',
          headers: { 'x-csrf-token': this.csrfToken },
          body: fd,
        });
        if (res.ok) {
          this.submitted = true;
        } else {
          const data = await res.json().catch(() => ({}));
          if (data.errors) {
            this.errors = data.errors;
          } else {
            this.submitError = true;
          }
        }
      } catch (e) {
        this.submitError = true;
      } finally {
        this.submitting = false;
      }
    },
  };
}
