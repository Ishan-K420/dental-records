// ==================== CONSTANTS ====================
const DB_NAME = 'DentaRecordDB';
const DB_VERSION = 2;
const RECORDS_STORE = 'records';
const PDFS_STORE = 'pdfs';
const MAX_PHOTOS = 10;
const MAX_IMAGE_WIDTH = 1400;
const IMAGE_QUALITY = 0.82;

// *** IMPORTANT: Replace with your own Google Cloud Client ID ***
// Get one free at: https://console.cloud.google.com
// 1. Create project → 2. Enable Drive API → 3. Create OAuth credentials
// 4. Add your GitHub Pages URL as authorized origin
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com';

// ==================== STATE ====================
let db = null;
let currentPhotos = [];
let currentRecordId = null;
let lightboxPhotos = [];
let lightboxIndex = 0;
let allRecords = [];
let allPdfs = [];
let currentFilter = 'all';
let renamingPdfId = null;
let deletingPdfId = null;
let pendingImportData = null;
let gdriveAccessToken = null;

// ==================== DATABASE ====================
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const database = e.target.result;

      if (!database.objectStoreNames.contains(RECORDS_STORE)) {
        const recordStore = database.createObjectStore(RECORDS_STORE, { keyPath: 'id', autoIncrement: true });
        recordStore.createIndex('patientName', 'patientName', { unique: false });
        recordStore.createIndex('treatmentDate', 'treatmentDate', { unique: false });
        recordStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!database.objectStoreNames.contains(PDFS_STORE)) {
        const pdfStore = database.createObjectStore(PDFS_STORE, { keyPath: 'id', autoIncrement: true });
        pdfStore.createIndex('name', 'name', { unique: false });
        pdfStore.createIndex('createdAt', 'createdAt', { unique: false });
        pdfStore.createIndex('recordId', 'recordId', { unique: false });
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

// --- Records CRUD ---
function addRecord(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, 'readwrite');
    const store = tx.objectStore(RECORDS_STORE);
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllRecords() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, 'readonly');
    const store = tx.objectStore(RECORDS_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getRecord(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, 'readonly');
    const store = tx.objectStore(RECORDS_STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteRecord(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, 'readwrite');
    const store = tx.objectStore(RECORDS_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// --- PDFs CRUD ---
function addPdf(pdfRecord) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDFS_STORE, 'readwrite');
    const store = tx.objectStore(PDFS_STORE);
    const req = store.add(pdfRecord);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllPdfs() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDFS_STORE, 'readonly');
    const store = tx.objectStore(PDFS_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getPdf(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDFS_STORE, 'readonly');
    const store = tx.objectStore(PDFS_STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function updatePdfName(id, newName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDFS_STORE, 'readwrite');
    const store = tx.objectStore(PDFS_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const pdf = getReq.result;
      if (!pdf) return reject(new Error('PDF not found'));
      pdf.name = newName;
      const putReq = store.put(pdf);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

function deletePdf(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDFS_STORE, 'readwrite');
    const store = tx.objectStore(PDFS_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function deletePdfsByRecordId(recordId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDFS_STORE, 'readwrite');
    const store = tx.objectStore(PDFS_STORE);
    const index = store.index('recordId');
    const req = index.openCursor(IDBKeyRange.only(recordId));
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ==================== IMAGE PROCESSING ====================
function resizeImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > MAX_IMAGE_WIDTH) {
          height = Math.round((height * MAX_IMAGE_WIDTH) / width);
          width = MAX_IMAGE_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ==================== NAVIGATION ====================
function navigate(viewName) {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.view === viewName);
  });

  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });

  const targetView = document.getElementById(`${viewName}-view`);
  if (targetView) targetView.classList.add('active');

  closeMobileSidebar();
  document.getElementById('main-content').scrollTo(0, 0);

  switch (viewName) {
    case 'dashboard': loadDashboard(); break;
    case 'records': loadRecords(); break;
    case 'new-record': setDefaultDate(); break;
    case 'pdfs': loadPdfs(); break;
    case 'backup': loadBackupView(); break;
  }
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
  try {
    allRecords = await getAllRecords();
    allRecords.sort((a, b) => b.createdAt - a.createdAt);
    allPdfs = await getAllPdfs();

    const now = new Date();
    document.getElementById('dashboard-date').textContent =
      now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const totalPatients = allRecords.length;
    const thisMonth = allRecords.filter(r => {
      const d = new Date(r.treatmentDate);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;

    animateCounter('stat-total', totalPatients);
    animateCounter('stat-month', thisMonth);
    animateCounter('stat-pdfs', allPdfs.length);

    const recentContainer = document.getElementById('recent-records');
    const emptyState = document.getElementById('dashboard-empty');
    const sectionHeader = document.querySelector('#dashboard-view .section-header');

    if (allRecords.length === 0) {
      recentContainer.style.display = 'none';
      sectionHeader.style.display = 'none';
      emptyState.style.display = 'block';
    } else {
      recentContainer.style.display = 'grid';
      sectionHeader.style.display = 'block';
      emptyState.style.display = 'none';
      recentContainer.innerHTML = allRecords.slice(0, 6).map(r => renderRecordCard(r)).join('');
      attachRecordCardListeners(recentContainer);
    }
  } catch (err) {
    console.error('Error loading dashboard:', err);
    showToast('Failed to load dashboard', 'error');
  }
}

function animateCounter(elementId, target) {
  const el = document.getElementById(elementId);
  const start = parseInt(el.textContent) || 0;
  if (start === target) { el.textContent = target; return; }
  const duration = 500;
  const startTime = performance.now();
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// ==================== RECORDS ====================
async function loadRecords() {
  try {
    allRecords = await getAllRecords();
    allRecords.sort((a, b) => b.createdAt - a.createdAt);
    renderRecordsList();
  } catch (err) {
    console.error('Error loading records:', err);
    showToast('Failed to load records', 'error');
  }
}

function renderRecordsList() {
  const searchTerm = document.getElementById('search-input').value.toLowerCase().trim();
  let filtered = allRecords;

  if (currentFilter !== 'all') {
    filtered = filtered.filter(r =>
      (r.treatmentType || r.diagnosis || '').toLowerCase().includes(currentFilter.toLowerCase())
    );
  }

  if (searchTerm) {
    filtered = filtered.filter(r =>
      r.patientName.toLowerCase().includes(searchTerm) ||
      (r.treatmentType || '').toLowerCase().includes(searchTerm) ||
      (r.chiefComplaint && r.chiefComplaint.toLowerCase().includes(searchTerm))
    );
  }

  document.getElementById('records-count-text').textContent =
    `${filtered.length} record${filtered.length !== 1 ? 's' : ''} found`;

  const listContainer = document.getElementById('records-list');
  const emptyState = document.getElementById('records-empty');

  if (filtered.length === 0) {
    listContainer.style.display = 'none';
    emptyState.style.display = 'block';
  } else {
    listContainer.style.display = 'grid';
    emptyState.style.display = 'none';
    listContainer.innerHTML = filtered.map(r => renderRecordCard(r)).join('');
    attachRecordCardListeners(listContainer);
  }
}

function renderRecordCard(record) {
  const dateFormatted = formatDate(record.treatmentDate);
  const photoCount = record.photos ? record.photos.length : 0;

  return `
    <div class="record-card" data-id="${record.id}">
      <div class="record-card-header">
        <span class="record-patient-name">${escapeHtml(record.patientName)}</span>
        <span class="record-badge">${escapeHtml(record.treatmentType || '')}</span>
      </div>
      <div class="record-details">
        <div class="record-detail-row">
          <span class="record-detail-icon">👤</span>
          <span>${record.age} yrs · ${record.gender}</span>
        </div>
        ${record.phone ? `<div class="record-detail-row">
          <span class="record-detail-icon">📞</span>
          <span>${escapeHtml(record.phone)}</span>
        </div>` : ''}
        ${record.toothArea ? `
        <div class="record-detail-row">
          <span class="record-detail-icon">🦷</span>
          <span>${escapeHtml(record.toothArea)}</span>
        </div>` : ''}
      </div>
      <div class="record-footer">
        <span class="record-date">📅 ${dateFormatted}</span>
        ${photoCount > 0 ? `<span class="record-photos-badge">📸 ${photoCount} photo${photoCount > 1 ? 's' : ''}</span>` : ''}
      </div>
    </div>
  `;
}

function attachRecordCardListeners(container) {
  container.querySelectorAll('.record-card').forEach(card => {
    card.addEventListener('click', () => {
      showRecordDetail(parseInt(card.dataset.id));
    });
  });
}

// ==================== RECORD DETAIL ====================
async function showRecordDetail(id) {
  try {
    const record = await getRecord(id);
    if (!record) { showToast('Record not found', 'error'); return; }

    currentRecordId = id;
    const container = document.getElementById('detail-content');
    const initials = getInitials(record.patientName);
    const dateFormatted = formatDate(record.treatmentDate);
    const createdFormatted = new Date(record.createdAt).toLocaleString('en-IN');

    let photosHtml = '';
    if (record.photos && record.photos.length > 0) {
      photosHtml = `
        <div class="detail-card">
          <div class="detail-section-title">📸 Photos (${record.photos.length})</div>
          <div class="detail-photos-grid">
            ${record.photos.map((photo, i) => `
              <div class="detail-photo" data-photo-index="${i}">
                <img src="${photo.data}" alt="Photo ${i + 1}" loading="lazy">
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="detail-card">
        <div class="detail-patient-header">
          <div class="detail-patient-avatar">${initials}</div>
          <div class="detail-patient-info">
            <h2>${escapeHtml(record.patientName)}</h2>
            <div class="detail-patient-meta">
              <span>${record.age} years · ${record.gender}</span>
              ${record.phone ? `<span>📞 ${escapeHtml(record.phone)}</span>` : ''}
              ${record.email ? `<span>📧 ${escapeHtml(record.email)}</span>` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="detail-card">
        <div class="detail-section-title">🩺 Diagnosis Details</div>
        <div class="detail-grid">
          <div class="detail-field">
            <span class="detail-field-label">Diagnosis</span>
            <span class="detail-field-value">${escapeHtml(record.treatmentType || '')}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field-label">Treatment Date</span>
            <span class="detail-field-value">${dateFormatted}</span>
          </div>
          ${record.toothArea ? `
          <div class="detail-field">
            <span class="detail-field-label">Tooth / Area</span>
            <span class="detail-field-value">${escapeHtml(record.toothArea)}</span>
          </div>` : ''}
          ${record.chiefComplaint ? `
          <div class="detail-field">
            <span class="detail-field-label">Chief Complaint</span>
            <span class="detail-field-value">${escapeHtml(record.chiefComplaint)}</span>
          </div>` : ''}
        </div>
        ${record.treatmentNotes ? `
        <div class="mt-16">
          <span class="detail-field-label">Treatment Notes</span>
          <div class="detail-notes mt-8">${escapeHtml(record.treatmentNotes)}</div>
        </div>` : ''}
      </div>

      ${photosHtml}

      <div style="text-align:right;margin-top:8px;">
        <span style="font-size:0.75rem;color:var(--text-muted);">Record created: ${createdFormatted}</span>
      </div>
    `;

    // Photo lightbox listeners
    if (record.photos && record.photos.length > 0) {
      lightboxPhotos = record.photos.map(p => p.data);
      container.querySelectorAll('.detail-photo').forEach(el => {
        el.addEventListener('click', () => {
          lightboxIndex = parseInt(el.dataset.photoIndex);
          openLightbox();
        });
      });
    }

    navigate('detail');
  } catch (err) {
    console.error('Error loading record detail:', err);
    showToast('Failed to load record', 'error');
  }
}

// ==================== FORM HANDLING ====================
function initForm() {
  const form = document.getElementById('patient-form');
  const uploadArea = document.getElementById('photo-upload-area');
  const photoInput = document.getElementById('photo-input');

  form.addEventListener('submit', handleFormSubmit);
  document.getElementById('form-reset-btn').addEventListener('click', resetForm);

  uploadArea.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', (e) => handlePhotoFiles(e.target.files));

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    handlePhotoFiles(e.dataTransfer.files);
  });

  setDefaultDate();
}

function setDefaultDate() {
  const dateInput = document.getElementById('treatment-date');
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
}

async function handlePhotoFiles(files) {
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (currentPhotos.length + imageFiles.length > MAX_PHOTOS) {
    showToast(`You can upload up to ${MAX_PHOTOS} photos only`, 'error');
    return;
  }

  for (const file of imageFiles) {
    if (currentPhotos.length >= MAX_PHOTOS) break;
    try {
      const data = await resizeImage(file);
      currentPhotos.push({ name: file.name, data });
    } catch (err) {
      console.error('Error processing image:', err);
    }
  }
  renderPhotoPreviews();
  document.getElementById('photo-input').value = '';
}

function renderPhotoPreviews() {
  const container = document.getElementById('photo-previews');
  const counter = document.getElementById('photo-count');
  counter.textContent = `${currentPhotos.length} / ${MAX_PHOTOS}`;

  container.innerHTML = currentPhotos.map((photo, i) => `
    <div class="photo-preview" data-index="${i}">
      <img src="${photo.data}" alt="${photo.name}">
      <button type="button" class="photo-remove" data-index="${i}" title="Remove">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.photo-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentPhotos.splice(parseInt(btn.dataset.index), 1);
      renderPhotoPreviews();
    });
  });

  container.querySelectorAll('.photo-preview').forEach(preview => {
    preview.addEventListener('click', (e) => {
      if (e.target.classList.contains('photo-remove')) return;
      lightboxPhotos = currentPhotos.map(p => p.data);
      lightboxIndex = parseInt(preview.dataset.index);
      openLightbox();
    });
  });
}

function validateForm() {
  let isValid = true;
  document.querySelectorAll('.form-error').forEach(el => { el.textContent = ''; el.classList.remove('visible'); });
  document.querySelectorAll('input.error, select.error').forEach(el => el.classList.remove('error'));

  const checks = [
    { id: 'patient-name', errorId: 'error-name', msg: 'Patient name is required', check: v => !v.trim() },
    { id: 'patient-age', errorId: 'error-age', msg: 'Enter a valid age (1-120)', check: v => !v || v < 1 || v > 120 },
    { id: 'patient-gender', errorId: 'error-gender', msg: 'Please select gender', check: v => !v },
    { id: 'treatment-type', errorId: 'error-treatment', msg: 'Please enter diagnosis', check: v => !v.trim() },
    { id: 'treatment-date', errorId: 'error-date', msg: 'Treatment date is required', check: v => !v },
  ];

  checks.forEach(({ id, errorId, msg, check }) => {
    const el = document.getElementById(id);
    if (check(el.value)) {
      showFieldError(errorId, msg, el);
      isValid = false;
    }
  });

  return isValid;
}

function showFieldError(errorId, message, inputEl) {
  const errorEl = document.getElementById(errorId);
  errorEl.textContent = message;
  errorEl.classList.add('visible');
  if (inputEl) inputEl.classList.add('error');
}

async function handleFormSubmit(e) {
  e.preventDefault();
  if (!validateForm()) {
    showToast('Please fill in all required fields', 'error');
    return;
  }

  const submitBtn = document.getElementById('form-submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px;margin:0;"></span> Saving...';

  try {
    const record = {
      patientName: document.getElementById('patient-name').value.trim(),
      age: parseInt(document.getElementById('patient-age').value),
      gender: document.getElementById('patient-gender').value,
      phone: document.getElementById('patient-phone').value.trim(),
      email: document.getElementById('patient-email').value.trim(),
      treatmentType: document.getElementById('treatment-type').value.trim(),
      treatmentDate: document.getElementById('treatment-date').value,
      toothArea: document.getElementById('tooth-area').value.trim(),
      chiefComplaint: document.getElementById('chief-complaint').value.trim(),
      treatmentNotes: document.getElementById('treatment-notes').value.trim(),
      photos: [...currentPhotos],
      createdAt: Date.now()
    };

    const recordId = await addRecord(record);
    record.id = recordId;

    // Auto-generate and save PDF
    showToast('Saving record & generating PDF...', 'info');
    await generateAndSavePDF(record);

    showToast('Record & PDF saved! ✅', 'success');
    resetForm();

    // Auto-backup to Google Drive if connected
    autoBackupToGoogleDrive();

    setTimeout(() => showRecordDetail(recordId), 300);
  } catch (err) {
    console.error('Error saving record:', err);
    showToast('Failed to save record', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="btn-icon">💾</span> Save Record';
  }
}

function resetForm() {
  document.getElementById('patient-form').reset();
  currentPhotos = [];
  renderPhotoPreviews();
  setDefaultDate();
  document.querySelectorAll('.form-error').forEach(el => { el.textContent = ''; el.classList.remove('visible'); });
  document.querySelectorAll('input.error, select.error').forEach(el => el.classList.remove('error'));
}

// ==================== PDF GENERATION ====================
function buildPDF(record) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const primaryColor = [8, 145, 178];
  const textColor = [15, 23, 42];
  const mutedColor = [100, 116, 139];
  const borderColor = [226, 232, 240];

  // Header
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text("Nia's Lab", margin, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Patient Record', margin, 26);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, pageWidth - margin, 26, { align: 'right' });
  y = 52;

  // Patient Info
  doc.setTextColor(...primaryColor);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Patient Information', margin, y);
  y += 2;
  doc.setDrawColor(...borderColor);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  const patientFields = [
    ['Name', record.patientName],
    ['Age', `${record.age} years`],
    ['Gender', record.gender],
    ['Phone', record.phone],
  ];
  if (record.email) patientFields.push(['Email', record.email]);

  doc.setFontSize(10);
  patientFields.forEach(([label, value]) => {
    doc.setTextColor(...mutedColor);
    doc.setFont('helvetica', 'normal');
    doc.text(`${label}:`, margin, y);
    doc.setTextColor(...textColor);
    doc.setFont('helvetica', 'bold');
    doc.text(String(value), margin + 30, y);
    y += 7;
  });
  y += 6;

  // Treatment Details
  doc.setTextColor(...primaryColor);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Treatment Details', margin, y);
  y += 2;
  doc.setDrawColor(...borderColor);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  const treatmentFields = [
    ['Diagnosis', record.treatmentType],
    ['Date', formatDate(record.treatmentDate)],
  ];
  if (record.toothArea) treatmentFields.push(['Tooth/Area', record.toothArea]);
  if (record.chiefComplaint) treatmentFields.push(['Complaint', record.chiefComplaint]);

  doc.setFontSize(10);
  treatmentFields.forEach(([label, value]) => {
    doc.setTextColor(...mutedColor);
    doc.setFont('helvetica', 'normal');
    doc.text(`${label}:`, margin, y);
    doc.setTextColor(...textColor);
    doc.setFont('helvetica', 'bold');
    doc.text(String(value), margin + 30, y);
    y += 7;
  });

  if (record.treatmentNotes) {
    y += 4;
    doc.setTextColor(...mutedColor);
    doc.setFont('helvetica', 'normal');
    doc.text('Notes:', margin, y);
    y += 6;
    doc.setTextColor(...textColor);
    doc.setFont('helvetica', 'normal');
    const splitNotes = doc.splitTextToSize(record.treatmentNotes, contentWidth);
    splitNotes.forEach(line => {
      if (y > pageHeight - 30) { doc.addPage(); y = margin; }
      doc.text(line, margin, y);
      y += 5;
    });
  }

  // Photos
  if (record.photos && record.photos.length > 0) {
    y += 10;
    if (y > pageHeight - 60) { doc.addPage(); y = margin; }

    doc.setTextColor(...primaryColor);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(`Photos (${record.photos.length})`, margin, y);
    y += 2;
    doc.setDrawColor(...borderColor);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    const photoWidth = (contentWidth - 10) / 2;
    const photoHeight = photoWidth * 0.75;
    let col = 0;

    for (let i = 0; i < record.photos.length; i++) {
      if (y + photoHeight > pageHeight - 20) { doc.addPage(); y = margin; col = 0; }
      const x = margin + col * (photoWidth + 10);
      try {
        doc.addImage(record.photos[i].data, 'JPEG', x, y, photoWidth, photoHeight);
        doc.setDrawColor(...borderColor);
        doc.setLineWidth(0.3);
        doc.rect(x, y, photoWidth, photoHeight);
      } catch (err) {
        doc.setDrawColor(...borderColor);
        doc.setFillColor(248, 250, 252);
        doc.rect(x, y, photoWidth, photoHeight, 'FD');
        doc.setTextColor(...mutedColor);
        doc.setFontSize(9);
        doc.text('Image unavailable', x + photoWidth / 2, y + photoHeight / 2, { align: 'center' });
      }
      col++;
      if (col >= 2) { col = 0; y += photoHeight + 8; }
    }
    if (col !== 0) y += photoHeight + 8;
  }

  // Footer
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...mutedColor);
    doc.text(`Page ${i} of ${totalPages} · Nia's Lab`, pageWidth / 2, pageHeight - 10, { align: 'center' });
  }

  return doc;
}

function generatePdfFilename(record) {
  const safeName = record.patientName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
  const shortTreatment = record.treatmentType.split(' ')[0];
  return `${safeName}_${shortTreatment}_${record.treatmentDate}`;
}

async function generateAndSavePDF(record) {
  const doc = buildPDF(record);
  const blob = doc.output('blob');
  const filename = generatePdfFilename(record);

  const pdfRecord = {
    name: filename,
    patientName: record.patientName,
    treatmentType: record.treatmentType,
    treatmentDate: record.treatmentDate,
    recordId: record.id,
    pdfBlob: blob,
    size: blob.size,
    createdAt: Date.now()
  };

  await addPdf(pdfRecord);
  return filename;
}

// ==================== PDFs VIEW ====================
async function loadPdfs() {
  try {
    allPdfs = await getAllPdfs();
    allPdfs.sort((a, b) => b.createdAt - a.createdAt);
    renderPdfsList();
  } catch (err) {
    console.error('Error loading PDFs:', err);
    showToast('Failed to load PDFs', 'error');
  }
}

function renderPdfsList() {
  const searchTerm = (document.getElementById('pdf-search-input')?.value || '').toLowerCase().trim();
  let filtered = allPdfs;

  if (searchTerm) {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(searchTerm) ||
      p.patientName.toLowerCase().includes(searchTerm) ||
      p.treatmentType.toLowerCase().includes(searchTerm)
    );
  }

  document.getElementById('pdfs-count-text').textContent =
    `${filtered.length} PDF${filtered.length !== 1 ? 's' : ''} saved`;

  const listContainer = document.getElementById('pdfs-list');
  const emptyState = document.getElementById('pdfs-empty');

  if (filtered.length === 0) {
    listContainer.style.display = 'none';
    emptyState.style.display = 'block';
  } else {
    listContainer.style.display = 'flex';
    emptyState.style.display = 'none';
    listContainer.innerHTML = filtered.map(p => renderPdfCard(p)).join('');
    attachPdfCardListeners(listContainer);
  }
}

function renderPdfCard(pdf) {
  const dateFormatted = formatDate(pdf.treatmentDate);
  const sizeFormatted = formatFileSize(pdf.size);
  const timeAgo = getTimeAgo(pdf.createdAt);

  return `
    <div class="pdf-card" data-id="${pdf.id}">
      <div class="pdf-icon-wrapper">📄</div>
      <div class="pdf-info">
        <div class="pdf-name" title="${escapeHtml(pdf.name)}.pdf">${escapeHtml(pdf.name)}.pdf</div>
        <div class="pdf-meta">
          <span>👤 ${escapeHtml(pdf.patientName)}</span>
          <span>🩺 ${escapeHtml(pdf.treatmentType)}</span>
          <span>📅 ${dateFormatted}</span>
          <span>📦 ${sizeFormatted}</span>
          <span>🕐 ${timeAgo}</span>
        </div>
      </div>
      <div class="pdf-actions">
        <button class="pdf-action-btn share-btn" data-id="${pdf.id}" title="Share via Email / Apps">📤</button>
        <button class="pdf-action-btn download-pdf-btn" data-id="${pdf.id}" title="Download">📥</button>
        <button class="pdf-action-btn rename-pdf-btn" data-id="${pdf.id}" title="Rename">✏️</button>
        <button class="pdf-action-btn delete-pdf-btn" data-id="${pdf.id}" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

function attachPdfCardListeners(container) {
  // Share
  container.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      sharePdf(parseInt(btn.dataset.id));
    });
  });

  // Download
  container.querySelectorAll('.download-pdf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadPdf(parseInt(btn.dataset.id));
    });
  });

  // Rename
  container.querySelectorAll('.rename-pdf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRenameModal(parseInt(btn.dataset.id));
    });
  });

  // Delete
  container.querySelectorAll('.delete-pdf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeletePdfModal(parseInt(btn.dataset.id));
    });
  });
}

// ==================== PDF ACTIONS ====================
async function sharePdf(id) {
  try {
    const pdf = await getPdf(id);
    if (!pdf) { showToast('PDF not found', 'error'); return; }

    const file = new File([pdf.pdfBlob], `${pdf.name}.pdf`, { type: 'application/pdf' });

    // Use Web Share API (works great on iPhone!)
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: `Patient Record - ${pdf.patientName}`,
        text: `${pdf.treatmentType} - ${formatDate(pdf.treatmentDate)}`,
        files: [file]
      });
      showToast('Shared successfully! ✅', 'success');
    } else {
      // Fallback: download + open mailto
      downloadBlob(pdf.pdfBlob, `${pdf.name}.pdf`);
      const subject = encodeURIComponent(`Patient Record: ${pdf.patientName} - ${pdf.treatmentType}`);
      const body = encodeURIComponent(
        `Patient Record for ${pdf.patientName}\n` +
        `Diagnosis: ${pdf.treatmentType}\n` +
        `Date: ${formatDate(pdf.treatmentDate)}\n\n` +
        `Please find the PDF attached.\n\n- Sent via Nia's Lab`
      );
      window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
      showToast('PDF downloaded — attach it to the email', 'info');
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Share error:', err);
      showToast('Failed to share', 'error');
    }
  }
}

