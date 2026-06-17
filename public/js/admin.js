// public/js/admin.js
(function () {
  'use strict';

  const loginView = document.getElementById('login-view');
  const dashboardView = document.getElementById('dashboard-view');
  const loginForm = document.getElementById('login-form');
  const loginPassword = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');

  const uploadInput = document.getElementById('upload-input');
  const uploadBtn = document.getElementById('upload-btn');
  const uploadStatus = document.getElementById('upload-status');
  const imageGrid = document.getElementById('image-grid');

  const editorOverlay = document.getElementById('editor-overlay');
  const editorPhoto = document.getElementById('editor-photo');
  const editorImg = document.getElementById('editor-img');
  const toleranceSlider = document.getElementById('tolerance-slider');
  const toleranceValue = document.getElementById('tolerance-value');
  const editorCancel = document.getElementById('editor-cancel');
  const editorSave = document.getElementById('editor-save');
  const toast = document.getElementById('toast');

  let editingImage = null;
  let pendingX = null;
  let pendingY = null;

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function escapeForAttr(str) {
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------------------------------------------------------------
  // Session / login
  // ---------------------------------------------------------------
  async function checkSession() {
    const res = await fetch('/api/admin/session');
    const data = await res.json();
    if (data.loggedIn) {
      showDashboard();
    } else {
      showLogin();
    }
  }

  function showLogin() {
    loginView.style.display = 'block';
    dashboardView.style.display = 'none';
  }

  function showDashboard() {
    loginView.style.display = 'none';
    dashboardView.style.display = 'block';
    loadImages();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword.value })
      });
      const data = await res.json();
      if (!res.ok) {
        loginError.textContent = data.error || 'Login failed.';
        return;
      }
      loginPassword.value = '';
      showDashboard();
    } catch (err) {
      loginError.textContent = 'Network error - try again.';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    showLogin();
  });

  // ---------------------------------------------------------------
  // Image list
  // ---------------------------------------------------------------
  async function loadImages() {
    const res = await fetch('/api/admin/images');
    if (res.status === 401) { showLogin(); return; }
    const images = await res.json();
    renderGrid(images);
  }

  function renderGrid(images) {
    if (!images.length) {
      imageGrid.innerHTML = '<div class="empty-grid">No images yet. Upload your first puzzle photo above.</div>';
      return;
    }
    imageGrid.innerHTML = '';
    images.forEach(img => {
      const card = document.createElement('div');
      card.className = 'image-card';

      let badge = '<span class="badge unset">No target</span>';
      if (img.isActive) badge = '<span class="badge active">Live</span>';
      else if (img.logoSet) badge = '<span class="badge ready">Ready</span>';

      card.innerHTML = `
        <div class="thumb-wrap">
          <img src="${escapeForAttr(img.url)}" alt="">
          ${badge}
        </div>
        <div class="body">
          <div class="stats">
            <span>${img.width}&times;${img.height}</span>
            <span>&#128077; ${img.likes} &nbsp; &#128078; ${img.dislikes} &nbsp; &#128172; ${img.commentsCount}</span>
          </div>
          <div class="actions">
            <button class="btn-mini" data-action="edit">Set logo</button>
            ${img.isActive
              ? '<button class="btn-mini" data-action="deactivate">Take offline</button>'
              : '<button class="btn-mini primary" data-action="activate">Activate</button>'}
            <button class="btn-mini danger" data-action="delete">Delete</button>
          </div>
        </div>
      `;

      card.querySelector('[data-action="edit"]').addEventListener('click', () => openEditor(img));
      const activateBtn = card.querySelector('[data-action="activate"]');
      if (activateBtn) activateBtn.addEventListener('click', () => activateImage(img.id));
      const deactivateBtn = card.querySelector('[data-action="deactivate"]');
      if (deactivateBtn) deactivateBtn.addEventListener('click', () => deactivateImage(img.id));
      card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteImage(img.id));

      imageGrid.appendChild(card);
    });
  }

  async function activateImage(id) {
    const res = await fetch(`/api/admin/images/${id}/activate`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Could not activate.'); return; }
    showToast('Puzzle is now live.');
    loadImages();
  }

  async function deactivateImage(id) {
    await fetch(`/api/admin/images/${id}/deactivate`, { method: 'POST' });
    showToast('Puzzle taken offline.');
    loadImages();
  }

  async function deleteImage(id) {
    if (!confirm('Delete this image and all of its votes/comments? This cannot be undone.')) return;
    await fetch(`/api/admin/images/${id}`, { method: 'DELETE' });
    showToast('Deleted.');
    loadImages();
  }

  // ---------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------
  uploadBtn.addEventListener('click', async () => {
    const file = uploadInput.files[0];
    if (!file) { showToast('Choose an image file first.'); return; }

    const fd = new FormData();
    fd.append('image', file);
    uploadStatus.textContent = 'Uploading...';
    uploadBtn.disabled = true;
    try {
      const res = await fetch('/api/admin/images', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        uploadStatus.textContent = data.error || 'Upload failed.';
      } else {
        uploadStatus.textContent = 'Uploaded.';
        uploadInput.value = '';
        loadImages();
      }
    } catch (err) {
      uploadStatus.textContent = 'Network error.';
    } finally {
      uploadBtn.disabled = false;
      setTimeout(() => { uploadStatus.textContent = ''; }, 3000);
    }
  });

  // ---------------------------------------------------------------
  // Logo location editor
  // ---------------------------------------------------------------
  function openEditor(img) {
    editingImage = img;
    pendingX = img.logoSet ? img.logoX : null;
    pendingY = img.logoSet ? img.logoY : null;
    toleranceSlider.value = img.tolerance || 30;
    toleranceValue.textContent = toleranceSlider.value;

    editorImg.src = img.url;
    editorOverlay.style.display = 'flex';

    editorImg.onload = () => drawMarker();
  }

  function drawMarker() {
    // remove old markers
    editorPhoto.querySelectorAll('.target-marker, .tolerance-ring').forEach(el => el.remove());
    if (pendingX === null || pendingY === null) return;

    const rect = editorImg.getBoundingClientRect();
    const scale = rect.width / editingImage.width;
    const dispX = pendingX * scale;
    const dispY = pendingY * scale;
    const dispR = Number(toleranceSlider.value) * scale;

    const ring = document.createElement('div');
    ring.className = 'tolerance-ring';
    ring.style.width = (dispR * 2) + 'px';
    ring.style.height = (dispR * 2) + 'px';
    ring.style.left = (dispX - dispR) + 'px';
    ring.style.top = (dispY - dispR) + 'px';
    editorPhoto.appendChild(ring);

    const marker = document.createElement('div');
    marker.className = 'target-marker';
    marker.style.left = dispX + 'px';
    marker.style.top = dispY + 'px';
    editorPhoto.appendChild(marker);
  }

  editorPhoto.addEventListener('click', (e) => {
    if (e.target === toleranceSlider) return;
    const rect = editorImg.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const scale = editingImage.width / rect.width;
    pendingX = clickX * scale;
    pendingY = clickY * scale;
    drawMarker();
  });

  toleranceSlider.addEventListener('input', () => {
    toleranceValue.textContent = toleranceSlider.value;
    drawMarker();
  });

  editorCancel.addEventListener('click', closeEditor);

  function closeEditor() {
    editorOverlay.style.display = 'none';
    editingImage = null;
    pendingX = null;
    pendingY = null;
  }

  editorSave.addEventListener('click', async () => {
    if (pendingX === null || pendingY === null) {
      showToast('Click on the image to choose the logo spot first.');
      return;
    }
    const res = await fetch(`/api/admin/images/${editingImage.id}/logo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: pendingX, y: pendingY, tolerance: Number(toleranceSlider.value) })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not save.');
      return;
    }
    showToast('Logo location saved.');
    closeEditor();
    loadImages();
  });

  checkSession();
})();
