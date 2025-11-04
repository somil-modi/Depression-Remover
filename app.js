// Utility: qs
const qs = (s, el = document) => el.querySelector(s);
const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

// State
const state = {
  apiKey: localStorage.getItem('openai_api_key') || '',
  chat: [],
  medScript: '',
  moods: JSON.parse(localStorage.getItem('moods') || '[]'),
};
const BACKEND_URL = localStorage.getItem('backend_url') || 'http://127.0.0.1:8000';

// Init
window.addEventListener('DOMContentLoaded', () => {
  qs('#year').textContent = new Date().getFullYear();
  wirePanels();
  wireHero();
  wireChat();
  wireMeditation();
  wireMood();
  wireSettings();
  wireContact();
});

// Panel show/hide
function wirePanels() {
  qsa('[data-open]').forEach(btn => btn.addEventListener('click', () => openPanel(btn.getAttribute('data-open'))));
  qsa('[data-close]').forEach(btn => btn.addEventListener('click', closePanel));
  ['panel-chat', 'panel-meditation', 'panel-mood', 'panel-settings']
    .forEach(id => qs(`#${id}`)?.addEventListener('click', (e) => { if (e.target.classList.contains('panel')) e.target.hidden = true; }));
}
function openPanel(id) { qs(`#${id}`).hidden = false; }
function closePanel(e) { e.currentTarget.closest('.panel').hidden = true; }

function wireHero() {
  qs('#startTherapy').addEventListener('click', () => openPanel('panel-chat'));
  qs('#startTherapyTop').addEventListener('click', () => openPanel('panel-chat'));
  qs('#openSettings').addEventListener('click', () => openPanel('panel-settings'));
}

// CHAT: AI Therapist (CBT-guided + optional OpenAI)
function wireChat() {
  const chatWindow = qs('#chatWindow');
  const chatForm = qs('#chatForm');
  const input = qs('#chatText');

  // Welcome message
  pushAI("I'm here with you. What feels heavy today? You can type anything.");

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    pushUser(text);
    scrollToEnd();
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.textContent = 'Calm AI is typing…';
    chatWindow.appendChild(typing);
    const reply = await therapistReply(text);
    chatWindow.removeChild(typing);
    pushAI(reply);
    scrollToEnd();
  });

  function pushUser(text) { push('user', text); }
  function pushAI(text) { push('ai', text); }
  function push(role, text) {
    state.chat.push({ role, text, time: Date.now() });
    const div = document.createElement('div');
    div.className = `bubble bubble--${role === 'user' ? 'user' : 'ai'}`;
    div.textContent = text;
    chatWindow.appendChild(div);
  }
  function scrollToEnd() { chatWindow.scrollTop = chatWindow.scrollHeight; }
}

async function therapistReply(userText) {
  // Crisis safety check
  const crisis = /(suicide|kill myself|end my life|self[- ]?harm|hurt myself|overdose)/i;
  if (crisis.test(userText)) {
    return "I'm really glad you told me. If you're in immediate danger, please call your local emergency number now. You can also reach your local hotline: https://www.opencounseling.com/suicide-hotlines. If you want, tell me where you are and I can try to help find resources.";
  }

  // Fallback: local CBT-style response
  const localCBT = () => {
    const emotion = detectEmotion(userText);
    const validation = {
      sadness: "That sounds really heavy. It's okay to feel this way.",
      anxiety: "That sounds tense and overwhelming. Your nervous system is working hard.",
      anger: "It makes sense you'd feel upset given what happened.",
      guilt: "You're being hard on yourself; that shows you care.",
      hopeless: "When things feel stuck, hope can feel far away—and that's understandable.",
      neutral: "Thanks for sharing what’s going on.",
    }[emotion];

    const strategyByEmotion = {
      sadness: "Try a two‑minute activation: stand, stretch, drink water. Tiny motion can shift mood a bit.",
      anxiety: "Try 4‑6 breathing: inhale 4, hold 2, exhale 6, repeat x4 to signal safety.",
      anger: "Try a quick body scan—notice jaw, shoulders, hands—and release tension on the exhale.",
      guilt: "Ask: what would you say to a close friend in this situation?",
      hopeless: "List one thing that’s slightly in your control today.",
      neutral: "What outcome would feel 1% better than now?",
    }[emotion];

    const question = {
      sadness: "What’s one small comfort you can offer yourself right now?",
      anxiety: "What’s the specific worry your mind is looping on?",
      anger: "What boundary or value felt crossed?",
      guilt: "What evidence supports a kinder interpretation?",
      hopeless: "What tiny step is doable in under 2 minutes?",
      neutral: "What would you like to be different by tonight?",
    }[emotion];

    return `${shortReflect(userText)} ${validation} ${strategyByEmotion} ${question}`;
  };

  function shortReflect(text) {
    const t = text.slice(0, 160);
    return `Thanks for sharing. It sounds like: “${t}”.`;
  }

  function detectEmotion(text) {
    const s = text.toLowerCase();
    const has = (arr) => arr.some(k => s.includes(k));
    if (has(['suicid', 'end my life', 'kill myself'])) return 'hopeless';
    if (has(['anxious','panic','nervous','worry','worried','overwhelmed','stress'])) return 'anxiety';
    if (has(['sad','down','empty','cry','alone','lonely','depress'])) return 'sadness';
    if (has(['angry','mad','furious','hate','resent'])) return 'anger';
    if (has(['guilty','my fault','blame myself','ashamed','shame'])) return 'guilt';
    if (has(['hopeless','no point','nothing matters'])) return 'hopeless';
    return 'neutral';
  }

  // If API key present, try OpenAI
  // Prefer Python backend if available
  try {
    const res = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: state.chat.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
        user_input: userText,
      })
    });
    if (res.ok) {
      const json = await res.json();
      return json.reply || localCBT();
    }
  } catch (e) { /* fall back */ }

  const key = state.apiKey;
  if (!key) return localCBT();

  try {
    const sys = "You are a supportive, concise mental health assistant using CBT and motivational interviewing. Be validating, practical, and safe. Avoid diagnosing. Encourage help-seeking if crisis.";
    // Build conversation history for better context (last 10 messages)
    const history = state.chat.slice(-10).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: sys }, ...history, { role: 'user', content: userText }],
        temperature: 0.7,
      })
    });
    if (!res.ok) throw new Error('API error');
    const json = await res.json();
    const msg = json.choices?.[0]?.message?.content?.trim();
    return msg || localCBT();
  } catch (e) {
    return localCBT();
  }
}