async function downloadPdf(id) {
  try {
    const pdf = await getPdf(id);
    if (!pdf) { showToast('PDF not found', 'error'); return; }
    downloadBlob(pdf.pdfBlob, `${pdf.name}.pdf`);
    showToast('PDF downloaded! 📥', 'success');
  } catch (err) {
    console.error('Download error:', err);
    showToast('Failed to download', 'error');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Rename ---
async function openRenameModal(id) {
  try {
    const pdf = await getPdf(id);
    if (!pdf) return;
    renamingPdfId = id;
    document.getElementById('rename-input').value = pdf.name;
    document.getElementById('rename-modal').style.display = 'flex';
    setTimeout(() => {
      const input = document.getElementById('rename-input');
      input.focus();
      input.select();
    }, 100);
  } catch (err) {
    showToast('Error opening rename', 'error');
  }
}

function closeRenameModal() {
  document.getElementById('rename-modal').style.display = 'none';
  renamingPdfId = null;
}

async function handleRename() {
  if (!renamingPdfId) return;
  const newName = document.getElementById('rename-input').value.trim();
  if (!newName) {
    showToast('Name cannot be empty', 'error');
    return;
  }

  try {
    await updatePdfName(renamingPdfId, newName);
    closeRenameModal();
    showToast('PDF renamed! ✏️', 'success');
    loadPdfs();
  } catch (err) {
    console.error('Rename error:', err);
    showToast('Failed to rename', 'error');
  }
}

// --- Delete PDF ---
function openDeletePdfModal(id) {
  deletingPdfId = id;
  document.getElementById('delete-pdf-modal').style.display = 'flex';
}

function closeDeletePdfModal() {
  document.getElementById('delete-pdf-modal').style.display = 'none';
  deletingPdfId = null;
}

async function handleDeletePdf() {
  if (!deletingPdfId) return;
  try {
    await deletePdf(deletingPdfId);
    closeDeletePdfModal();
    showToast('PDF deleted', 'success');
    loadPdfs();
  } catch (err) {
    console.error('Delete PDF error:', err);
    showToast('Failed to delete PDF', 'error');
  }
}

// ==================== DETAIL VIEW PDF GENERATION ====================
async function handleDetailGeneratePDF() {
  if (!currentRecordId) return;
  try {
    const record = await getRecord(currentRecordId);
    if (!record) return;
    showToast('Generating PDF...', 'info');
    const filename = await generateAndSavePDF(record);
    showToast(`PDF saved: ${filename}.pdf ✅`, 'success');
  } catch (err) {
    console.error('PDF generation error:', err);
    showToast('Failed to generate PDF', 'error');
  }
}

// ==================== DELETE RECORD ====================
function showDeleteModal() {
  document.getElementById('delete-modal').style.display = 'flex';
}

function hideDeleteModal() {
  document.getElementById('delete-modal').style.display = 'none';
}

async function confirmDelete() {
  if (!currentRecordId) return;
  try {
    await deletePdfsByRecordId(currentRecordId);
    await deleteRecord(currentRecordId);
    hideDeleteModal();
    showToast('Record deleted', 'success');
    currentRecordId = null;
    navigate('records');
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Failed to delete record', 'error');
  }
}

// ==================== LIGHTBOX ====================
function openLightbox() {
  const lightbox = document.getElementById('lightbox');
  document.getElementById('lightbox-img').src = lightboxPhotos[lightboxIndex];
  document.getElementById('lightbox-counter').textContent = `${lightboxIndex + 1} / ${lightboxPhotos.length}`;
  document.getElementById('lightbox-prev').style.display = lightboxPhotos.length > 1 ? 'flex' : 'none';
  document.getElementById('lightbox-next').style.display = lightboxPhotos.length > 1 ? 'flex' : 'none';
  lightbox.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
  document.body.style.overflow = '';
}

function lightboxPrev() {
  lightboxIndex = (lightboxIndex - 1 + lightboxPhotos.length) % lightboxPhotos.length;
  document.getElementById('lightbox-img').src = lightboxPhotos[lightboxIndex];
  document.getElementById('lightbox-counter').textContent = `${lightboxIndex + 1} / ${lightboxPhotos.length}`;
}

function lightboxNext() {
  lightboxIndex = (lightboxIndex + 1) % lightboxPhotos.length;
  document.getElementById('lightbox-img').src = lightboxPhotos[lightboxIndex];
  document.getElementById('lightbox-counter').textContent = `${lightboxIndex + 1} / ${lightboxPhotos.length}`;
}

// ==================== TOAST ====================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" aria-label="Close">✕</button>
  `;
  container.appendChild(toast);
  toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));
  setTimeout(() => removeToast(toast), 4000);
}

function removeToast(toast) {
  if (!toast.parentNode) return;
  toast.classList.add('removing');
  setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
}

// ==================== UTILITIES ====================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0][0].toUpperCase();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

// ==================== iOS INSTALL BANNER ====================
function checkIOSInstallBanner() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone === true;
  const dismissed = localStorage.getItem('ios-install-dismissed');

  if (isIOS && !isStandalone && !dismissed) {
    document.getElementById('ios-install-banner').style.display = 'block';
  }
}

// ==================== BACKUP & RESTORE ====================
async function loadBackupView() {
  try {
    const records = await getAllRecords();
    const pdfs = await getAllPdfs();
    document.getElementById('export-record-count').textContent = `${records.length} records`;
    document.getElementById('export-pdf-count').textContent = `${pdfs.length} PDFs`;

    const lastExport = localStorage.getItem('lastExportDate');
    const exportInfo = document.getElementById('last-export-info');
    if (lastExport) {
      exportInfo.textContent = `Last export: ${new Date(parseInt(lastExport)).toLocaleString('en-IN')}`;
    } else {
      exportInfo.textContent = '';
    }

    // Update Google Drive UI
    updateGDriveUI();
  } catch (err) {
    console.error('Error loading backup view:', err);
  }
}

// --- Manual Export ---
async function exportAllData() {
  const exportBtn = document.getElementById('export-btn');
  exportBtn.disabled = true;
  exportBtn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px;margin:0;"></span> Exporting...';

  try {
    const records = await getAllRecords();
    const pdfs = await getAllPdfs();

    // Convert PDF blobs to base64 for JSON serialization
    const pdfsForExport = [];
    for (const pdf of pdfs) {
      const base64 = await blobToBase64(pdf.pdfBlob);
      pdfsForExport.push({
        ...pdf,
        pdfBlob: undefined,
        pdfBase64: base64,
        pdfType: pdf.pdfBlob.type || 'application/pdf'
      });
    }

    const exportData = {
      version: 2,
      appName: 'NiasLab',
      exportDate: new Date().toISOString(),
      recordCount: records.length,
      pdfCount: pdfsForExport.length,
      records: records,
      pdfs: pdfsForExport
    };

    const json = JSON.stringify(exportData);
    const blob = new Blob([json], { type: 'application/json' });
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `NiasLab_Backup_${dateStr}.json`;

    downloadBlob(blob, filename);
    localStorage.setItem('lastExportDate', Date.now().toString());
    showToast(`Backup exported! (${records.length} records, ${pdfsForExport.length} PDFs) 📥`, 'success');
    loadBackupView();
  } catch (err) {
    console.error('Export error:', err);
    showToast('Failed to export data', 'error');
  } finally {
    exportBtn.disabled = false;
    exportBtn.innerHTML = '<span class="btn-icon">📥</span> Download Backup';
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, type) {
  // base64 is a data URL like "data:application/pdf;base64,..."
  const parts = base64.split(',');
  const mime = parts[0].match(/:(.*?);/)?.[1] || type || 'application/pdf';
  const raw = atob(parts[1]);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// --- Manual Import ---
function handleImportFileSelect(file) {
  if (!file || !file.name.endsWith('.json')) {
    showToast('Please select a valid .json backup file', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.appName || (data.appName !== 'NiasLab' && data.appName !== 'DentaRecord') || !data.records) {
        showToast('Invalid backup file — not a valid backup', 'error');
        return;
      }

      pendingImportData = data;

      // Show confirmation modal
      const summary = document.getElementById('import-summary');
      summary.innerHTML = `
        <strong>Backup file details:</strong><br>
        📅 Export date: ${new Date(data.exportDate).toLocaleString('en-IN')}<br>
        👥 Records: <strong>${data.recordCount || data.records.length}</strong><br>
        📄 PDFs: <strong>${data.pdfCount || (data.pdfs ? data.pdfs.length : 0)}</strong><br><br>
        Data will be <strong>added</strong> to your existing records.
      `;
      document.getElementById('import-modal').style.display = 'flex';
    } catch (err) {
      console.error('Import parse error:', err);
      showToast('Failed to read backup file — is it valid JSON?', 'error');
    }
  };
  reader.readAsText(file);
}

async function confirmImport() {
  if (!pendingImportData) return;

  const importBtn = document.getElementById('import-confirm-btn');
  importBtn.disabled = true;
  importBtn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px;margin:0;"></span> Restoring...';

  try {
    const data = pendingImportData;
    let importedRecords = 0;
    let importedPdfs = 0;

    // Import records
    for (const record of data.records) {
      const cleanRecord = { ...record };
      delete cleanRecord.id; // Let IndexedDB assign new IDs
      await addRecord(cleanRecord);
      importedRecords++;
    }

    // Import PDFs
    if (data.pdfs && data.pdfs.length > 0) {
      for (const pdf of data.pdfs) {
        const cleanPdf = { ...pdf };
        delete cleanPdf.id;
        // Convert base64 back to blob
        if (cleanPdf.pdfBase64) {
          cleanPdf.pdfBlob = base64ToBlob(cleanPdf.pdfBase64, cleanPdf.pdfType);
          cleanPdf.size = cleanPdf.pdfBlob.size;
          delete cleanPdf.pdfBase64;
          delete cleanPdf.pdfType;
        }
        await addPdf(cleanPdf);
        importedPdfs++;
      }
    }

    closeImportModal();
    showToast(`Restored ${importedRecords} records & ${importedPdfs} PDFs! ✅`, 'success');
    loadBackupView();
  } catch (err) {
    console.error('Import error:', err);
    showToast('Failed to restore some data', 'error');
  } finally {
    importBtn.disabled = false;
    importBtn.innerHTML = 'Restore Data';
  }
}

function closeImportModal() {
  document.getElementById('import-modal').style.display = 'none';
  pendingImportData = null;
  document.getElementById('import-file-input').value = '';
}

// ==================== GOOGLE DRIVE BACKUP ====================
function initGoogleDrive() {
  // Check if user was previously connected
  const savedToken = localStorage.getItem('gdriveToken');
  const savedExpiry = localStorage.getItem('gdriveTokenExpiry');

  if (savedToken && savedExpiry && Date.now() < parseInt(savedExpiry)) {
    gdriveAccessToken = savedToken;
    updateGDriveUI();
  }
}

function updateGDriveUI() {
  const disconnectedEl = document.getElementById('gdrive-disconnected');
  const connectedEl = document.getElementById('gdrive-connected');

  if (!disconnectedEl || !connectedEl) return;

  if (gdriveAccessToken) {
    disconnectedEl.style.display = 'none';
    connectedEl.style.display = 'block';

    const email = localStorage.getItem('gdriveEmail') || 'Connected';
    document.getElementById('gdrive-email').textContent = email;

    const lastBackup = localStorage.getItem('gdriveLastBackup');
    document.getElementById('gdrive-last-backup').textContent =
      lastBackup ? new Date(parseInt(lastBackup)).toLocaleString('en-IN') : 'Never';

    document.getElementById('gdrive-status').textContent = 'Ready';
  } else {
    disconnectedEl.style.display = 'block';
    connectedEl.style.display = 'none';
  }
}

function connectGoogleDrive() {
  if (GOOGLE_CLIENT_ID === 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com') {
    showToast('Google Drive not configured yet — contact support to add the Client ID', 'error');
    return;
  }

  try {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
      callback: handleGoogleAuthResponse
    });
    client.requestAccessToken();
  } catch (err) {
    console.error('Google auth error:', err);
    showToast('Failed to connect to Google. Check your internet connection.', 'error');
  }
}

async function handleGoogleAuthResponse(response) {
  if (response.error) {
    console.error('Google auth error:', response);
    showToast('Google sign-in failed', 'error');
    return;
  }

  gdriveAccessToken = response.access_token;
  const expiresIn = response.expires_in || 3600;
  localStorage.setItem('gdriveToken', gdriveAccessToken);
  localStorage.setItem('gdriveTokenExpiry', (Date.now() + expiresIn * 1000).toString());

  // Fetch user email
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${gdriveAccessToken}` }
    });
    const info = await res.json();
    if (info.email) {
      localStorage.setItem('gdriveEmail', info.email);
    }
  } catch (err) {
    console.log('Could not fetch email:', err);
  }

  updateGDriveUI();
  showToast('Connected to Google Drive! ☁️', 'success');

  // Do an immediate backup
  await backupToGoogleDrive();
}

