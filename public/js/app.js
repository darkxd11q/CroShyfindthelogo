// public/js/app.js
(function () {
  'use strict';

  const photoZone = document.getElementById('photo-zone');
  const caseLabel = document.getElementById('case-label');
  const voteRow = document.getElementById('vote-row');
  const likeBtn = document.getElementById('like-btn');
  const dislikeBtn = document.getElementById('dislike-btn');
  const likeCount = document.getElementById('like-count');
  const dislikeCount = document.getElementById('dislike-count');
  const commentsSection = document.getElementById('comments-section');
  const commentForm = document.getElementById('comment-form');
  const commentName = document.getElementById('comment-name');
  const commentText = document.getElementById('comment-text');
  const charCount = document.getElementById('char-count');
  const formMsg = document.getElementById('form-msg');
  const commentList = document.getElementById('comment-list');

  let currentImageId = null;
  let solved = false;

  // ---- a stable anonymous id, just enough to stop double-votes ----
  function getClientId() {
    let id = localStorage.getItem('logohunt_clientId');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('cid-' + Date.now() + '-' + Math.random().toString(16).slice(2));
      localStorage.setItem('logohunt_clientId', id);
    }
    return id;
  }
  const clientId = getClientId();

  function escapeForAttr(str) {
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------------------------------------------------------------
  // Load the active puzzle
  // ---------------------------------------------------------------
  async function loadPuzzle() {
    try {
      const res = await fetch('/api/game/active');
      if (res.status === 404) {
        photoZone.innerHTML = '<div class="empty-state">No case is open right now.<br>Check back soon.</div>';
        caseLabel.textContent = 'Closed';
        return;
      }
      if (!res.ok) throw new Error('Failed to load puzzle');
      const data = await res.json();
      currentImageId = data.id;
      caseLabel.textContent = 'Exhibit #' + data.id;
      solved = localStorage.getItem('logohunt_found_' + data.id) === '1';
      renderPhoto(data);
      voteRow.style.display = 'flex';
      commentsSection.style.display = 'block';
      loadVotes();
      loadComments();
    } catch (err) {
      photoZone.innerHTML = '<div class="empty-state">Could not reach the server. Try refreshing.</div>';
    }
  }

  function renderPhoto(data) {
    photoZone.innerHTML = `
      <div class="photo-frame" id="photo-frame">
        <img id="puzzle-img" src="${escapeForAttr(data.url)}" alt="Find the hidden logo in this photo">
        <div class="spotlight-overlay" id="spotlight"></div>
        <div class="found-flash" id="found-flash"></div>
        <div class="result-stamp found" id="result-stamp">Found it</div>
      </div>
      <div class="case-meta"><span>Click anywhere you spot the mark</span><span id="status-text">${solved ? 'Solved' : 'Searching'}</span></div>
    `;

    const frame = document.getElementById('photo-frame');
    const img = document.getElementById('puzzle-img');
    const spotlight = document.getElementById('spotlight');

    function moveSpot(clientX, clientY) {
      const rect = frame.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      spotlight.style.background =
        `radial-gradient(circle 130px at ${x}px ${y}px, transparent 0%, rgba(8,9,14,0.30) 55%, rgba(8,9,14,0.55) 100%)`;
    }

    frame.addEventListener('pointermove', (e) => moveSpot(e.clientX, e.clientY));
    frame.addEventListener('pointerleave', () => {
      spotlight.style.background = 'rgba(8, 9, 14, 0.42)';
    });

    frame.addEventListener('click', (e) => handleGuess(e, frame, img));
  }

  async function handleGuess(e, frame, img) {
    if (!currentImageId) return;

    const rect = frame.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Convert the click from displayed pixels to the image's natural
    // resolution - the server only knows the logo's natural-pixel spot.
    const scale = img.naturalWidth ? (img.naturalWidth / rect.width) : 1;
    const naturalX = clickX * scale;
    const naturalY = clickY * scale;

    let result;
    try {
      const res = await fetch(`/api/game/${currentImageId}/guess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: naturalX, y: naturalY })
      });
      if (!res.ok) return;
      result = await res.json();
    } catch (err) {
      return;
    }

    if (result.correct) {
      solved = true;
      localStorage.setItem('logohunt_found_' + currentImageId, '1');
      const flash = document.getElementById('found-flash');
      flash.style.setProperty('--fx', clickX + 'px');
      flash.style.setProperty('--fy', clickY + 'px');
      flash.classList.remove('show'); void flash.offsetWidth; flash.classList.add('show');

      const hit = document.createElement('div');
      hit.className = 'hit-mark show';
      hit.style.left = clickX + 'px';
      hit.style.top = clickY + 'px';
      frame.appendChild(hit);
      setTimeout(() => hit.remove(), 950);

      const stamp = document.getElementById('result-stamp');
      stamp.classList.remove('show'); void stamp.offsetWidth; stamp.classList.add('show');

      const statusText = document.getElementById('status-text');
      if (statusText) statusText.textContent = 'Solved';
    } else {
      const miss = document.createElement('div');
      miss.className = 'miss-mark show';
      miss.style.left = clickX + 'px';
      miss.style.top = clickY + 'px';
      frame.appendChild(miss);
      setTimeout(() => miss.remove(), 700);
    }
  }

  // ---------------------------------------------------------------
  // Likes / dislikes
  // ---------------------------------------------------------------
  async function loadVotes() {
    try {
      const res = await fetch(`/api/game/${currentImageId}/votes?clientId=${encodeURIComponent(clientId)}`);
      if (!res.ok) return;
      const data = await res.json();
      applyVoteState(data);
    } catch (err) { /* ignore */ }
  }

  function applyVoteState(data) {
    likeCount.textContent = data.likes;
    dislikeCount.textContent = data.dislikes;
    likeBtn.classList.toggle('active', data.yourVote === 'like');
    dislikeBtn.classList.toggle('active', data.yourVote === 'dislike');
  }

  async function castVote(type) {
    if (!currentImageId) return;
    try {
      const res = await fetch(`/api/game/${currentImageId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, clientId })
      });
      if (!res.ok) return;
      const data = await res.json();
      applyVoteState(data);
    } catch (err) { /* ignore */ }
  }

  likeBtn.addEventListener('click', () => castVote('like'));
  dislikeBtn.addEventListener('click', () => castVote('dislike'));

  // ---------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------
  function formatTime(iso) {
    try {
      return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString();
    } catch (e) {
      return iso;
    }
  }

  function renderComments(list) {
    commentList.innerHTML = '';
    if (!list.length) {
      commentList.innerHTML = '<div class="comment-empty">No notes yet. Be the first to leave one.</div>';
      return;
    }
    list.forEach(c => {
      const li = document.createElement('li');
      li.className = 'comment-item';

      const who = document.createElement('div');
      who.className = 'who';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = c.name;
      const time = document.createElement('time');
      time.textContent = formatTime(c.created_at);
      who.appendChild(nameSpan);
      who.appendChild(time);

      const p = document.createElement('p');
      p.textContent = c.comment;

      li.appendChild(who);
      li.appendChild(p);
      commentList.appendChild(li);
    });
  }

  async function loadComments() {
    try {
      const res = await fetch(`/api/game/${currentImageId}/comments`);
      if (!res.ok) return;
      renderComments(await res.json());
    } catch (err) { /* ignore */ }
  }

  commentText.addEventListener('input', () => {
    charCount.textContent = (500 - commentText.value.length) + ' left';
  });

  commentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentImageId) return;
    formMsg.textContent = '';
    formMsg.className = 'form-msg';

    const name = commentName.value.trim();
    const comment = commentText.value.trim();
    if (!name || !comment) {
      formMsg.textContent = 'Please fill in both fields.';
      formMsg.classList.add('error');
      return;
    }

    const submitBtn = commentForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const res = await fetch(`/api/game/${currentImageId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, comment })
      });
      const data = await res.json();
      if (!res.ok) {
        formMsg.textContent = data.error || 'Could not post your comment.';
        formMsg.classList.add('error');
      } else {
        commentText.value = '';
        charCount.textContent = '500 left';
        formMsg.textContent = 'Posted!';
        formMsg.classList.add('success');
        loadComments();
      }
    } catch (err) {
      formMsg.textContent = 'Network error - try again.';
      formMsg.classList.add('error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  loadPuzzle();
})();