// Meditation
function wireMeditation() {
  const form = qs('#medForm');
  const scriptEl = qs('#medScript');
  const play = qs('#medPlay');
  const pause = qs('#medPause');
  const stop = qs('#medStop');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const goal = qs('#medGoal').value;
    const minutes = Number(qs('#medDuration').value);
    const script = await generateMeditation(goal, minutes);
    state.medScript = script;
    scriptEl.textContent = script;
  });

  play.addEventListener('click', () => speak(state.medScript));
  pause.addEventListener('click', () => window.speechSynthesis.pause());
  stop.addEventListener('click', () => { window.speechSynthesis.cancel(); });
}

async function generateMeditation(goal, minutes) {
  const base = {
    grounding: "Start by noticing the support beneath you. Breathe slowly. Name 5 things you see, 4 you can touch, 3 you hear, 2 you smell, 1 you taste.",
    self_compassion: "Place a hand on your heart. Say: This is tough. May I be kind to myself. May I give myself what I need.",
    sleep: "Dim the inner screen. With each breath, imagine a wave of softness moving from toes to head. Thoughts drift like clouds.",
    focus: "Bring attention to the breath at the nose. When attention wanders, gently escort it back, like guiding a friend.",
  };

  const localGen = () => `${base[goal]} Continue with gentle breathing at a pace that feels safe. Over ${minutes} minutes, repeat slow inhales and longer exhales. When thoughts arise, note them and return to the breath.`;

  if (!state.apiKey) return localGen();
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Create short, gentle guided meditations. Keep sentences brief and soothing.' },
          { role: 'user', content: `Goal: ${goal}. Duration: ${minutes} minutes. Generate a script.` }
        ],
        temperature: 0.7,
      })
    });
    if (!res.ok) throw new Error('API error');
    const json = await res.json();
    return json.choices?.[0]?.message?.content?.trim() || localGen();
  } catch { return localGen(); }
}

// Simple speech synthesis
function speak(text) {
  if (!text) return;
  if (!('speechSynthesis' in window)) { alert('Speech not supported on this device.'); return; }
  window.speechSynthesis.cancel();
  const chunks = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const voice = window.speechSynthesis.getVoices().find(v => /en-US|en_GB/.test(v.lang)) || null;
  chunks.forEach((chunk, i) => {
    const utter = new SpeechSynthesisUtterance(chunk.trim());
    if (voice) utter.voice = voice;
    utter.rate = 0.95; utter.pitch = 1.02; utter.volume = 1;
    utter.onend = () => { /* could highlight progress */ };
    setTimeout(() => window.speechSynthesis.speak(utter), i * 100);
  });
}

// Mood Tracker
function wireMood() {
  const form = qs('#moodForm');
  const list = qs('#moodList');
  const render = () => {
    list.innerHTML = '';
    state.moods
      .slice().reverse()
      .forEach(entry => {
        const row = document.createElement('div');
        row.className = 'mood__item';
        const d = new Date(entry.date);
        row.innerHTML = `
          <div>
            <div class="mood__pill pill-${entry.value}">Mood ${entry.value}</div>
            <div class="muted">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</div>
          </div>
          <div>${entry.note ? entry.note : ''}</div>
        `;
        list.appendChild(row);
      });
  };
  render();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = Number(qs('#moodValue').value);
    const note = qs('#moodNote').value.trim().slice(0, 140);
    state.moods.push({ value, note, date: new Date().toISOString() });
    localStorage.setItem('moods', JSON.stringify(state.moods));
    qs('#moodNote').value = '';
    render();
  });
}

// Settings
function wireSettings() {
  const form = qs('#settingsForm');
  const keyInput = qs('#openaiKey');
  const backendInput = qs('#backendUrl');
  keyInput.value = state.apiKey;
  backendInput.value = BACKEND_URL;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    state.apiKey = keyInput.value.trim();
    if (state.apiKey) localStorage.setItem('openai_api_key', state.apiKey);
    else localStorage.removeItem('openai_api_key');
    const url = backendInput.value.trim() || 'http://127.0.0.1:8000';
    localStorage.setItem('backend_url', url);
    alert('Settings saved locally.');
  });
}

function wireContact() {
  const form = qs('#contactForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('Thanks for reaching out! We will reply via email (demo).');
    form.reset();
  });
}