function disconnectGoogleDrive() {
  document.getElementById('gdrive-disconnect-modal').style.display = 'flex';
}

function confirmDisconnectGDrive() {
  gdriveAccessToken = null;
  localStorage.removeItem('gdriveToken');
  localStorage.removeItem('gdriveTokenExpiry');
  localStorage.removeItem('gdriveEmail');
  // Keep lastBackup timestamp for reference

  document.getElementById('gdrive-disconnect-modal').style.display = 'none';
  updateGDriveUI();
  showToast('Disconnected from Google Drive', 'success');
}

async function backupToGoogleDrive() {
  if (!gdriveAccessToken) {
    showToast('Not connected to Google Drive', 'error');
    return;
  }

  const statusEl = document.getElementById('gdrive-status');
  if (statusEl) {
    statusEl.textContent = 'Backing up...';
    statusEl.style.color = 'var(--warning)';
  }

  try {
    // Build export data
    const records = await getAllRecords();
    const pdfs = await getAllPdfs();
    const pdfsForExport = [];

    for (const pdf of pdfs) {
      const base64 = await blobToBase64(pdf.pdfBlob);
      pdfsForExport.push({
        ...pdf,
        pdfBlob: undefined,
        pdfBase64: base64,
        pdfType: pdf.pdfBlob.type || 'application/pdf'
      });
    }

    const exportData = {
      version: 2,
      appName: 'NiasLab',
      exportDate: new Date().toISOString(),
      recordCount: records.length,
      pdfCount: pdfsForExport.length,
      records: records,
      pdfs: pdfsForExport
    };

    const json = JSON.stringify(exportData);
    const blob = new Blob([json], { type: 'application/json' });

    // Check if backup file already exists on Drive
    const existingFileId = await findDriveBackupFile();

    if (existingFileId) {
      // Update existing file
      await updateDriveFile(existingFileId, blob);
    } else {
      // Create new file
      await createDriveFile('NiasLab_Backup.json', blob);
    }

    localStorage.setItem('gdriveLastBackup', Date.now().toString());
    if (statusEl) {
      statusEl.textContent = 'Ready';
      statusEl.style.color = '';
    }
    updateGDriveUI();
    showToast(`Backed up to Google Drive! (${records.length} records) ☁️`, 'success');
  } catch (err) {
    console.error('Google Drive backup error:', err);
    if (statusEl) {
      statusEl.textContent = 'Error';
      statusEl.style.color = 'var(--danger)';
    }

    // If token expired, clear it
    if (err.message && err.message.includes('401')) {
      gdriveAccessToken = null;
      localStorage.removeItem('gdriveToken');
      updateGDriveUI();
      showToast('Google Drive session expired — please reconnect', 'error');
    } else {
      showToast('Failed to backup to Google Drive', 'error');
    }
  }
}

