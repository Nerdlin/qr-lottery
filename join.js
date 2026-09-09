// Mobile Participant Logic - Supports GitHub Pages (WSS/MQTT EMQX) & Local Node.js (Socket.IO)

(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = urlParams.get('room') || 'EVENT-1';

  // Elements
  const roomLabel = document.getElementById('roomLabel');
  const formSection = document.getElementById('formSection');
  const joinedSection = document.getElementById('joinedSection');
  const winnerSection = document.getElementById('winnerSection');
  const joinForm = document.getElementById('joinForm');
  const nameInput = document.getElementById('nameInput');
  const submitBtn = document.getElementById('submitBtn');

  // Preview elements
  const userAvatar = document.getElementById('userAvatar');
  const userNamePreview = document.getElementById('userNamePreview');
  const winnerPlace = document.getElementById('winnerPlace');
  const winnerName = document.getElementById('winnerName');

  if (roomLabel) roomLabel.textContent = roomCode;

  // Sound manager instance for phone
  const audioCtx = window.AudioContext || window.webkitAudioContext ? new (window.AudioContext || window.webkitAudioContext)() : null;
  function playCelebrationFanfare() {
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.1);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + idx * 0.1 + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + idx * 0.1);
        osc.stop(audioCtx.currentTime + idx * 0.1 + 0.55);
      });
    } catch(e) {}
  }

  // Local storage cache
  const storageKey = 'qrlotto_user_' + roomCode;
  let currentUser = null;
  try {
    const cached = localStorage.getItem(storageKey);
    if (cached) {
      currentUser = JSON.parse(cached);
    }
  } catch(e) {}

  function getInitials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function showJoinedState(user) {
    formSection.style.display = 'none';
    winnerSection.style.display = 'none';
    joinedSection.style.display = 'flex';

    userAvatar.textContent = getInitials(user.name);
    userNamePreview.textContent = user.name;
  }

  function showWinnerState(winnerData) {
    formSection.style.display = 'none';
    joinedSection.style.display = 'none';
    winnerSection.style.display = 'flex';

    winnerName.textContent = currentUser ? currentUser.name : '';
    const medals = { 1: '🥇 1 МЕСТО (Золото)', 2: '🥈 2 МЕСТО (Серебро)', 3: '🥉 3 МЕСТО (Бронза)' };
    winnerPlace.textContent = medals[winnerData.place] || `🏆 ${winnerData.place} МЕСТО`;

    if (navigator.vibrate) {
      navigator.vibrate([300, 150, 300, 150, 600]);
    }
    playCelebrationFanfare();

    if (typeof confetti !== 'undefined') {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.5 }
      });
    }
  }

  if (currentUser) {
    showJoinedState(currentUser);
  }

  // Real-time communication (Fast EMQX WSS Broker)
  let mqttClient = null;
  let socket = null;
  let pendingUserData = null;

  function doPublish(data) {
    if (!data) return;
    const payload = JSON.stringify(data);
    if (socket) {
      socket.emit('participant_join', data);
    }
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(`qrlotto/${roomCode}/join`, payload, { qos: 1 });
      mqttClient.publish(`qrlotto/EVENT-1/join`, payload, { qos: 1 });
      mqttClient.publish(`qrlotto/all/join`, payload, { qos: 1 });
    } else {
      pendingUserData = data;
    }
  }

  window.resendJoin = function() {
    if (currentUser) {
      doPublish(currentUser);
      const btn = document.getElementById('resendBtn');
      if (btn) {
        btn.textContent = '✓ Отправлено на экран!';
        setTimeout(() => { btn.textContent = '🔄 Я не на экране? Нажмите здесь'; }, 2000);
      }
    }
  };

  function initRealtime() {
    if (typeof io !== 'undefined') {
      socket = io();
      return;
    }

    if (typeof mqtt !== 'undefined') {
      const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
      const clientId = 'lottery_user_' + Math.random().toString(16).substr(2, 8);

      mqttClient = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 2000
      });

      const winnerTopic = `qrlotto/${roomCode}/winner`;

      mqttClient.on('connect', () => {
        mqttClient.subscribe(winnerTopic, { qos: 1 });
        mqttClient.subscribe(`qrlotto/+/winner`, { qos: 1 });

        if (pendingUserData) {
          doPublish(pendingUserData);
          pendingUserData = null;
        } else if (currentUser) {
          doPublish(currentUser);
        }
      });

      mqttClient.on('message', (topic, message) => {
        try {
          if (topic.endsWith('/winner')) {
            const data = JSON.parse(message.toString());
            if (data && data.winners && currentUser) {
              const myWin = data.winners.find(w => 
                (w.id && w.id === currentUser.id) || 
                (w.name.toLowerCase() === currentUser.name.toLowerCase())
              );
              if (myWin) {
                showWinnerState(myWin);
              }
            }
          }
        } catch (e) {}
      });
    }
  }

  // Handle Form Submit
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    if (!name) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправка...';

    const userId = 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const userData = {
      id: userId,
      name: name,
      room: roomCode
    };

    currentUser = userData;
    try {
      localStorage.setItem(storageKey, JSON.stringify(userData));
    } catch(e) {}

    doPublish(userData);
    setTimeout(() => doPublish(userData), 800);
    setTimeout(() => doPublish(userData), 2000);

    showJoinedState(userData);
  });

  initRealtime();
})();
