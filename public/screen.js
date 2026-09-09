// Big Screen Lottery Logic - Supports both GitHub Pages (MQTT/WSS) & Local Node.js (Socket.IO)

(function() {
  // State
  let participants = [];
  let winners = [];
  let isRolling = false;
  let targetCount = 50;
  let winnersCount = 3;
  let autoRollOnTarget = false;
  let mqttClient = null;
  let socket = null;

  // DOM Elements
  const qrcodeContainer = document.getElementById('qrcode');
  const qrUrlHint = document.getElementById('qrUrlHint');
  const participantsGrid = document.getElementById('participantsGrid');
  const emptyState = document.getElementById('emptyState');
  const participantCountEl = document.getElementById('participantCount');
  const targetCountEl = document.getElementById('targetCount');
  const progressBarFill = document.getElementById('progressBarFill');
  const launchBtn = document.getElementById('launchBtn');
  const connDot = document.getElementById('connDot');
  const connStatus = document.getElementById('connStatus');
  const roomCodeEl = document.getElementById('roomCode');
  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownNum = document.getElementById('countdownNum');
  const podiumModal = document.getElementById('podiumModal');
  const podiumGrid = document.getElementById('podiumGrid');

  // EY Brand Avatar color palette
  const AVATAR_GRADIENTS = [
    'linear-gradient(135deg, #188CE5, #025ca5)',
    'linear-gradient(135deg, #38bdf8, #188CE5)',
    'linear-gradient(135deg, #3E3E4C, #2E2E38)',
    'linear-gradient(135deg, #0ea5e9, #0284c7)',
    'linear-gradient(135deg, #475569, #1e293b)',
    'linear-gradient(135deg, #2563eb, #1d4ed8)',
    'linear-gradient(135deg, #0284c7, #188CE5)',
    'linear-gradient(135deg, #525263, #3E3E4C)'
  ];

  // Room Code Generator / Resolver (Stable across refreshes!)
  const urlParams = new URLSearchParams(window.location.search);
  let roomCode = urlParams.get('room') || localStorage.getItem('lotto_room_code') || 'EVENT-1';
  localStorage.setItem('lotto_room_code', roomCode);

  const newUrl = window.location.pathname + '?room=' + roomCode;
  window.history.replaceState({ path: newUrl }, '', newUrl);
  roomCodeEl.textContent = roomCode;

  // Build join URL
  function getJoinUrl() {
    let base = window.location.href.split('?')[0];
    base = base.replace(/index\.html$/, '').replace(/\/$/, '');
    return `${base}/join.html?room=${roomCode}`;
  }

  const joinUrl = getJoinUrl();
  qrUrlHint.textContent = joinUrl;
  qrUrlHint.title = 'Кликните, чтобы скопировать ссылку';
  qrUrlHint.addEventListener('click', () => {
    navigator.clipboard.writeText(joinUrl);
    const orig = qrUrlHint.textContent;
    qrUrlHint.textContent = '✓ Ссылка скопирована в буфер!';
    setTimeout(() => { qrUrlHint.textContent = orig; }, 2000);
  });

  // Render QR Code
  function renderQrCode() {
    qrcodeContainer.innerHTML = '';
    new QRCode(qrcodeContainer, {
      text: joinUrl,
      width: 210,
      height: 210,
      colorDark: '#0b0f19',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }
  renderQrCode();

  // Helper: Get Initials
  function getInitials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  // Update UI Stats
  function updateStats() {
    const count = participants.length;
    participantCountEl.textContent = count;
    targetCountEl.textContent = `/ ${targetCount}`;

    const pct = Math.min(100, Math.round((count / targetCount) * 100));
    progressBarFill.style.width = pct + '%';

    if (count >= targetCount) {
      launchBtn.classList.add('ready-glow');
    } else {
      launchBtn.classList.remove('ready-glow');
    }

    launchBtn.disabled = count < winnersCount || isRolling;

    if (count === 0) {
      emptyState.style.display = 'flex';
      participantsGrid.style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      participantsGrid.style.display = 'grid';
    }
  }

  // Add Participant
  function addParticipant(data) {
    if (!data || !data.name) return;

    // Check if duplicate name / id
    const existing = participants.find(p => 
      (data.id && p.id === data.id) || 
      (p.name.toLowerCase() === data.name.toLowerCase() && p.contact === data.contact)
    );

    if (existing) return;

    const participant = {
      id: data.id || ('p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
      name: data.name.trim(),
      gradient: AVATAR_GRADIENTS[participants.length % AVATAR_GRADIENTS.length],
      number: participants.length + 1
    };

    participants.push(participant);
    renderParticipantCard(participant);
    updateStats();

    try {
      localStorage.setItem('lotto_participants_' + roomCode, JSON.stringify(participants));
    } catch(e) {}

    if (window.sounds) window.sounds.playJoin();

    // Auto-roll if target reached and feature enabled
    if (autoRollOnTarget && participants.length === targetCount && !isRolling) {
      setTimeout(() => startLottery(), 1000);
    }
  }

  // Render Single Participant Card
  function renderParticipantCard(p) {
    const card = document.createElement('div');
    card.className = 'participant-card';
    card.id = 'card-' + p.id;

    card.innerHTML = `
      <div class="p-num">#${p.number}</div>
      <div class="p-avatar" style="background: ${p.gradient};">${getInitials(p.name)}</div>
      <div class="p-info">
        <div class="p-name" title="${p.name}">${p.name}</div>
      </div>
    `;

    // Ability for host to remove a card on right click
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm(`Удалить участника "${p.name}"?`)) {
        removeParticipant(p.id);
      }
    });

    participantsGrid.appendChild(card);
  }

  function removeParticipant(id) {
    participants = participants.filter(p => p.id !== id);
    const card = document.getElementById('card-' + id);
    if (card) card.remove();
    // Re-number
    participants.forEach((p, idx) => {
      p.number = idx + 1;
      const c = document.getElementById('card-' + p.id);
      if (c) {
        const numEl = c.querySelector('.p-num');
        if (numEl) numEl.textContent = '#' + p.number;
      }
    });
    updateStats();
  }

  // Real-time Network Setup (Supports Socket.IO if local, or MQTT/WSS for GitHub Pages)
  function setupRealtime() {
    if (typeof io !== 'undefined') {
      // Local Node.js Socket.IO mode
      socket = io();
      socket.on('connect', () => {
        connDot.classList.add('online');
        connStatus.textContent = 'Онлайн (Node.js)';
        socket.emit('host_init', { room: roomCode });
      });
      socket.on('disconnect', () => {
        connDot.classList.remove('online');
        connStatus.textContent = 'Офлайн';
      });
      socket.on('participant_joined', (data) => {
        addParticipant(data);
      });
      return;
    }

    // GitHub Pages mode: Public MQTT over WSS (EMQX Cloud Broker)
    if (typeof mqtt !== 'undefined') {
      const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
      const clientId = 'lottery_screen_' + Math.random().toString(16).substr(2, 8);
      connStatus.textContent = 'Подключение...';

      mqttClient = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 2000
      });

      mqttClient.on('connect', () => {
        connDot.classList.add('online');
        connStatus.textContent = 'Онлайн (Cloud WSS)';
        mqttClient.subscribe(`qrlotto/${roomCode}/p/+`, { qos: 1 });
        mqttClient.subscribe('qrlotto/+/p/+', { qos: 1 });
        mqttClient.subscribe(`qrlotto/${roomCode}/join`, { qos: 1 });
        mqttClient.subscribe('qrlotto/+/join', { qos: 1 });
        mqttClient.subscribe('qrlotto/all/join', { qos: 1 });
      });

      mqttClient.on('error', (err) => {
        console.warn('MQTT Error:', err);
        connDot.classList.remove('online');
        connStatus.textContent = 'Ошибка сети';
      });

      mqttClient.on('close', () => {
        connDot.classList.remove('online');
        connStatus.textContent = 'Переподключение...';
      });

      mqttClient.on('message', (topic, message) => {
        try {
          const payload = JSON.parse(message.toString());
          if (payload && payload.name) {
            addParticipant(payload);
          }
        } catch (e) {
          console.error('Failed to parse message', e);
        }
      });
    }
  }

  // Broadcast Winners to Phones
  function broadcastWinners(winnersList) {
    const payload = JSON.stringify({
      winners: winnersList.map(w => ({ id: w.id, name: w.name, contact: w.contact, place: w.place }))
    });

    if (socket) {
      socket.emit('lottery_winners', { room: roomCode, winners: winnersList });
    } else if (mqttClient && mqttClient.connected) {
      mqttClient.publish(`qrlotto/${roomCode}/winner`, payload, { qos: 1, retain: true });
    }
  }

  // Randomizer Animation & Sound
  async function startLottery() {
    if (isRolling || participants.length < winnersCount) return;
    isRolling = true;
    launchBtn.disabled = true;
    document.body.classList.add('rolling');

    // 1. Countdown 3, 2, 1
    countdownOverlay.classList.add('active');
    for (let c = 3; c >= 1; c--) {
      countdownNum.textContent = c;
      if (window.sounds) window.sounds.playCountdown();
      await new Promise(r => setTimeout(r, 900));
    }
    countdownNum.textContent = '🔥';
    await new Promise(r => setTimeout(r, 500));
    countdownOverlay.classList.remove('active');

    // Clear previous winners
    winners = [];
    document.querySelectorAll('.grid-winner').forEach(el => el.classList.remove('grid-winner'));

    // Available candidate pool
    let pool = [...participants];
    const places = [
      { rank: 3, title: '3 МЕСТО (Бронза)' },
      { rank: 2, title: '2 МЕСТО (Серебро)' },
      { rank: 1, title: '1 МЕСТО (Золото)' }
    ];

    // Pick 3 winners sequentially for thrilling suspense
    for (let i = 0; i < winnersCount; i++) {
      const placeMeta = places[i] || { rank: i + 1, title: `${i + 1} МЕСТО` };
      const winner = await rollOneWinner(pool, placeMeta);
      winner.place = placeMeta.rank;
      winner.placeTitle = placeMeta.title;
      winners.push(winner);
      pool = pool.filter(p => p.id !== winner.id);

      // Celebrate each winner immediately
      highlightWinnerCard(winner);
      if (window.sounds) window.sounds.playWin();
      fireConfettiBatch();

      await new Promise(r => setTimeout(r, 1200));
    }

    // Finished rolling!
    document.body.classList.remove('rolling');
    isRolling = false;
    launchBtn.disabled = false;

    // Broadcast to phones
    broadcastWinners(winners);

    // Show Final Podium Modal
    setTimeout(() => {
      showPodium(winners);
      fireBigCelebration();
    }, 800);
  }

  // Roll single candidate with deceleration wheel curve
  function rollOneWinner(pool, placeMeta) {
    return new Promise(resolve => {
      let currentIdx = Math.floor(Math.random() * pool.length);
      let step = 0;
      const totalSteps = 35 + Math.floor(Math.random() * 10);
      let delay = 50;

      function highlightCandidate(p) {
        document.querySelectorAll('.active-candidate').forEach(el => el.classList.remove('active-candidate'));
        const el = document.getElementById('card-' + p.id);
        if (el) {
          el.classList.add('active-candidate');
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      function tick() {
        step++;
        currentIdx = (currentIdx + 1) % pool.length;
        const candidate = pool[currentIdx];
        highlightCandidate(candidate);

        if (window.sounds) window.sounds.playTick(600 + (step * 15));

        if (step < totalSteps) {
          // Quadratic deceleration curve for dramatic suspense
          delay += Math.floor((step / totalSteps) * 16);
          setTimeout(tick, delay);
        } else {
          // Finished this roll
          setTimeout(() => {
            document.querySelectorAll('.active-candidate').forEach(el => el.classList.remove('active-candidate'));
            resolve(candidate);
          }, 300);
        }
      }

      tick();
    });
  }

  function highlightWinnerCard(winner) {
    const el = document.getElementById('card-' + winner.id);
    if (el) {
      el.classList.add('grid-winner');
    }
  }

  // Podium Modal Display
  function showPodium(winnersList) {
    podiumGrid.innerHTML = '';

    // Sort: 2nd place left, 1st place center (elevated), 3rd place right
    const sorted = [...winnersList].sort((a, b) => a.place - b.place);
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };

    sorted.forEach(w => {
      const col = document.createElement('div');
      col.className = `podium-place place-${w.place}`;
      col.innerHTML = `
        <div class="place-medal">${medals[w.place] || '🏆'}</div>
        <div class="place-avatar" style="background: ${w.gradient};">${getInitials(w.name)}</div>
        <div class="place-name">${w.name}</div>
      `;
      podiumGrid.appendChild(col);
    });

    podiumModal.classList.add('active');
  }

  window.closePodium = function() {
    podiumModal.classList.remove('active');
  };

  // Confetti Effects
  function fireConfettiBatch() {
    if (typeof confetti !== 'undefined') {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  }

  function fireBigCelebration() {
    if (typeof confetti === 'undefined') return;
    const duration = 4 * 1000;
    const end = Date.now() + duration;

    (function frame() {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0 }
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1 }
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    })();
  }

  // Host Tools: Demo Data Generator (50 Russian realistic names)
  window.generateDemoParticipants = function(count = 50) {
    const firstNames = ['Александр', 'Михаил', 'Максим', 'Артем', 'Даниил', 'Иван', 'Дмитрий', 'Кирилл', 'Никита', 'Егор', 'Анна', 'Мария', 'Елена', 'Дарья', 'Алиса', 'Полина', 'Виктория', 'Екатерина', 'Ксения', 'Анастасия'];
    const lastNames = ['Иванов', 'Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Петров', 'Соколов', 'Михайлов', 'Новиков', 'Федоров', 'Морозов', 'Волков', 'Алексеев', 'Лебедев', 'Семенов', 'Егоров', 'Павлов', 'Козлов', 'Степанов', 'Николаев'];

    const target = Math.min(count, 100);
    for (let i = 0; i < target; i++) {
      const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
      const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
      const fullName = `${fn} ${ln}`;
      addParticipant({
        id: 'demo_' + (i + 1),
        name: fullName
      });
    }
  };

  // Reset Game
  window.resetLottery = function() {
    if (confirm('Очистить список всех участников и сбросить розыгрыш?')) {
      participants = [];
      winners = [];
      participantsGrid.innerHTML = '';
      document.querySelectorAll('.grid-winner').forEach(el => el.classList.remove('grid-winner'));
      try {
        localStorage.removeItem('lotto_participants_' + roomCode);
      } catch(e) {}
      updateStats();
      if (mqttClient && mqttClient.connected) {
        mqttClient.publish(`qrlotto/${roomCode}/winner`, JSON.stringify({ winners: [] }), { retain: true });
      }
    }
  };

  // Sound Toggle
  window.toggleSound = function() {
    if (!window.sounds) return;
    window.sounds.enabled = !window.sounds.enabled;
    const btn = document.getElementById('soundToggleBtn');
    btn.textContent = window.sounds.enabled ? '🔊 Звук: Вкл' : '🔇 Звук: Выкл';
  };

  // Fullscreen Toggle
  window.toggleFullscreen = function() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Target count edit
  const targetInput = document.getElementById('targetInput');
  if (targetInput) {
    targetInput.value = targetCount;
    targetInput.addEventListener('change', (e) => {
      const val = parseInt(e.target.value);
      if (val > 0) {
        targetCount = val;
        updateStats();
      }
    });
  }

  // Event Listeners
  launchBtn.addEventListener('click', () => {
    startLottery();
  });

  // Restore saved participants
  try {
    const saved = localStorage.getItem('lotto_participants_' + roomCode);
    if (saved) {
      const list = JSON.parse(saved);
      if (Array.isArray(list)) {
        list.forEach(p => {
          if (!participants.find(x => x.id === p.id || x.name.toLowerCase() === p.name.toLowerCase())) {
            participants.push(p);
            renderParticipantCard(p);
          }
        });
      }
    }
  } catch(e) {}

  // Init
  updateStats();
  setupRealtime();
})();