async function autoBackupToGoogleDrive() {
  if (!gdriveAccessToken) return; // Not connected, skip silently

  // Check if token is still valid
  const expiry = localStorage.getItem('gdriveTokenExpiry');
  if (!expiry || Date.now() >= parseInt(expiry)) {
    gdriveAccessToken = null;
    localStorage.removeItem('gdriveToken');
    return;
  }

  // Run backup in background (don't await — don't block the UI)
  backupToGoogleDrive().catch(err => console.log('Auto-backup failed:', err));
}

async function restoreFromGoogleDrive() {
  if (!gdriveAccessToken) {
    showToast('Not connected to Google Drive', 'error');
    return;
  }

  const restoreBtn = document.getElementById('gdrive-restore-btn');
  restoreBtn.disabled = true;
  restoreBtn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px;margin:0;"></span> Checking...';

  try {
    const fileId = await findDriveBackupFile();
    if (!fileId) {
      showToast('No backup found on Google Drive', 'info');
      return;
    }

    // Download the file
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${gdriveAccessToken}` }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (!data.appName || (data.appName !== 'NiasLab' && data.appName !== 'DentaRecord') || !data.records) {
      showToast('Invalid backup file on Google Drive', 'error');
      return;
    }

    // Use the same import flow
    pendingImportData = data;
    const summary = document.getElementById('import-summary');
    summary.innerHTML = `
      <strong>Google Drive backup details:</strong><br>
      📅 Backup date: ${new Date(data.exportDate).toLocaleString('en-IN')}<br>
      👥 Records: <strong>${data.recordCount || data.records.length}</strong><br>
      📄 PDFs: <strong>${data.pdfCount || (data.pdfs ? data.pdfs.length : 0)}</strong><br><br>
      Data will be <strong>added</strong> to your existing records.
    `;
    document.getElementById('import-modal').style.display = 'flex';
  } catch (err) {
    console.error('Google Drive restore error:', err);
    if (err.message && err.message.includes('401')) {
      gdriveAccessToken = null;
      localStorage.removeItem('gdriveToken');
      updateGDriveUI();
      showToast('Google Drive session expired — please reconnect', 'error');
    } else {
      showToast('Failed to restore from Google Drive', 'error');
    }
  } finally {
    restoreBtn.disabled = false;
    restoreBtn.innerHTML = '<span class="btn-icon">📥</span> Restore from Drive';
  }
}

async function findDriveBackupFile() {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=(name='NiasLab_Backup.json' or name='DentaRecord_Backup.json') and trashed=false&spaces=drive&fields=files(id,name,modifiedTime)`,
    { headers: { 'Authorization': `Bearer ${gdriveAccessToken}` } }
  );

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function createDriveFile(name, blob) {
  const metadata = {
    name: name,
    mimeType: 'application/json'
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${gdriveAccessToken}` },
    body: form
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function updateDriveFile(fileId, blob) {
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${gdriveAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: blob
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ==================== SERVICE WORKER ====================
function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => console.log('Service Worker registered:', reg.scope))
      .catch(err => console.log('Service Worker registration failed:', err));
  }
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await openDatabase();
    console.log('Nia\'s Lab database initialized');
  } catch (err) {
    console.error('Failed to open database:', err);
    showToast('Failed to initialize database', 'error');
  }

  initForm();

  // Navigation
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.dataset.view);
    });
  });

  // Dashboard buttons
  document.getElementById('dashboard-new-btn').addEventListener('click', () => navigate('new-record'));
  document.getElementById('empty-new-btn').addEventListener('click', () => navigate('new-record'));

  // PDFs view "Add a Record" button
  const pdfsNewBtn = document.getElementById('pdfs-new-btn');
  if (pdfsNewBtn) pdfsNewBtn.addEventListener('click', () => navigate('new-record'));

  // Detail view
  document.getElementById('detail-back-btn').addEventListener('click', () => navigate('records'));
  document.getElementById('detail-pdf-btn').addEventListener('click', handleDetailGeneratePDF);
  document.getElementById('detail-delete-btn').addEventListener('click', showDeleteModal);

  // Delete record modal
  document.getElementById('delete-cancel-btn').addEventListener('click', hideDeleteModal);
  document.getElementById('delete-confirm-btn').addEventListener('click', confirmDelete);

  // Rename modal
  document.getElementById('rename-cancel-btn').addEventListener('click', closeRenameModal);
  document.getElementById('rename-save-btn').addEventListener('click', handleRename);
  document.getElementById('rename-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleRename(); }
  });

  // Delete PDF modal
  document.getElementById('delete-pdf-cancel-btn').addEventListener('click', closeDeletePdfModal);
  document.getElementById('delete-pdf-confirm-btn').addEventListener('click', handleDeletePdf);

  // Backup & Restore
  document.getElementById('export-btn').addEventListener('click', exportAllData);
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file-input').click());
  document.getElementById('import-file-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleImportFileSelect(e.target.files[0]);
  });
  document.getElementById('import-cancel-btn').addEventListener('click', closeImportModal);
  document.getElementById('import-confirm-btn').addEventListener('click', confirmImport);

  // Google Drive
  document.getElementById('gdrive-connect-btn').addEventListener('click', connectGoogleDrive);
  document.getElementById('gdrive-disconnect-btn').addEventListener('click', disconnectGoogleDrive);
  document.getElementById('gdrive-disconnect-cancel-btn').addEventListener('click', () => {
    document.getElementById('gdrive-disconnect-modal').style.display = 'none';
  });
  document.getElementById('gdrive-disconnect-confirm-btn').addEventListener('click', confirmDisconnectGDrive);
  document.getElementById('gdrive-backup-now-btn').addEventListener('click', backupToGoogleDrive);
  document.getElementById('gdrive-restore-btn').addEventListener('click', restoreFromGoogleDrive);

  // Search records
  document.getElementById('search-input').addEventListener('input', renderRecordsList);

  // Search PDFs
  document.getElementById('pdf-search-input').addEventListener('input', renderPdfsList);

  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderRecordsList();
    });
  });

  // Lightbox
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-prev').addEventListener('click', (e) => { e.stopPropagation(); lightboxPrev(); });
  document.getElementById('lightbox-next').addEventListener('click', (e) => { e.stopPropagation(); lightboxNext(); });
  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightbox')) closeLightbox();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const lightbox = document.getElementById('lightbox');
    if (lightbox.style.display === 'flex') {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') lightboxPrev();
      if (e.key === 'ArrowRight') lightboxNext();
      return;
    }
    if (document.getElementById('delete-modal').style.display === 'flex' && e.key === 'Escape') hideDeleteModal();
    if (document.getElementById('rename-modal').style.display === 'flex' && e.key === 'Escape') closeRenameModal();
    if (document.getElementById('delete-pdf-modal').style.display === 'flex' && e.key === 'Escape') closeDeletePdfModal();
    if (document.getElementById('import-modal').style.display === 'flex' && e.key === 'Escape') closeImportModal();
    if (document.getElementById('gdrive-disconnect-modal').style.display === 'flex' && e.key === 'Escape') {
      document.getElementById('gdrive-disconnect-modal').style.display = 'none';
    }
  });

  // Mobile menu
  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open');
  });
  document.getElementById('sidebar-overlay').addEventListener('click', closeMobileSidebar);

  // iOS install banner
  document.getElementById('dismiss-install-banner').addEventListener('click', () => {
    document.getElementById('ios-install-banner').style.display = 'none';
    localStorage.setItem('ios-install-dismissed', 'true');
  });

  // Check iOS install
  checkIOSInstallBanner();

  // Register service worker
  registerServiceWorker();

  // Initialize Google Drive
  initGoogleDrive();

  // Load dashboard
  loadDashboard();
});
