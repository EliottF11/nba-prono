/**
 * HOOPS PRONO - Logique applicative
 * Interface sportive épurée, sélection 1-clic et classement en direct.
 */

const state = {
  currentUser: null,
  activeTab: 'matches',
  matchesFilter: 'all',
  selectedWeek: 'all',
  availableWeeks: [],
  matches: [],
  myPredictions: {}, // matchId -> selectedTeamId
  boostedPredictions: {}, // matchId -> boolean (is_boosted)
  leaderboard: [],
  seasonPrediction: null,
  seasonCandidates: null,
  myLeagues: [],
  activeLeague: null,
  activeLeagueVotesMatchId: null,
  activeLeagueVotesLeagueId: null,
  leagueMessages: {},
  chatPollingInterval: null,
  authMode: 'login',
  // État de la pile de cartes Tinder
  tinderDeckIndex: 0,
  swipeHistory: [], // { match, matchId, previousVote, chosenTeamId, direction }
  matchesViewMode: 'tinder', // 'tinder' (par défaut) ou 'list'
  currentStreak: 0
};

// Fonction utilitaire d'échappement HTML anti-XSS
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

// Formatage robuste des heures pour le chat (compatible ISO et SQLite)
function formatChatTime(dateStr) {
  if (!dateStr) return '';
  const cleanStr = String(dateStr).includes('T') ? dateStr : String(dateStr).replace(' ', 'T') + (String(dateStr).includes('Z') ? '' : 'Z');
  const d = new Date(cleanStr);
  if (isNaN(d.getTime())) return '';
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
window.formatChatTime = formatChatTime;

// --- Splash Screen Professionnel ---
let splashDismissed = false;

function initSplashScreen() {
  const statusEl = document.getElementById('splash-status-text');

  setTimeout(() => {
    if (statusEl && !splashDismissed) {
      statusEl.textContent = "Synchronisation des cotes NBA...";
    }
  }, 600);

  setTimeout(() => {
    if (statusEl && !splashDismissed) {
      statusEl.textContent = "Coup d'envoi imminent !";
    }
  }, 1250);

  setTimeout(() => {
    dismissSplashScreen();
  }, 1850);
}

function dismissSplashScreen() {
  splashDismissed = true;

  const splash = document.getElementById('app-splash-screen');
  if (splash) {
    splash.classList.add('splash-exit');
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    splash.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    splash.style.transform = 'scale(1.02) translateY(-20px)';
    setTimeout(() => {
      splash.classList.remove('flex');
      splash.classList.add('hidden');
      splash.style.display = 'none';

      // Si l'utilisateur n'est pas connecté et première visite, ouvrir le portail d'accueil
      if (!state.currentUser && !sessionStorage.getItem('hoops_welcome_shown')) {
        sessionStorage.setItem('hoops_welcome_shown', 'true');
        openAuthModal('welcome');
      }
    }, 380);
  }
}
window.dismissSplashScreen = dismissSplashScreen;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    registerServiceWorker();
    initSplashScreen();
    initUIEvents();
    await checkSession();
    loadSeasonCandidates();
    await refreshData();
  } catch (err) {
    console.error("Erreur cycle d'initialisation:", err);
  } finally {
    // Évacuation garantie du splash screen
    setTimeout(dismissSplashScreen, 500);
  }

  // Détection automatique d'un code de ligue d'invitation dans l'URL (?join=XXXXXX)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get('join');
    if (joinCode && joinCode.trim().length === 6) {
      selectTab('leagues');
      openJoinLeagueModal(joinCode.trim().toUpperCase());
    }
  } catch (e) {}
});

// --- Événements UI ---
function initUIEvents() {
  // Onglets de navigation basse
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      selectTab(tab);
    });
  });

  // Filtres de statut de match (Neo-Brutalistes)
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => {
        c.classList.remove('active', 'bg-[#D95D39]', 'text-white', 'bg-white', 'text-black');
        c.classList.add('bg-[#18181e]', 'text-zinc-300');
      });
      chip.classList.add('active', 'bg-[#D95D39]', 'text-white');
      chip.classList.remove('bg-[#18181e]', 'text-zinc-300', 'bg-[#141418]', 'text-zinc-400');
      state.matchesFilter = chip.getAttribute('data-filter');
      state.tinderDeckIndex = 0;
      state.swipeHistory = [];
      renderMatchesList();
    });
  });

  // Raccourcis clavier pour le Swipe Tinder (Flèches gauche/droite et z/backspace pour Undo)
  window.addEventListener('keydown', (e) => {
    if (state.activeTab !== 'matches') return;
    if (state.matchesViewMode !== 'tinder') return;
    if (document.querySelector('.modal:not(.hidden), .auth-modal:not(.hidden)')) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      programmaticSwipe('left');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      programmaticSwipe('right');
    } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
      if (state.swipeHistory && state.swipeHistory.length > 0) {
        e.preventDefault();
        undoLastSwipe();
      }
    }
  });

  // Gestion modale pronostics d'avant-saison (Chantier 3)
  const closeSeasonBtn = document.getElementById('close-season-modal');
  const seasonForm = document.getElementById('season-form');
  if (closeSeasonBtn) closeSeasonBtn.addEventListener('click', closeSeasonModal);
  if (seasonForm) seasonForm.addEventListener('submit', handleSeasonSubmit);

  // Gestion modales Ligues Privées (Chantier 5)
  const openCreateLeagueBtn = document.getElementById('btn-open-create-league');
  const closeCreateLeagueBtn = document.getElementById('close-create-league-modal');
  const createLeagueForm = document.getElementById('create-league-form');
  if (openCreateLeagueBtn) openCreateLeagueBtn.addEventListener('click', openCreateLeagueModal);
  if (closeCreateLeagueBtn) closeCreateLeagueBtn.addEventListener('click', closeCreateLeagueModal);
  if (createLeagueForm) createLeagueForm.addEventListener('submit', handleCreateLeagueSubmit);

  const openJoinLeagueBtn = document.getElementById('btn-open-join-league');
  const closeJoinLeagueBtn = document.getElementById('close-join-league-modal');
  const joinLeagueForm = document.getElementById('join-league-form');
  if (openJoinLeagueBtn) openJoinLeagueBtn.addEventListener('click', () => openJoinLeagueModal());
  if (closeJoinLeagueBtn) closeJoinLeagueBtn.addEventListener('click', closeJoinLeagueModal);
  if (joinLeagueForm) joinLeagueForm.addEventListener('submit', handleJoinLeagueSubmit);

  // Gestion modale Transparence des pronostics de ligue (Signature MPP)
  const closeLmvBtn = document.getElementById('close-league-match-votes-modal');
  const lmvSelect = document.getElementById('lmv-league-select');
  if (closeLmvBtn) closeLmvBtn.addEventListener('click', closeLeagueMatchVotesModal);
  if (lmvSelect) {
    lmvSelect.addEventListener('change', () => {
      const selectedLeagueId = parseInt(lmvSelect.value);
      if (selectedLeagueId && state.activeLeagueVotesMatchId) {
        state.activeLeagueVotesLeagueId = selectedLeagueId;
        openLeagueMatchVotesModal(state.activeLeagueVotesMatchId, selectedLeagueId);
      }
    });
  }

  // Gestion modale Bilan Partageable
  const closeRecapBtn = document.getElementById('close-share-recap-modal');
  const nativeShareBtn = document.getElementById('btn-native-share');
  const copyRecapBtn = document.getElementById('btn-copy-recap-text');
  if (closeRecapBtn) closeRecapBtn.addEventListener('click', closeShareRecapModal);
  if (nativeShareBtn) nativeShareBtn.addEventListener('click', handleNativeShareRecap);
  if (copyRecapBtn) copyRecapBtn.addEventListener('click', handleCopyRecapText);
}

// --- Session & Utilisateur ---
async function checkSession() {
  try {
    const user = await API.getMe();
    state.currentUser = user;
    try {
      const stats = await API.getMyStats();
      if (stats && stats.current_streak !== undefined) {
        state.currentStreak = stats.current_streak;
      }
    } catch (e) {}
  } catch {
    state.currentUser = null;
    state.currentStreak = 0;
  }
  updateHeaderUser();
}

function updateHeaderUser() {
  const container = document.getElementById('auth-btn-container');
  const scoreBadge = document.getElementById('user-score-badge');
  const scoreVal = document.getElementById('user-points-val');

  if (state.currentUser) {
    scoreBadge.classList.remove('hidden');
    scoreVal.textContent = state.currentUser.total_points.toFixed(1);

    container.innerHTML = `
      <button onclick="handleLogout()" title="Clique pour te déconnecter" class="btn-tactile flex items-center space-x-1.5 bg-[#141418] hover:bg-[#202026] border border-[rgba(255,255,255,0.12)] px-2 sm:px-2.5 py-1 rounded-lg text-xs font-bold text-white transition cursor-pointer">
        <span class="w-1.5 h-1.5 rounded-full bg-white shrink-0"></span>
        <span class="max-w-[60px] sm:max-w-[90px] truncate text-[11px] sm:text-xs">${state.currentUser.username}</span>
      </button>
    `;
    updateStreakUI(state.currentStreak || 0);
  } else {
    scoreBadge.classList.add('hidden');
    container.innerHTML = `
      <button onclick="openAuthModal('login')" class="btn-tactile bg-white hover:bg-zinc-200 text-black font-condensed font-black text-xs uppercase px-2.5 sm:px-3.5 py-1.5 rounded-lg transition cursor-pointer shadow-md shrink-0">
        Connexion
      </button>
    `;
    updateStreakUI(0);
  }
}

// Mise à jour visuelle du badge Streak (Série de victoires consécutives)
function updateStreakUI(streakCount = 0) {
  const streakBadge = document.getElementById('user-streak-badge');
  const streakVal = document.getElementById('user-streak-val');
  const flameEl = streakBadge ? streakBadge.querySelector('.streak-flame') : null;

  if (streakVal) {
    streakVal.textContent = (streakCount || 0).toString();
  }

  if (streakBadge) {
    if (streakCount > 0) {
      streakBadge.classList.add('streak-active');
      if (flameEl) flameEl.classList.add('streak-burning');
    } else {
      streakBadge.classList.remove('streak-active', 'streak-on-fire');
      if (flameEl) flameEl.classList.remove('streak-burning');
    }

    if (streakCount >= 3) {
      streakBadge.classList.add('streak-on-fire');
    } else {
      streakBadge.classList.remove('streak-on-fire');
    }
  }
}
window.updateStreakUI = updateStreakUI;

function handleLogout() {
  if (confirm(`Se déconnecter du compte ${state.currentUser.username} ?`)) {
    API.logout();
    state.currentUser = null;
    state.currentStreak = 0;
    state.myPredictions = {};
    state.boostedPredictions = {};
    state.seasonPrediction = null;
    updateHeaderUser();
    updateStreakUI(0);
    renderSeasonBanner();
    renderMatchesList();
    renderLeaderboard();
    if (state.activeTab === 'profile') renderProfile();
    notify("Déconnexion réussie");
  }
}

// --- Navigation ---
function selectTab(tab) {
  state.activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isCurrent = btn.getAttribute('data-tab') === tab;
    btn.classList.toggle('active', isCurrent);
    btn.classList.toggle('text-white', isCurrent);
    btn.classList.toggle('text-zinc-500', !isCurrent);
    const icon = btn.querySelector('svg');
    if (icon) {
      if (isCurrent) icon.classList.remove('opacity-50', 'scale-90');
      else icon.classList.add('opacity-50', 'scale-90');
    }
    if (isCurrent) {
      btn.classList.remove('tab-rebound');
      void btn.offsetWidth;
      btn.classList.add('tab-rebound');
    } else {
      btn.classList.remove('tab-rebound');
    }
  });

  const matchesView = document.getElementById('matches-view');
  const resultsView = document.getElementById('results-view');
  const leaguesView = document.getElementById('leagues-view');
  const leaderboardView = document.getElementById('leaderboard-view');
  const profileView = document.getElementById('profile-view');

  if (matchesView) {
    matchesView.classList.toggle('hidden', tab !== 'matches');
    matchesView.style.display = tab === 'matches' ? '' : 'none';
  }
  if (resultsView) {
    resultsView.classList.toggle('hidden', tab !== 'results');
    resultsView.style.display = tab === 'results' ? '' : 'none';
  }
  if (leaguesView) {
    leaguesView.classList.toggle('hidden', tab !== 'leagues');
    leaguesView.style.display = tab === 'leagues' ? '' : 'none';
  }
  if (leaderboardView) {
    leaderboardView.classList.toggle('hidden', tab !== 'leaderboard');
    leaderboardView.style.display = tab === 'leaderboard' ? '' : 'none';
  }
  if (profileView) {
    profileView.classList.toggle('hidden', tab !== 'profile');
    profileView.style.display = tab === 'profile' ? '' : 'none';
  }

  // Mise en retrait du footer mentions légales : masqué sur swipe matches, visible tout en bas sur les autres vues
  const appLegalFooter = document.getElementById('app-legal-footer') || document.querySelector('footer');
  if (appLegalFooter) {
    appLegalFooter.classList.toggle('hidden', tab === 'matches');
    appLegalFooter.style.display = tab === 'matches' ? 'none' : '';
  }

  if (tab !== 'leagues' && state.chatPollingInterval) {
    clearInterval(state.chatPollingInterval);
    state.chatPollingInterval = null;
  }

  if (tab === 'results') {
    renderResultsView();
  } else if (tab === 'leaderboard') {
    renderLeaderboard();
  } else if (tab === 'profile') {
    renderProfile();
  } else if (tab === 'leagues') {
    loadAndRenderLeagues();
  }
}

// --- Portail d'Accueil & Authentification Professionnelle ---
let availableAvatarsCache = null;
let selectedSignupAvatarUrl = '/static/avatars/wembanyama_spurs.jpg';

async function fetchAvatarsList() {
  if (availableAvatarsCache && Array.isArray(availableAvatarsCache) && availableAvatarsCache.length > 0) {
    return availableAvatarsCache;
  }
  try {
    if (typeof API !== 'undefined' && API.getAvatars) {
      availableAvatarsCache = await API.getAvatars();
    } else {
      const res = await fetch('/api/auth/avatars');
      availableAvatarsCache = await res.json();
    }
  } catch (e) {
    console.warn("Erreur chargement avatars via API, tentative fetch direct:", e);
    try {
      const res = await fetch('/api/auth/avatars');
      availableAvatarsCache = await res.json();
    } catch (err2) {
      console.error("Échec fallback fetch avatars:", err2);
      availableAvatarsCache = [];
    }
  }
  return availableAvatarsCache || [];
}

async function populateWelcomeAvatars() {
  const avatars = await fetchAvatarsList();
  const track = document.getElementById('welcome-avatars-track');
  const picker = document.getElementById('reg-avatars-picker');

  if (track && avatars.length > 0 && track.children.length === 0) {
    // Doubler la liste pour créer la boucle infinie de défilement continu
    const doubled = [...avatars, ...avatars];
    track.innerHTML = doubled.map(av => `
      <div class="flex flex-col items-center gap-1 shrink-0 select-none">
        <img src="${av.url}" alt="${escapeHtml(av.title)}" class="w-11 h-11 rounded-xl object-cover border border-white/20 bg-[#18181b] shadow-sm" />
        <span class="text-[9px] font-condensed font-bold text-zinc-300 max-w-[56px] truncate text-center">${escapeHtml(av.title.split(' ').pop())}</span>
      </div>
    `).join('');
  }

  if (picker && avatars.length > 0 && picker.children.length === 0) {
    picker.innerHTML = avatars.map(av => {
      const isSelected = av.url === selectedSignupAvatarUrl;
      return `
        <div onclick="selectSignupAvatar('${av.url}', '${escapeHtml(av.title)}')" class="avatar-signup-item flex flex-col items-center gap-1 p-1.5 rounded-xl border bg-[#141418] hover:bg-[#1e1e24] shrink-0 transition select-none ${
          isSelected ? 'selected bg-white/10 border-white' : 'border-white/10 hover:border-white/30'
        }" style="width: 72px;">
          <div class="relative">
            <img src="${av.url}" alt="${escapeHtml(av.title)}" class="w-12 h-12 rounded-xl object-cover border ${isSelected ? 'border-white' : 'border-white/20'} bg-[#18181b]" />
            ${isSelected ? `<span class="absolute -top-1 -right-1 bg-white text-black text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold shadow"><svg class="lucide-inline lucide-xs lucide-green" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>` : ""}
          </div>
          <span class="text-[10px] font-condensed font-bold text-zinc-300 truncate w-full text-center leading-tight">${escapeHtml(av.title.split(' ').pop())}</span>
        </div>
      `;
    }).join('');
  }
}

function selectSignupAvatar(url, title) {
  selectedSignupAvatarUrl = url;
  const label = document.getElementById('reg-selected-avatar-label');
  if (label) label.textContent = title;

  const picker = document.getElementById('reg-avatars-picker');
  if (picker) {
    picker.querySelectorAll('.avatar-signup-item').forEach(item => {
      const isCurrent = item.innerHTML.includes(url);
      item.classList.toggle('selected', isCurrent);
      item.classList.toggle('border-white', isCurrent);
      item.classList.toggle('bg-white/10', isCurrent);
    });
  }
}

function switchAuthView(view = 'welcome') {
  const views = {
    welcome: document.getElementById('auth-view-welcome'),
    register: document.getElementById('auth-view-register'),
    login: document.getElementById('auth-view-login')
  };

  const errBox = document.getElementById('auth-error-box');
  if (errBox) errBox.classList.add('hidden');

  Object.keys(views).forEach(key => {
    if (views[key]) {
      if (key === view) {
        views[key].classList.remove('hidden');
      } else {
        views[key].classList.add('hidden');
      }
    }
  });

  if (view === 'register') {
    const input = document.getElementById('reg-username-input');
    if (input) setTimeout(() => input.focus(), 80);
  } else if (view === 'login') {
    const input = document.getElementById('login-identifier-input');
    if (input) setTimeout(() => input.focus(), 80);
  }
}

function openAuthModal(view = 'welcome') {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  switchAuthView(view);
  populateWelcomeAvatars();
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
  const errBox = document.getElementById('auth-error-box');
  if (errBox) errBox.classList.add('hidden');
}

async function handleRegisterSubmit(e) {
  if (e) e.preventDefault();
  const username = document.getElementById('reg-username-input').value.trim();
  const email = document.getElementById('reg-email-input').value.trim();
  const password = document.getElementById('reg-password-input').value;
  const errBox = document.getElementById('auth-error-box');
  const submitBtn = document.getElementById('reg-submit-btn');

  if (errBox) errBox.classList.add('hidden');

  if (username.length < 3) {
    if (errBox) {
      errBox.textContent = "Le pseudo doit contenir au moins 3 caractères.";
      errBox.classList.remove('hidden');
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <span class="inline-flex items-center gap-2">
        <img src="/static/icons/logo-secondaire.png" class="arcade-ball-loader-sm" alt="" />
        Création de ton compte...
      </span>
    `;
  }

  try {
    const res = await API.register(username, email, password, selectedSignupAvatarUrl);
    state.currentUser = res.user;
    updateHeaderUser();
    closeAuthModal();
    if (typeof launchConfetti === 'function') {
      launchConfetti();
    }
    notify(`Bienvenue sur le parquet, ${res.user.username} !`, 'success');
    await refreshData();
    if (state.activeTab === 'profile') renderProfile();
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message || "Erreur lors de la création de compte.";
      errBox.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `Créer mon compte & Jouer `;
    }
  }
}

async function handleLoginSubmit(e) {
  if (e) e.preventDefault();
  const identifier = document.getElementById('login-identifier-input').value.trim();
  const password = document.getElementById('login-password-input').value;
  const errBox = document.getElementById('auth-error-box');
  const submitBtn = document.getElementById('login-submit-btn');

  if (errBox) errBox.classList.add('hidden');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <span class="inline-flex items-center gap-2">
        <img src="/static/icons/logo-secondaire.png" class="arcade-ball-loader-sm" alt="" />
        Connexion en cours...
      </span>
    `;
  }

  try {
    const res = await API.login(identifier, password);
    state.currentUser = res.user;
    updateHeaderUser();
    closeAuthModal();
    if (typeof launchConfetti === 'function') {
      launchConfetti();
    }
    notify(`Ravi de te revoir, ${res.user.username} !`, 'success');
    await refreshData();
    if (state.activeTab === 'profile') renderProfile();
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message || "Identifiant ou mot de passe incorrect.";
      errBox.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `Se connecter`;
    }
  }
}

window.switchAuthView = switchAuthView;
window.selectSignupAvatar = selectSignupAvatar;
window.handleRegisterSubmit = handleRegisterSubmit;
window.handleLoginSubmit = handleLoginSubmit;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;

// --- Chargement des données ---
async function refreshData() {
  try {
    const promises = [
      API.getMatches(state.matchesFilter, state.selectedWeek),
      API.getMyPredictions(),
      API.getLeaderboard(),
      API.getWeeks()
    ];
    if (state.currentUser) {
      promises.push(API.getSeasonPrediction());
    }

    const results = await Promise.all(promises);
    const matches = results[0];
    const preds = results[1];
    const leaderboard = results[2];
    const weeks = results[3];

    state.matches = matches;
    state.leaderboard = leaderboard;
    state.availableWeeks = weeks;
    state.seasonPrediction = state.currentUser ? results[4] : null;

    state.myPredictions = {};
    state.boostedPredictions = {};
    preds.forEach(p => {
      state.myPredictions[p.match_id] = p.selected_team_id;
      if (p.is_boosted) {
        state.boostedPredictions[p.match_id] = true;
      }
    });

    const openCount = matches.filter(m => m.status === 'upcoming').length;
    const countBadge = document.getElementById('open-matches-count');
    if (countBadge) {
      countBadge.textContent = `${openCount} OUVERT${openCount > 1 ? 'S' : ''}`;
    }

    

    // Calcul et mise à jour de la streak (Série de victoires)
    let streak = 0;
    if (state.currentUser) {
      try {
        const stats = await API.getMyStats();
        if (stats && stats.current_streak !== undefined) {
          streak = stats.current_streak;
        } else {
          streak = computeCurrentStreak(state.matches, state.myPredictions);
        }
      } catch (err) {
        streak = computeCurrentStreak(state.matches, state.myPredictions);
      }
    }
    state.currentStreak = streak;
    updateStreakUI(streak);

    renderSeasonBanner();
    renderWeeksSelector();
    
    renderMatchesList();
    renderLeaderboard();
  } catch (err) {
    console.error('Erreur chargement:', err);
    notify("Erreur lors de la synchronisation des données", "error");
  }
}

// Fonction de calcul de la série de victoires en cours
function computeCurrentStreak(matches, myPredictions) {
  if (!matches || !myPredictions) return 0;
  const finished = matches
    .filter(m => m.status === 'finished' && m.winner_team_id && myPredictions[m.id])
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  let currentStreak = 0;
  for (const m of finished) {
    if (myPredictions[m.id] === m.winner_team_id) {
      currentStreak++;
    } else {
      currentStreak = 0;
    }
  }
  return currentStreak;
}

// --- Rendu du Sélecteur de Semaines (Chantier 2) ---
function renderWeeksSelector() {
  const container = document.getElementById('weeks-selector');
  if (!container) return;

  const weeks = state.availableWeeks || [];
  let html = `
    <button 
      onclick="filterByWeek('all')" 
      class="btn-tactile shrink-0 px-2.5 py-1 rounded-lg text-xs font-condensed font-bold uppercase tracking-wider transition cursor-pointer ${
        state.selectedWeek === 'all' 
          ? 'bg-white text-black font-black shadow-sm' 
          : 'bg-[#141418] text-zinc-400 hover:text-white border border-[rgba(255,255,255,0.08)]'
      }"
    >
      Toutes
    </button>
  `;

  weeks.forEach(w => {
    const isSelected = String(state.selectedWeek) === String(w.week);
    html += `
      <button 
        onclick="filterByWeek(${w.week})" 
        class="btn-tactile shrink-0 px-2.5 py-1 rounded-lg text-xs font-condensed font-bold uppercase tracking-wider transition cursor-pointer whitespace-nowrap ${
          isSelected 
            ? 'bg-white text-black font-black shadow-sm' 
            : 'bg-[#141418] text-zinc-400 hover:text-white border border-[rgba(255,255,255,0.08)]'
        }"
      >
        Week ${w.week}
      </button>
    `;
  });

  container.innerHTML = html;
}

async function filterByWeek(week) {
  state.selectedWeek = week;
  state.tinderDeckIndex = 0;
  state.swipeHistory = [];
  renderWeeksSelector();
  
  try {
    const matches = await API.getMatches(state.matchesFilter, state.selectedWeek);
    state.matches = matches;
    renderMatchesList();
  } catch (err) {
    notify(err.message, "error");
  }
}

// Fonction utilitaire : conversion hex en rgba pour les overlays dynamiques
function hexToRgba(hex, alpha = 0.4) {
  if (!hex || typeof hex !== 'string') return `rgba(217, 93, 57, ${alpha})`;
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c.split('').map(x => x + x).join('');
  }
  const num = parseInt(c, 16);
  if (isNaN(num)) return `rgba(217, 93, 57, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Fonction utilitaire : pastilles de forme récente
function getTeamFormDotsHtml(formArray) {
  if (!formArray || !Array.isArray(formArray) || formArray.length === 0) return '';
  return formArray.map(r => r === 'W' 
    ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shadow-[0_0_4px_rgba(16,185,129,0.8)]"></span>' 
    : '<span class="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block shadow-[0_0_4px_rgba(244,63,94,0.8)]"></span>'
  ).join('');
}

// Récupération des matchs filtrés
function getFilteredMatches() {
  let filtered = state.matches;
  if (state.matchesFilter === 'upcoming') {
    filtered = filtered.filter(m => m.status === 'upcoming');
  } else if (state.matchesFilter === 'finished') {
    filtered = filtered.filter(m => m.status === 'finished');
  } else {
    // En mode Tinder ou par défaut, on place toujours les matchs ouverts (upcoming) en premier dans la pile
    const upcoming = filtered.filter(m => m.status === 'upcoming');
    const finished = filtered.filter(m => m.status === 'finished');
    filtered = upcoming.concat(finished);
  }
  return filtered;
}

// Changement du mode de vue des matchs ('tinder' ou 'list')
function setMatchesViewMode(mode) {
  state.matchesViewMode = mode;
  renderMatchesList();
}
window.setMatchesViewMode = setMatchesViewMode;

// Réinitialisation de la pile Tinder
function resetTinderDeck() {
  state.tinderDeckIndex = 0;
  if (navigator.vibrate) {
    try { navigator.vibrate(30); } catch (e) {}
  }
  renderMatchesList();
}
window.resetTinderDeck = resetTinderDeck;

// --- Rendu Principal des Matchs ---
function renderMatchesList() {
  const container = document.getElementById('matches-list');
  if (!container) return;

  const filtered = getFilteredMatches();

  if (state.matchesViewMode === 'list') {
    renderMatchesListView(container, filtered);
  } else {
    renderTinderDeck(container, filtered);
  }
}

// --- Compte à Rebours Digital Rétro (Gamification Arcade) ---
let retroCountdownInterval = null;

function startRetroCountdown(targetTimestamp) {
  if (retroCountdownInterval) {
    clearInterval(retroCountdownInterval);
    retroCountdownInterval = null;
  }

  function update() {
    const now = Date.now();
    let diff = Math.max(0, targetTimestamp - now);

    const hours = Math.floor(diff / (1000 * 60 * 60));
    diff -= hours * (1000 * 60 * 60);
    const minutes = Math.floor(diff / (1000 * 60));
    diff -= minutes * (1000 * 60);
    const seconds = Math.floor(diff / 1000);

    const hEl = document.getElementById('cd-hours');
    const mEl = document.getElementById('cd-minutes');
    const sEl = document.getElementById('cd-seconds');

    if (hEl && mEl && sEl) {
      hEl.textContent = hours.toString().padStart(2, '0');
      mEl.textContent = minutes.toString().padStart(2, '0');
      sEl.textContent = seconds.toString().padStart(2, '0');
    }
  }

  update();
  retroCountdownInterval = setInterval(update, 1000);
}

function getNextNbaNightTimestamp() {
  const d = new Date();
  d.setHours(d.getHours() + 6);
  return d.getTime();
}

// --- Rendu de la Pile Tinder (Style Clean Arcade Neo-Brutalisme) ---
function renderTinderDeck(container, filtered) {
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center bg-[#18181e] rounded-[10px] border-[3px] border-black shadow-[6px_6px_0px_#000000] text-zinc-400 text-xs font-semibold">
        Aucun match dans cette catégorie.
      </div>
    `;
    return;
  }

  const total = filtered.length;
  const currentIndex = state.tinderDeckIndex;
  const hasHistory = state.swipeHistory && state.swipeHistory.length > 0;

  // Compatibilité tests : setMatchesViewMode
  const toolbarHtml = '';

  // Cas où tous les matchs ont été swipés : Écran Empty State Arcade avec Compte à Rebours Rétro & Bouton Récap
  if (currentIndex >= total) {
    const upcomingMatches = state.matches
      .filter(m => m.status === 'upcoming')
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    const nextDeadline = upcomingMatches.length > 0 
      ? new Date(upcomingMatches[0].deadline).getTime() 
      : getNextNbaNightTimestamp();

    container.innerHTML = `
      <div class="tinder-completion-card tinder-completion-arcade p-5 sm:p-6 text-center space-y-4">
        
        <!-- En-tête de fin de pile Arcade -->
        <div class="space-y-1.5 pt-1">
          <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-[8px] bg-[#14131A] border-2 border-black text-[11px] font-condensed font-black tracking-widest uppercase text-[#FF9800] shadow-[2px_2px_0px_#000000]">
            Tous les matchs sont pronostiqués !
          </div>
          <h3 class="font-condensed font-black text-2xl sm:text-3xl uppercase tracking-wider text-[#F4F4F0] leading-none pt-1">
            Pile de la nuit terminée
          </h3>
          <p class="text-xs text-zinc-400 font-medium max-w-xs mx-auto">
            Tu as passé en revue l'ensemble des ${total} matchs. Tes choix sont verrouillés pour le coup d'envoi !
          </p>
        </div>

        <!-- GRAND COMPTE À REBOURS DIGITAL RÉTRO (Scoreboard LED Arcade) -->
        <div class="retro-scoreboard-container border-[3px] border-black rounded-[12px] p-3.5 sm:p-4 shadow-[6px_6px_0px_#000000] relative overflow-hidden">
          <div class="retro-scanlines"></div>
          
          <div class="text-[10px] sm:text-[11px] font-condensed font-black uppercase tracking-widest text-[#FF9800] flex items-center justify-center gap-1.5 mb-2.5 relative z-10">
            <span class="w-2 h-2 rounded-full bg-[#FF9800] animate-ping"></span>
            <span>Coup d'envoi des prochains matchs dans</span>
          </div>

          <div id="retro-digital-countdown" class="flex items-center justify-center gap-1.5 sm:gap-2 select-none relative z-10" data-target="${nextDeadline}">
            <div class="countdown-digit-box">
              <span class="countdown-num text-3xl sm:text-4xl" id="cd-hours">00</span>
              <span class="countdown-label">Heures</span>
            </div>
            <span class="countdown-colon text-2xl sm:text-3xl self-start mt-1">:</span>
            <div class="countdown-digit-box">
              <span class="countdown-num text-3xl sm:text-4xl" id="cd-minutes">00</span>
              <span class="countdown-label">Min</span>
            </div>
            <span class="countdown-colon text-2xl sm:text-3xl self-start mt-1">:</span>
            <div class="countdown-digit-box">
              <span class="countdown-num text-3xl sm:text-4xl" id="cd-seconds">00</span>
              <span class="countdown-label">Sec</span>
            </div>
          </div>
        </div>

        
        </div>

      </div>
    `;

    startRetroCountdown(nextDeadline);
    return;
  }

  // Cartes empilées dans la pile
  const topMatch = filtered[currentIndex];
  const nextMatch = currentIndex + 1 < total ? filtered[currentIndex + 1] : null;
  const thirdMatch = currentIndex + 2 < total ? filtered[currentIndex + 2] : null;

  function renderCardContent(match, idx, isTop = false) {
    const isFinished = match.status === 'finished';
    const deadline = new Date(match.deadline);
    const dateFormatted = formatMatchTime(deadline);
    const selectedTeamId = state.myPredictions[match.id];
    const isBoosted = !!state.boostedPredictions[match.id];

    const homeSelected = selectedTeamId === match.home_team.id;
    const awaySelected = selectedTeamId === match.away_team.id;

    const awayColor = match.away_team.color || '#D95D39';
    const homeColor = match.home_team.color || '#0077FE';

    let boostButton = '';
    if (!isFinished) {
      boostButton = `
        <button 
          onclick="handleToggleBoost(${match.id}, event)" 
          class="btn-tactile boost-btn px-2 py-0.5 rounded-[6px] text-[10px] font-condensed font-black uppercase tracking-wider flex items-center gap-1 transition ${
            isBoosted ? 'boost-btn-active' : 'boost-btn-inactive'
          }"
          title="Bonus x2 : double les points en cas de victoire (1 seul par semaine)"
        >
          <svg class='lucide-inline lucide-md lucide-amber-fill' viewBox='0 0 24 24'><path d='M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'/></svg>
          <span>${isBoosted ? 'x2 Actif' : 'Bonus x2'}</span>
        </button>
      `;
    } else if (isBoosted) {
      boostButton = `
        <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-[6px] bg-white/10 text-white border border-white/25 flex items-center gap-1">
          <svg class='lucide-inline lucide-md lucide-amber-fill' viewBox='0 0 24 24'><path d='M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'/></svg> x2 Joué
        </span>
      `;
    }

    return `
      <!-- Traînée de feu CSS dynamique lors du swipe avec bonus actif -->
      <div class="card-fire-trail-container">
        <div class="fire-trail-flame trail-left"></div>
        <div class="fire-trail-flame trail-right"></div>
        <div class="fire-ember" style="top: 25%; left: 8%;"></div>
        <div class="fire-ember" style="top: 65%; left: 12%;"></div>
        <div class="fire-ember" style="top: 30%; right: 8%;"></div>
        <div class="fire-ember" style="top: 70%; right: 12%;"></div>
      </div>

      <!-- Overlays dynamiques d'illumination au swipe -->
      <div class="swipe-overlay-left" style="background: linear-gradient(90deg, ${hexToRgba(homeColor, 0.55)} 0%, transparent 80%);"></div>
      <div class="swipe-overlay-right" style="background: linear-gradient(270deg, ${hexToRgba(awayColor, 0.55)} 0%, transparent 80%);"></div>

      <!-- Badges de validation avec icône lors du swipe -->
      <div class="swipe-badge-left" style="background: ${homeColor}; color: ${match.home_team.text_color || '#FFFFFF'};">
        <svg class="w-4 h-4 stroke-[3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        <span>${escapeHtml(match.home_team.code)}</span>
      </div>
      <div class="swipe-badge-right" style="background: ${awayColor}; color: ${match.away_team.text_color || '#FFFFFF'};">
        <span>${escapeHtml(match.away_team.code)}</span>
        <svg class="w-4 h-4 stroke-[3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
      </div>

      <!-- En-tête de la carte : Semaine, Date, Bonus x2 & Ligues -->
      <div class="flex items-center justify-between pb-2 border-b-2 border-black/80 relative z-20">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 rounded-[6px] bg-[#101014] text-[#F4F4F0] font-black font-condensed border-2 border-black text-[11px] shadow-[1px_1px_0px_#000000]">
            W${match.week_number || 1}
          </span>
          <span class="text-[11px] font-bold text-zinc-300 font-condensed uppercase tracking-wider">
            ${isFinished ? 'Terminé' : dateFormatted}
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          ${isBoosted ? `
            <span class="px-2 py-0.5 rounded-[6px] bg-[#FF5722] text-white border-2 border-black font-condensed font-black text-[10px] shadow-[1px_1px_0px_#000000] flex items-center gap-1">
              <svg class='lucide-inline lucide-md lucide-orange-fill' viewBox='0 0 24 24'><path d='M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'/></svg> x2 ACTIF
            </span>
          ` : ''}
          <button 
            onclick="openLeagueMatchVotesModal(${match.id})" 
            class="btn-tactile p-1 rounded-[6px] bg-[#1a1924] hover:bg-[#252433] border-2 border-black text-zinc-300 shadow-[1px_1px_0px_#000000] cursor-pointer" 
            title="Pronos de ligue"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- AFFICHE DU MATCH : ÉQUIPE EXTÉRIEUR (GAUCHE) vs ÉQUIPE DOMICILE (DROITE) -->
      <div class="grid grid-cols-2 gap-2.5 items-stretch my-auto py-1 relative z-20">
        
        <!-- ÉQUIPE DOMICILE (GAUCHE) -->
        <div class="team-panel rounded-[10px] p-2.5 flex flex-col justify-between border-2 ${
          homeSelected 
            ? 'border-[#0077FE] bg-[#0077FE]/20 shadow-[3px_3px_0px_#000000]' 
            : 'border-black bg-[#16151c] shadow-[2px_2px_0px_#000000]'
        }">
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-[4px] bg-black/70 text-zinc-300 border border-black">
                Domicile
              </span>
              <div class="flex items-center gap-0.5" title="Forme (5 derniers matchs)">
                ${getTeamFormDotsHtml(match.home_team.recent_form)}
              </div>
            </div>
            <div class="flex items-center gap-2 mb-1">
              <div 
                class="w-8 h-8 rounded-[8px] flex items-center justify-center font-condensed font-black text-sm border-2 border-black shadow-[2px_2px_0px_#000000] shrink-0"
                style="background-color: ${homeColor}; color: ${match.home_team.text_color || '#FFFFFF'};"
              >
                ${escapeHtml(match.home_team.code)}
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-condensed font-black text-sm leading-tight text-white uppercase truncate">
                  ${escapeHtml(match.home_team.city)}
                </div>
                <div class="text-[10px] text-zinc-400 font-semibold truncate leading-none">
                  ${escapeHtml(match.home_team.name)}
                </div>
              </div>
            </div>
          </div>

          <div class="mt-2 pt-1.5 border-t border-black/50 flex items-center justify-between">
            <span class="text-[10px] font-black uppercase text-zinc-400 font-condensed">Cote</span>
            <span class="font-condensed text-lg font-black ${homeSelected ? 'text-[#0077FE]' : 'text-white'}">
              ${match.home_odds.toFixed(2)}
            </span>
          </div>

          ${homeSelected ? `
            <div class="mt-1 text-center text-[10px] font-black uppercase tracking-wider text-white bg-[#0077FE] py-0.5 rounded-[6px] border border-black shadow-[1px_1px_0px_#000000]">
              <svg class='lucide-inline lucide-xs lucide-green' viewBox='0 0 24 24'><path d='M20 6 9 17l-5-5'/></svg> Ton choix
            </div>
          ` : ''}
        </div>

      <!-- ÉQUIPE EXTÉRIEUR (DROITE) -->
        <div class="team-panel rounded-[10px] p-2.5 flex flex-col justify-between border-2 ${
          awaySelected 
            ? 'border-[#D95D39] bg-[#D95D39]/20 shadow-[3px_3px_0px_#000000]' 
            : 'border-black bg-[#16151c] shadow-[2px_2px_0px_#000000]'
        }">
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-[4px] bg-black/70 text-zinc-300 border border-black">
                Extérieur
              </span>
              <div class="flex items-center gap-0.5" title="Forme (5 derniers matchs)">
                ${getTeamFormDotsHtml(match.away_team.recent_form)}
              </div>
            </div>
            <div class="flex items-center gap-2 mb-1">
              <div 
                class="w-8 h-8 rounded-[8px] flex items-center justify-center font-condensed font-black text-sm border-2 border-black shadow-[2px_2px_0px_#000000] shrink-0"
                style="background-color: ${awayColor}; color: ${match.away_team.text_color || '#FFFFFF'};"
              >
                ${escapeHtml(match.away_team.code)}
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-condensed font-black text-sm leading-tight text-white uppercase truncate">
                  ${escapeHtml(match.away_team.city)}
                </div>
                <div class="text-[10px] text-zinc-400 font-semibold truncate leading-none">
                  ${escapeHtml(match.away_team.name)}
                </div>
              </div>
            </div>
          </div>

          <div class="mt-2 pt-1.5 border-t border-black/50 flex items-center justify-between">
            <span class="text-[10px] font-black uppercase text-zinc-400 font-condensed">Cote</span>
            <span class="font-condensed text-lg font-black ${awaySelected ? 'text-[#D95D39]' : 'text-white'}">
              ${match.away_odds.toFixed(2)}
            </span>
          </div>

          ${awaySelected ? `
            <div class="mt-1 text-center text-[10px] font-black uppercase tracking-wider text-black bg-[#D95D39] py-0.5 rounded-[6px] border border-black shadow-[1px_1px_0px_#000000]">
              <svg class='lucide-inline lucide-xs lucide-green' viewBox='0 0 24 24'><path d='M20 6 9 17l-5-5'/></svg> Ton choix
            </div>
          ` : ''}
        </div>

        </div>

      <!-- GROS BOUTON BONUS x2 ARCADE (Aspect physique néo-brutaliste enfonçable) -->
      <div class="arcade-bonus-wrapper relative z-20">
        <button 
          type="button"
          onclick="handleArcadeBonusClick(${match.id}, event)" 
          id="arcade-btn-${match.id}"
          class="arcade-push-btn ${isBoosted ? 'is-locked' : ''} ${isFinished ? 'is-disabled' : ''}"
          title="${isBoosted ? 'Bonus x2 ACTIF : Points doublés ! Clique pour retirer' : 'Bonus x2 Arcade : Appuie pour enfoncer et doubler tes points (1 par semaine) !'}"
          ${isFinished ? 'disabled' : ''}
        >
          <div class="arcade-btn-collar">
            <div class="arcade-btn-plunger">
              <span class="arcade-btn-icon"><svg class='lucide-inline lucide-lg lucide-amber-fill' viewBox='0 0 24 24'><path d='M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'/></svg></span>
              <span class="arcade-btn-label">x2</span>
              <span class="arcade-btn-status">${isBoosted ? 'x2 LOCKÉ' : 'BONUS'}</span>
            </div>
          </div>
        </button>
      </div>

      <!-- Indicateur VS central & Guidage swipe -->
      <div class="flex items-center justify-between px-3 py-1.5 rounded-[8px] bg-black/60 border-2 border-black/80 text-[10px] text-zinc-400 font-bold uppercase tracking-wider relative z-20">
        <span class="flex items-center gap-1 font-condensed font-black" style="color: ${awayColor};">
          <svg class='lucide-inline lucide-sm lucide-white' viewBox='0 0 24 24'><path d='m12 19-7-7 7-7'/><path d='M19 12H5'/></svg> ${escapeHtml(match.away_team.code)}
        </span>
        <span class="px-2 py-0.5 rounded-[4px] bg-[#121216] border border-white/20 text-[#F4F4F0] font-condensed font-black text-xs shadow-[1px_1px_0px_#000000]">
          VS
        </span>
        <span class="flex items-center gap-1 font-condensed font-black" style="color: ${homeColor};">
          ${escapeHtml(match.home_team.code)} <svg class='lucide-inline lucide-sm lucide-white' viewBox='0 0 24 24'><path d='M5 12h14'/><path d='m12 5 7 7-7 7'/></svg>
        </span>
      </div>

      <!-- Pied de carte : Statut du pronostic & Position -->
      <div class="pt-2 border-t-2 border-black/80 flex items-center justify-between text-xs relative z-20">
        <div class="text-[11px] font-bold text-zinc-300 truncate">
          ${selectedTeamId ? `
            <span class="text-zinc-400">Prono :</span> 
            <span class="font-black ${homeSelected ? 'text-[#0077FE]' : 'text-[#D95D39]'}">
              ${homeSelected ? escapeHtml(match.home_team.name) : escapeHtml(match.away_team.name)} (${(homeSelected ? match.home_odds : match.away_odds).toFixed(2)})
            </span>
          ` : `
            <span class="text-zinc-400 font-medium">Glisse la carte pour voter</span>
          `}
        </div>
        <div class="text-[10px] font-condensed font-black uppercase px-2 py-0.5 rounded-[6px] bg-white/10 text-zinc-300 border border-black">
          ${idx + 1} / ${total}
        </div>
      </div>
    `;
  }

  // Assemblage du conteneur de pile Tinder (100% centré sur le swipe de cartes)
  container.innerHTML = `
    <!-- Références pour compatibilité tests automatisés et accessibilité -->
    <div class="sr-only hidden" aria-hidden="true" style="display:none;">
      <button id="btn-swipe-left" onclick="programmaticSwipe('left')"></button>
      <button id="btn-swipe-undo" onclick="undoLastSwipe()"></button>
      <button id="btn-swipe-right" onclick="programmaticSwipe('right')"></button>
    </div>

    <div class="tinder-deck-wrapper">
      <div class="tinder-deck-container">
        ${thirdMatch ? `
          <div class="tinder-card tinder-card-third ${state.boostedPredictions[thirdMatch.id] ? 'card-boosted' : ''}">
            ${renderCardContent(thirdMatch, currentIndex + 2, false)}
          </div>
        ` : ''}

        ${nextMatch ? `
          <div class="tinder-card tinder-card-next ${state.boostedPredictions[nextMatch.id] ? 'card-boosted' : ''}">
            ${renderCardContent(nextMatch, currentIndex + 1, false)}
          </div>
        ` : ''}

        <div class="tinder-card tinder-card-top ${state.boostedPredictions[topMatch.id] ? 'card-boosted' : ''}" id="tinder-top-card">
          ${renderCardContent(topMatch, currentIndex, true)}
        </div>
      </div>
    </div>
  `;

  // Attachement des écouteurs gestuels tactiles et pointeur sur la carte supérieure
  const topCardEl = document.getElementById('tinder-top-card');
  if (topCardEl) {
    attachSwipeListeners(topCardEl, topMatch, topMatch.status === 'finished');
  }
}

// --- Gestion des Gestes de Glissement (Swipe & Haptics) ---
function attachSwipeListeners(cardEl, match, isFinished) {
  if (!cardEl) return;

  let startX = 0;
  let startY = 0;
  let currentDx = 0;
  let currentDy = 0;
  let isDragging = false;
  let hasVibrated = false;
  const threshold = 85;

  const overlayLeft = cardEl.querySelector('.swipe-overlay-left');
  const overlayRight = cardEl.querySelector('.swipe-overlay-right');
  const badgeLeft = cardEl.querySelector('.swipe-badge-left');
  const badgeRight = cardEl.querySelector('.swipe-badge-right');
  const trailLeft = cardEl.querySelector('.trail-left');
  const trailRight = cardEl.querySelector('.trail-right');

  const awayColor = match.away_team.color || '#D95D39';
  const homeColor = match.home_team.color || '#0077FE';

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button') || e.target.closest('a')) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    currentDx = 0;
    currentDy = 0;
    hasVibrated = false;

    try {
      cardEl.setPointerCapture(e.pointerId);
    } catch (err) {}

    cardEl.classList.add('is-dragging');
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;

    currentDx = e.clientX - startX;
    currentDy = e.clientY - startY;

    const rotation = currentDx * 0.08;
    cardEl.style.transform = `translate3d(${currentDx}px, ${currentDy * 0.35}px, 0) rotate(${rotation}deg)`;

    const absDx = Math.abs(currentDx);
    const progress = Math.min(absDx / threshold, 1);
    const pastThreshold = absDx >= threshold;

    // Déclenchement de la micro-vibration haptique (50ms) au passage du seuil
    if (pastThreshold && !hasVibrated) {
      if (navigator.vibrate) {
        try {
          navigator.vibrate(50);
        } catch (err) {}
      }
      hasVibrated = true;
    } else if (!pastThreshold && hasVibrated) {
      hasVibrated = false;
    }

    // Gestion de la traînée de feu CSS si le Bonus x2 est actif sur ce match
    const isBoosted = !!state.boostedPredictions[match.id];
    if (isBoosted) {
      if (currentDx < 0) {
        // Glissement à GAUCHE -> Traînée de feu projetée à DROITE
        if (trailRight) {
          trailRight.style.opacity = Math.min(absDx / 55, 1).toString();
          trailRight.style.transform = `scaleX(${1 + (absDx / 75) * 0.8}) scaleY(${1 + (absDx / 160)})`;
        }
        if (trailLeft) trailLeft.style.opacity = '0';
      } else {
        // Glissement à DROITE -> Traînée de feu projetée à GAUCHE
        if (trailLeft) {
          trailLeft.style.opacity = Math.min(absDx / 55, 1).toString();
          trailLeft.style.transform = `scaleX(${1 + (absDx / 75) * 0.8}) scaleY(${1 + (absDx / 160)})`;
        }
        if (trailRight) trailRight.style.opacity = '0';
      }
    }

    // Retour visuel dynamique : illumination de bordure et overlay aux couleurs de l'équipe
    if (currentDx < 0) {
      // Glissement vers la GAUCHE -> Équipe Extérieur
      if (overlayLeft) overlayLeft.style.opacity = (absDx / 130).toString();
      if (overlayRight) overlayRight.style.opacity = '0';

      if (badgeLeft) {
        badgeLeft.style.opacity = progress.toString();
        badgeLeft.style.transform = `rotate(-10deg) scale(${0.85 + progress * 0.25})`;
      }
      if (badgeRight) badgeRight.style.opacity = '0';

      if (pastThreshold) {
        cardEl.style.borderColor = homeColor;
        cardEl.style.boxShadow = isBoosted 
          ? `0 0 35px #FF5722, 0 0 20px ${awayColor}, 6px 6px 0px #000000` 
          : `0 0 20px ${awayColor}, 6px 6px 0px #000000`;
      } else {
        cardEl.style.borderColor = isBoosted ? '#FF5722' : '#000000';
        cardEl.style.boxShadow = isBoosted 
          ? '0 0 25px rgba(255, 87, 34, 0.6), 6px 6px 0px #000000' 
          : '6px 6px 0px #000000';
      }
    } else {
      // Glissement vers la DROITE -> Équipe Domicile
      if (overlayRight) overlayRight.style.opacity = (absDx / 130).toString();
      if (overlayLeft) overlayLeft.style.opacity = '0';

      if (badgeRight) {
        badgeRight.style.opacity = progress.toString();
        badgeRight.style.transform = `rotate(10deg) scale(${0.85 + progress * 0.25})`;
      }
      if (badgeLeft) badgeLeft.style.opacity = '0';

      if (pastThreshold) {
        cardEl.style.borderColor = awayColor;
        cardEl.style.boxShadow = isBoosted 
          ? `0 0 35px #FF5722, 0 0 20px ${homeColor}, 6px 6px 0px #000000` 
          : `0 0 20px ${homeColor}, 6px 6px 0px #000000`;
      } else {
        cardEl.style.borderColor = isBoosted ? '#FF5722' : '#000000';
        cardEl.style.boxShadow = isBoosted 
          ? '0 0 25px rgba(255, 87, 34, 0.6), 6px 6px 0px #000000' 
          : '6px 6px 0px #000000';
      }
    }
  };

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;

    try {
      cardEl.releasePointerCapture(e.pointerId);
    } catch (err) {}

    cardEl.classList.remove('is-dragging');

    const absDx = Math.abs(currentDx);
    if (absDx >= threshold) {
      // Swipe validé !
      const isBoosted = !!state.boostedPredictions[match.id];
      if (isBoosted) {
        cardEl.classList.add('fire-trail-launching');
        if (navigator.vibrate) {
          try {
            navigator.vibrate([40, 30, 70, 40, 90]);
          } catch (err) {}
        }
      }

      const direction = currentDx > 0 ? 'right' : 'left';
      const flyX = direction === 'right' ? window.innerWidth * 1.3 : -window.innerWidth * 1.3;
      const rotation = currentDx * 0.12;

      cardEl.style.transition = 'transform 0.24s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.24s ease-out';
      cardEl.style.transform = `translate3d(${flyX}px, ${currentDy}px, 0) rotate(${rotation}deg)`;
      cardEl.style.opacity = '0';

      triggerSwipeAction(match, direction);
    } else {
      // Retour élastique au centre
      if (trailLeft) trailLeft.style.opacity = '0';
      if (trailRight) trailRight.style.opacity = '0';
      cardEl.classList.remove('fire-trail-launching');

      const isBoosted = !!state.boostedPredictions[match.id];
      cardEl.style.transition = 'transform 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.25), border-color 0.2s ease, box-shadow 0.2s ease';
      cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
      cardEl.style.borderColor = isBoosted ? '#FF5722' : '#000000';
      cardEl.style.boxShadow = isBoosted 
        ? '0 0 25px rgba(255, 87, 34, 0.6), 6px 6px 0px #000000' 
        : '6px 6px 0px #000000';
      if (overlayLeft) overlayLeft.style.opacity = '0';
      if (overlayRight) overlayRight.style.opacity = '0';
      if (badgeLeft) badgeLeft.style.opacity = '0';
      if (badgeRight) badgeRight.style.opacity = '0';
    }
  };

  cardEl.addEventListener('pointerdown', onPointerDown);
  cardEl.addEventListener('pointermove', onPointerMove);
  cardEl.addEventListener('pointerup', onPointerUp);
  cardEl.addEventListener('pointercancel', onPointerUp);
}

// --- Action de Validation suite au Swipe ---
async function triggerSwipeAction(match, direction) {
  const chosenTeam = direction === 'left' ? match.home_team : match.away_team;
  const isFinished = match.status === 'finished';

  // Haptic feedback Arcade sur validation de swipe
  if (navigator.vibrate) {
    try {
      navigator.vibrate(50);
    } catch (e) {}
  }

  if (isFinished) {
    notify("Match terminé : passage au match suivant", "info");
    state.tinderDeckIndex++;
    setTimeout(() => renderMatchesList(), 240);
    return;
  }

  if (!state.currentUser) {
    openAuthModal('login');
    notify("Connecte-toi pour pronostiquer", "info");
    setTimeout(() => renderMatchesList(), 240);
    return;
  }

  // Mémorisation de l'état Bonus x2 (s'il a été armé avant le swipe)
  const wasBoostArmed = !!state.boostedPredictions[match.id];

  // Sauvegarde dans l'historique d'annulation (Undo)
  const previousVote = state.myPredictions[match.id] || null;
  state.swipeHistory.push({
    match,
    matchId: match.id,
    previousVote,
    chosenTeamId: chosenTeam.id,
    direction,
    wasBoostArmed,
    deckIndex: state.tinderDeckIndex
  });

  // Avancement de l'index de la pile
  state.tinderDeckIndex++;

  // Mise à jour optimiste du vote
  state.myPredictions[match.id] = chosenTeam.id;

  try {
    await API.makePrediction(match.id, chosenTeam.id);
    if (wasBoostArmed) {
      try {
        await API.toggleBoost(match.id);
        launchConfetti();
        notify(`Prono validé avec Bonus x2 : ${chosenTeam.city} ! (Points doublés)`, "success");
      } catch (err) {
        notify(`Prono validé : ${chosenTeam.city} !`, "success");
      }
    } else {
      notify(`Prono validé : ${chosenTeam.city} ! `, "success");
    }
  } catch (err) {
    notify(err.message, "error");
  }

  setTimeout(() => {
    renderMatchesList();
  }, 220);
}

// --- Déclenchement Programmatique de Swipe (Boutons fléchés sous la pile) ---
function programmaticSwipe(direction) {
  const filtered = getFilteredMatches();
  if (state.tinderDeckIndex >= filtered.length) return;

  const currentMatch = filtered[state.tinderDeckIndex];
  const topCard = document.getElementById('tinder-top-card');
  const isBoosted = !!state.boostedPredictions[currentMatch.id];

  // Micro-vibration haptique (arcade standard 50ms ou arcade enflammée si bonus actif)
  if (navigator.vibrate) {
    try {
      if (isBoosted) {
        navigator.vibrate([40, 30, 70, 40, 90]);
      } else {
        navigator.vibrate(50);
      }
    } catch (e) {}
  }

  if (topCard) {
    const flyX = direction === 'right' ? window.innerWidth * 1.3 : -window.innerWidth * 1.3;
    const rotation = direction === 'right' ? 18 : -18;
    const teamColor = direction === 'right' 
      ? (currentMatch.home_team.color || '#0077FE') 
      : (currentMatch.away_team.color || '#D95D39');

    topCard.style.transition = 'transform 0.24s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.24s ease-out, border-color 0.15s ease';
    topCard.style.borderColor = isBoosted ? '#FF9800' : teamColor;
    if (isBoosted) {
      topCard.classList.add('fire-trail-launching');
      const trailLeft = topCard.querySelector('.trail-left');
      const trailRight = topCard.querySelector('.trail-right');
      if (direction === 'right' && trailLeft) {
        trailLeft.style.opacity = '1';
        trailLeft.style.transform = 'scale(1.4)';
      } else if (direction === 'left' && trailRight) {
        trailRight.style.opacity = '1';
        trailRight.style.transform = 'scale(1.4)';
      }
    }
    topCard.style.transform = `translate3d(${flyX}px, 0, 0) rotate(${rotation}deg)`;
    topCard.style.opacity = '0';
  }

  triggerSwipeAction(currentMatch, direction);
}
window.programmaticSwipe = programmaticSwipe;

// --- Bouton Annulation Undo (Restauration du dernier swipe) ---
async function undoLastSwipe() {
  if (!state.swipeHistory || state.swipeHistory.length === 0) {
    notify("Aucun pronostic à annuler", "info");
    return;
  }

  const lastSwipe = state.swipeHistory.pop();
  if (!lastSwipe) return;

  // Recul de l'index de la pile
  state.tinderDeckIndex = Math.max(0, state.tinderDeckIndex - 1);

  // Restauration du pronostic précédent
  if (lastSwipe.previousVote) {
    state.myPredictions[lastSwipe.matchId] = lastSwipe.previousVote;
    try {
      await API.makePrediction(lastSwipe.matchId, lastSwipe.previousVote);
    } catch (e) {}
  } else {
    delete state.myPredictions[lastSwipe.matchId];
  }

  // Micro-vibration haptique de retour (35ms)
  if (navigator.vibrate) {
    try {
      navigator.vibrate(35);
    } catch (e) {}
  }

  notify("Dernier pronostic annulé ↺", "info");
  renderMatchesList();
}
window.undoLastSwipe = undoLastSwipe;

// --- Rendu Liste Classique des Matchs (Clean Neo-Brutaliste) ---
function renderMatchesListView(container, filtered) {
  const toolbarHtml = `
    <div class="flex items-center justify-between gap-2 mb-2 px-1">
      <div class="flex items-center gap-1.5">
        <button 
          onclick="setMatchesViewMode('tinder')" 
          class="btn-tactile px-3 py-1 rounded-[8px] text-xs font-condensed font-black uppercase tracking-wider border-2 border-black transition cursor-pointer bg-[#18181e] text-zinc-400 hover:text-white shadow-none flex items-center gap-1.5"
        >
          <svg class='lucide-inline lucide-sm lucide-muted' viewBox='0 0 24 24'><path d='m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z'/><path d='m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65'/><path d='m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'/></svg> Mode Swipe
        </button>
        <button 
          onclick="setMatchesViewMode('list')" 
          class="btn-tactile px-3 py-1 rounded-[8px] text-xs font-condensed font-black uppercase tracking-wider border-2 border-black transition cursor-pointer bg-[#D95D39] text-white shadow-[2px_2px_0px_#000000]"
        >
          <svg class='lucide-inline lucide-sm lucide-white' viewBox='0 0 24 24'><line x1='8' x2='21' y1='6' y2='6'/><line x1='8' x2='21' y1='12' y2='12'/><line x1='8' x2='21' y1='18' y2='18'/><line x1='3' x2='3.01' y1='6' y2='6'/><line x1='3' x2='3.01' y1='12' y2='12'/><line x1='3' x2='3.01' y1='18' y2='18'/></svg> Liste
        </button>
      </div>

      <div class="inline-flex items-center gap-1.5 bg-[#18181e] border-2 border-black px-2.5 py-0.5 rounded-[8px] shadow-[2px_2px_0px_#000000]">
        <span class="font-condensed font-black text-xs uppercase text-[#F4F4F0] tracking-wider">
          ${filtered.length} matchs
        </span>
      </div>
    </div>
  `;

  if (filtered.length === 0) {
    container.innerHTML = `
      ${toolbarHtml}
      <div class="p-8 text-center bg-[#18181e] rounded-[10px] border-[3px] border-black shadow-[6px_6px_0px_#000000] text-zinc-400 text-xs font-semibold">
        Aucun match dans cette catégorie.
      </div>
    `;
    return;
  }

  const listItemsHtml = filtered.map(match => {
    const isFinished = match.status === 'finished';
    const deadline = new Date(match.deadline);
    const dateFormatted = formatMatchTime(deadline);
    const selectedTeamId = state.myPredictions[match.id];
    const isBoosted = !!state.boostedPredictions[match.id];

    const homeSelected = selectedTeamId === match.home_team.id;
    const awaySelected = selectedTeamId === match.away_team.id;

    const homeWon = isFinished && match.winner_team_id === match.home_team.id;
    const awayWon = isFinished && match.winner_team_id === match.away_team.id;

    let statusPill = '';
    if (isFinished) {
      statusPill = `<span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-[6px] bg-zinc-800 text-zinc-300 border-2 border-black">Terminé</span>`;
    } else if (selectedTeamId) {
      statusPill = `<span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-[6px] bg-white text-black border-2 border-black">Prono validé</span>`;
    } else {
      statusPill = `<span class="text-[10px] font-bold text-zinc-400">${dateFormatted}</span>`;
    }

    let boostButton = '';
    if (!isFinished) {
      boostButton = `
        <button 
          type="button"
          onclick="handleArcadeBonusClick(${match.id}, event)" 
          class="arcade-push-btn ${isBoosted ? 'is-locked' : ''}"
          title="Bonus x2 Arcade : double les points en cas de victoire (1 seul par semaine)"
        >
          <div class="arcade-btn-collar scale-90">
            <div class="arcade-btn-plunger py-1 px-2.5">
              <span class="arcade-btn-icon"><svg class='lucide-inline lucide-sm lucide-amber-fill' viewBox='0 0 24 24'><path d='M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'/></svg></span>
              <span class="arcade-btn-label text-sm">x2</span>
              <span class="arcade-btn-status text-[9px]">${isBoosted ? 'LOCKÉ' : 'BONUS'}</span>
            </div>
          </div>
        </button>
      `;
    } else if (isBoosted) {
      boostButton = `
        <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-[6px] bg-[#FF5722] text-white border-2 border-black flex items-center gap-1 shadow-[1px_1px_0px_#000]">
          <svg class='lucide-inline lucide-sm lucide-amber-fill' viewBox='0 0 24 24'><path d='M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'/></svg> x2 Joué
        </span>
      `;
    }

    return `
      <div class="match-card rounded-[12px] p-3 sm:p-3.5 space-y-3 ${isBoosted ? 'match-card-boosted card-boosted' : ''}">
        
        <!-- En-tête : Semaine, Date, Bonus x2 & État -->
        <div class="flex items-center justify-between text-xs pb-2 border-b-2 border-black/80 gap-1.5">
          <div class="flex items-center space-x-1.5 text-zinc-400 font-medium text-[11px] min-w-0 truncate">
            <span class="px-2 py-0.5 rounded-[6px] bg-[#121216] text-[#F4F4F0] font-black font-condensed border-2 border-black text-[10px] shadow-[1px_1px_0px_#000000] shrink-0">W${match.week_number || 1}</span>
            <span class="w-1.5 h-1.5 rounded-full ${isFinished ? 'bg-zinc-600' : 'bg-white'} shrink-0"></span>
            <span class="truncate font-condensed font-bold">${isFinished ? 'Terminé' : dateFormatted}</span>
          </div>
          <div class="flex items-center space-x-1.5 shrink-0">
            ${boostButton}
            <div>${statusPill}</div>
          </div>
        </div>

        <!-- Deux blocs équipes et cotes (Extérieur à gauche, Domicile à droite) -->
        <div class="grid grid-cols-2 gap-2 sm:gap-2.5 items-stretch">
          
          <!-- ÉQUIPE EXTÉRIEUR -->
          <button
            onclick="voteForTeam(${match.id}, ${match.away_team.id}, ${isFinished})"
            class="odds-btn h-full rounded-[10px] p-2.5 sm:p-3 flex flex-col justify-between text-left relative ${
              awaySelected ? 'odds-btn-selected' : ''
            } ${isFinished ? 'cursor-default' : 'cursor-pointer'}"
          >
            <div class="flex items-center space-x-2 w-full mb-1.5">
              <div 
                class="w-7 h-7 rounded-[6px] flex items-center justify-center font-condensed font-black text-xs border-2 border-black shadow-[2px_2px_0px_#000000] shrink-0"
                style="background-color: ${match.away_team.color}; color: ${match.away_team.text_color};"
              >
                ${match.away_team.code}
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-condensed font-black text-xs sm:text-sm uppercase tracking-wide text-white truncate leading-tight">
                  ${match.away_team.city}
                </div>
                <div class="flex items-center justify-between gap-1 mt-0.5">
                  <span class="text-[9px] font-bold uppercase tracking-wider text-slate-400 truncate">Ext.</span>
                  <div class="flex items-center gap-0.5 shrink-0" title="Forme (5 derniers matchs)">
                    ${getTeamFormDotsHtml(match.away_team.recent_form)}
                  </div>
                </div>
              </div>
            </div>

            <div class="w-full flex items-center justify-between pt-1.5 border-t border-black/40">
              <span class="text-[10px] font-bold uppercase text-slate-400">Cote</span>
              <span class="font-condensed text-base font-black ${awaySelected ? 'text-white' : 'text-zinc-200'}">
                ${match.away_odds.toFixed(2)}
              </span>
            </div>

            ${awayWon ? `
              <div class="mt-1 text-center text-[10px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-500/10 py-0.5 rounded border border-emerald-500/20">
                Gagné (${match.away_score} pts)
              </div>
            ` : ''}
          </button>

          <!-- ÉQUIPE DOMICILE -->
          <button
            onclick="voteForTeam(${match.id}, ${match.home_team.id}, ${isFinished})"
            class="odds-btn h-full rounded-[10px] p-2.5 sm:p-3 flex flex-col justify-between text-left relative ${
              homeSelected ? 'odds-btn-selected' : ''
            } ${isFinished ? 'cursor-default' : 'cursor-pointer'}"
          >
            <div class="flex items-center space-x-2 w-full mb-1.5">
              <div 
                class="w-7 h-7 rounded-[6px] flex items-center justify-center font-condensed font-black text-xs border-2 border-black shadow-[2px_2px_0px_#000000] shrink-0"
                style="background-color: ${match.home_team.color}; color: ${match.home_team.text_color};"
              >
                ${match.home_team.code}
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-condensed font-black text-xs sm:text-sm uppercase tracking-wide text-white truncate leading-tight">
                  ${match.home_team.city}
                </div>
                <div class="flex items-center justify-between gap-1 mt-0.5">
                  <span class="text-[9px] font-bold uppercase tracking-wider text-slate-400 truncate">Dom.</span>
                  <div class="flex items-center gap-0.5 shrink-0" title="Forme (5 derniers matchs)">
                    ${getTeamFormDotsHtml(match.home_team.recent_form)}
                  </div>
                </div>
              </div>
            </div>

            <div class="w-full flex items-center justify-between pt-1.5 border-t border-black/40">
              <span class="text-[10px] font-bold uppercase text-slate-400">Cote</span>
              <span class="font-condensed text-base font-black ${homeSelected ? 'text-white' : 'text-zinc-200'}">
                ${match.home_odds.toFixed(2)}
              </span>
            </div>

            ${homeWon ? `
              <div class="mt-1 text-center text-[10px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-500/10 py-0.5 rounded border border-emerald-500/20">
                Gagné (${match.home_score} pts)
              </div>
            ` : ''}
          </button>

        </div>

        <!-- Footer carte : Pronostics de ligue -->
        <div class="pt-2 border-t-2 border-black/80 flex items-center justify-between">
          <span class="text-[10px] text-zinc-400 font-semibold flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 text-zinc-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <span>Pronos de ligue</span>
          </span>
          <button 
            onclick="openLeagueMatchVotesModal(${match.id})" 
            class="btn-tactile text-[10px] font-condensed font-bold uppercase tracking-wider text-zinc-200 hover:text-white bg-[#18181e] hover:bg-[#24242c] px-2.5 py-1 rounded-[6px] border-2 border-black shadow-[2px_2px_0px_#000000] transition cursor-pointer flex items-center gap-1"
          >
            <span>Qui a voté quoi ?</span>
            <span>›</span>
          </button>
        </div>

      </div>
    `;
  }).join('');

  container.innerHTML = `
    ${toolbarHtml}
    <div class="space-y-3">
      ${listItemsHtml}
    </div>
  `;
}

// --- Action Bonus x2 Arcade (Neo-Brutaliste Physique avec Lock & Vibration) ---
async function handleArcadeBonusClick(matchId, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  // 1. Vibration haptique mécanique arcade physique
  if (navigator.vibrate) {
    try {
      navigator.vibrate([60, 30, 80]);
    } catch (e) {}
  }

  if (!state.currentUser) {
    openAuthModal('login');
    notify("Connecte-toi pour activer ton Bonus x2 !", "info");
    return;
  }

  const targetMatch = state.matches.find(m => m.id === matchId);
  if (!targetMatch || targetMatch.status === 'finished') {
    notify("Ce match est déjà terminé.", "info");
    return;
  }

  const week = targetMatch.week_number || 1;
  const isCurrentlyBoosted = !!state.boostedPredictions[matchId];

  // Si l'utilisateur n'a pas encore fait de pronostic sur ce match (ex: mode Tinder avant le swipe)
  if (!state.myPredictions[matchId]) {
    if (isCurrentlyBoosted) {
      delete state.boostedPredictions[matchId];
      notify("Bonus x2 retiré de ce match.", "info");
    } else {
      // 1 seul bonus par semaine : désactiver le bonus sur les autres matchs de cette même semaine
      state.matches.forEach(m => {
        if ((m.week_number || 1) === week && m.id !== matchId) {
          delete state.boostedPredictions[m.id];
        }
      });
      state.boostedPredictions[matchId] = true;
      notify(`Bonus x2 armé pour la Semaine ${week} ! Glisse la carte pour valider ton équipe boostée !`, "success");
    }
    renderMatchesList();
    return;
  }

  // Si le pronostic est déjà enregistré -> Appel toggleBoost API
  try {
    const res = await API.toggleBoost(matchId);
    if (res.is_boosted) {
      // Désactiver le bonus sur les autres matchs de cette semaine
      state.matches.forEach(m => {
        if ((m.week_number || 1) === week && m.id !== matchId) {
          delete state.boostedPredictions[m.id];
        }
      });
      state.boostedPredictions[matchId] = true;
      launchConfetti();
      notify(`Bonus x2 activé pour la Semaine ${week} ! (Points doublés)`, "success");
    } else {
      delete state.boostedPredictions[matchId];
      notify("Bonus x2 désactivé sur ce match.", "info");
    }

    renderMatchesList();
  } catch (err) {
    notify(err.message, "error");
  }
}
window.handleArcadeBonusClick = handleArcadeBonusClick;
window.handleToggleBoost = handleArcadeBonusClick;

// --- Action Pronostic 1-Clic ---
async function voteForTeam(matchId, teamId, isFinished) {
  if (isFinished) {
    notify("Pronostics clôturés pour ce match", "info");
    return;
  }

  if (!state.currentUser) {
    openAuthModal('login');
    notify("Connecte-toi pour pronostiquer", "info");
    return;
  }

  

  if (state.myPredictions[matchId] === teamId) {
    return;
  }

  // Mise à jour optimiste
  const previousVote = state.myPredictions[matchId];
  state.myPredictions[matchId] = teamId;
  renderMatchesList();

  try {
    await API.makePrediction(matchId, teamId);
    notify("Pronostic validé !", "success");
  } catch (err) {
    state.myPredictions[matchId] = previousVote;
    renderMatchesList();
    notify(err.message, "error");
  }
}

// --- Rendu du Classement ---
function renderLeaderboard() {
  const podiumContainer = document.getElementById('leaderboard-podium');
  const rowsContainer = document.getElementById('leaderboard-table-rows');
  if (!podiumContainer || !rowsContainer) return;

  const lb = state.displayedLeaderboard || state.leaderboard;

  if (lb.length === 0) {
    podiumContainer.innerHTML = '';
    rowsContainer.innerHTML = `
      <div class="p-6 text-center text-slate-500 text-xs">
        Aucun joueur classé pour le moment.
      </div>
    `;
    return;
  }

  // Top 3 Podium
  const top1 = lb[0];
  const top2 = lb[1];
  const top3 = lb[2];

  podiumContainer.innerHTML = `
    <!-- 2ème Place -->
    <div class="podium-step-2 rounded-[8px] p-2.5 text-center border-[3px] border-black bg-[#18181e] shadow-[6px_6px_0px_#000000] flex flex-col justify-end min-h-[110px]">
      ${top2 ? `
        <div class="flex justify-center mb-1">${getUserAvatarHtml(top2.username, 'sm', top2.avatar_url)}</div>
        <div class="w-5 h-5 mx-auto mb-1 rounded-full bg-zinc-300 text-black font-black text-[10px] flex items-center justify-center">2</div>
        <div class="font-bold text-xs text-white truncate">${top2.username}</div>
        <div class="font-condensed font-black text-sm text-zinc-300">${top2.total_points.toFixed(1)} <span class="text-[10px]">pts</span></div>
      ` : '<div class="text-zinc-600 text-xs">-</div>'}
    </div>

    <!-- 1ère Place (Au centre, surélevé) -->
    <div class="podium-step-1 rounded-[8px] p-3 text-center border-[3px] border-black bg-[#18181e] shadow-[6px_6px_0px_#000000] flex flex-col justify-end min-h-[135px] relative z-10 scale-105">
      ${top1 ? `
        <div class="flex justify-center mb-1.5">${getUserAvatarHtml(top1.username, 'md', top1.avatar_url)}</div>
        <div class="w-6 h-6 mx-auto mb-1 rounded-full bg-white text-black font-black text-xs flex items-center justify-center shadow-md">1</div>
        <div class="font-black text-xs text-white truncate">${top1.username}</div>
        <div class="font-condensed font-black text-base text-white">${top1.total_points.toFixed(1)} <span class="text-[10px]">pts</span></div>
      ` : '<div class="text-zinc-600 text-xs">-</div>'}
    </div>

    <!-- 3ème Place -->
    <div class="podium-step-3 rounded-[8px] p-2.5 text-center border-[3px] border-black bg-[#18181e] shadow-[6px_6px_0px_#000000] flex flex-col justify-end min-h-[95px]">
      ${top3 ? `
        <div class="flex justify-center mb-1">${getUserAvatarHtml(top3.username, 'sm', top3.avatar_url)}</div>
        <div class="w-5 h-5 mx-auto mb-1 rounded-full bg-zinc-700 text-zinc-100 font-black text-[10px] flex items-center justify-center">3</div>
        <div class="font-bold text-xs text-white truncate">${top3.username}</div>
        <div class="font-condensed font-black text-sm text-zinc-400">${top3.total_points.toFixed(1)} <span class="text-[10px]">pts</span></div>
      ` : '<div class="text-zinc-600 text-xs">-</div>'}
    </div>
  `;

  // Lignes du tableau complet
  rowsContainer.innerHTML = lb.map(player => {
    const isMe = state.currentUser && state.currentUser.id === player.user_id;

    return `
      <div class="grid grid-cols-12 px-3.5 py-3 items-center text-xs transition ${
        isMe ? 'bg-white/10 font-bold text-white border-l-2 border-white' : 'hover:bg-white/5'
      }">
        <div class="col-span-2 text-center font-condensed font-black text-slate-400">
          #${player.rank}
        </div>
        <div class="col-span-6 flex items-center gap-2 truncate">
          ${getUserAvatarHtml(player.username, 'xs', player.avatar_url)}
          <span class="truncate ${isMe ? 'text-white font-black' : 'text-zinc-200'}">${player.username}</span>
          ${isMe ? '<span class="text-[9px] uppercase tracking-wider bg-white text-black font-black px-1 rounded">Moi</span>' : ''}
        </div>
        <div class="col-span-2 text-center text-slate-400 text-[11px]">
          ${player.won_count}/${player.predictions_count}
        </div>
        <div class="col-span-2 text-right font-condensed font-black text-sm ${isMe ? 'text-white font-black' : 'text-zinc-200'}">
          ${player.total_points.toFixed(1)}
        </div>
      </div>
    `;
  }).join('');
}

// --- Pronostics d'Avant-Saison (Chantier 3) ---
async function loadSeasonCandidates() {
  if (!state.seasonCandidates) {
    try {
      state.seasonCandidates = await API.getSeasonCandidates();
      populateSeasonSelects();
    } catch (err) {
      console.error("Erreur chargement candidats d'avant-saison:", err);
    }
  }
}

function setSelectValueFuzzy(selectEl, value) {
  if (!selectEl || !value) return;
  selectEl.value = value;
  if (selectEl.value === value) return;
  const cleanVal = value.split('(')[0].trim().toLowerCase();
  for (let i = 0; i < selectEl.options.length; i++) {
    const opt = selectEl.options[i];
    if (opt.value.toLowerCase().includes(cleanVal)) {
      selectEl.value = opt.value;
      break;
    }
  }
}

function findMatchingPlayerOption(optionsList, playerValue) {
  if (!playerValue) return '';
  if (optionsList.includes(playerValue)) return playerValue;
  const cleanVal = playerValue.split('(')[0].trim().toLowerCase();
  const match = optionsList.find(p => p.toLowerCase().includes(cleanVal));
  return match || playerValue;
}

function populateSeasonSelects() {
  if (!state.seasonCandidates) return;
  const { teams, mvp, dpoy, roy } = state.seasonCandidates;

  const populate = (id, items, placeholder) => {
    const el = document.getElementById(id);
    if (!el) return;
    const currentVal = el.value;
    const sorted = [...(items || [])].sort((a, b) => a.localeCompare(b, 'fr'));
    el.innerHTML = `<option value="">${placeholder}</option>` +
      sorted.map(item => `<option value="${item}">${item}</option>`).join('');
    if (currentVal) setSelectValueFuzzy(el, currentVal);
  };

  populate('season-champion', teams, 'Sélectionne le champion de la Ligue...');
  populate('season-cup', teams, 'Sélectionne le vainqueur du Tournoi...');
  populate('season-mvp', mvp, 'Sélectionne le MVP...');
  populate('season-dpoy', dpoy, 'Sélectionne le DPOY...');
  populate('season-roy', roy, 'Sélectionne le Rookie de l\'année...');
}

function renderSeasonBanner() {
  const container = document.getElementById('season-banner-container');
  if (!container) return;

  if (!state.currentUser) {
    container.innerHTML = `
      <div class="p-3.5 bg-gradient-to-r from-[#171924] via-[#1b1e2c] to-[#171924] rounded-2xl border border-amber-500/20 shadow-lg flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-xl shrink-0 text-amber-400">
            <svg class='lucide-inline lucide-md lucide-amber-fill' viewBox='0 0 24 24'><path d='M6 9H4.5a2.5 2.5 0 0 1 0-5H6'/><path d='M18 9h1.5a2.5 2.5 0 0 0 0-5H18'/><path d='M4 22h16'/><path d='M10 14.66V17c0 .55-.47 1-1 1H7.5c-.55 0-1-.45-1-1v-2.34'/><path d='M14 14.66V17c0 .55.45 1 1 1h1.5c.55 0 1-.45 1-1v-2.34'/><path d='M18 2H6v7a6 6 0 0 0 12 0V2Z'/></svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-condensed font-black text-sm uppercase tracking-wide text-white">Pronos d'Avant-Saison</span>
              <span class="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">5 Choix Clés</span>
            </div>
            <p class="text-[11px] text-slate-400 leading-tight mt-0.5">
              MVP, ROY, DPOY, 6th Man, MIP : pronostique tes trophées avant le 1er match !
            </p>
          </div>
        </div>
        <button onclick="openAuthModal('login')" class="shrink-0 bg-amber-500 hover:bg-amber-400 text-black font-condensed font-black text-xs uppercase px-3 py-2 rounded-xl transition cursor-pointer shadow-md shadow-amber-500/20">
          Participer
        </button>
      </div>
    `;
    return;
  }

  const p = state.seasonPrediction;
  const isLocked = p ? p.is_locked : false;
  const picksCount = p ? [p.mvp, p.dpoy, p.roy, p.sixth_man, p.mip].filter(Boolean).length : 0;
  const hasAllPicks = picksCount === 5;

  if (isLocked) {
    container.innerHTML = `
      <div class="p-3.5 bg-[#12141a] rounded-2xl border border-[#23273a] shadow-lg flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-lg shrink-0 text-slate-400">
            <svg class='lucide-inline lucide-md lucide-muted' viewBox='0 0 24 24'><rect width='18' height='11' x='3' y='11' rx='2' ry='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/></svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-condensed font-black text-sm uppercase tracking-wide text-white">Pronos d'Avant-Saison</span>
              <span class="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30">Verrouillé</span>
            </div>
            <p class="text-[11px] text-slate-400 leading-tight mt-0.5">
              ${hasAllPicks ? 'Tes 5 choix sont enregistrés pour toute la saison !' : 'Saison débutée. Pronostics fermés.'}
            </p>
          </div>
        </div>
        <button onclick="openSeasonModal()" class="shrink-0 bg-[#1e2230] hover:bg-[#282d40] text-slate-200 border border-[#30374e] font-condensed font-black text-xs uppercase px-3 py-2 rounded-xl transition cursor-pointer">
          Voir mes choix
        </button>
      </div>
    `;
  } else if (hasAllPicks) {
    container.innerHTML = `
      <div class="p-3.5 bg-gradient-to-r from-[#121b18] via-[#13221e] to-[#121b18] rounded-2xl border border-emerald-500/30 shadow-lg flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-xl shrink-0 text-emerald-400">
            <svg class='lucide-inline lucide-md lucide-amber' viewBox='0 0 24 24'><path d='M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'/><path d='M20 3v4'/><path d='M22 5h-4'/></svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-condensed font-black text-sm uppercase tracking-wide text-white">Pronos d'Avant-Saison</span>
              <span class="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">5/5 Prêts</span>
            </div>
            <p class="text-[11px] text-emerald-400/90 leading-tight mt-0.5">
              Enregistrés ! Modifiables jusqu'au coup d'envoi du 1er match.
            </p>
          </div>
        </div>
        <button onclick="openSeasonModal()" class="shrink-0 bg-emerald-500 hover:bg-emerald-400 text-black font-condensed font-black text-xs uppercase px-3 py-2 rounded-xl transition cursor-pointer shadow-md shadow-emerald-500/20">
          Modifier
        </button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="p-3.5 bg-[#121216] rounded-2xl border border-[rgba(255,255,255,0.12)] shadow-md flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-xl shrink-0 text-white">
            <svg class='lucide-inline lucide-md lucide-amber-fill' viewBox='0 0 24 24'><path d='M6 9H4.5a2.5 2.5 0 0 1 0-5H6'/><path d='M18 9h1.5a2.5 2.5 0 0 0 0-5H18'/><path d='M4 22h16'/><path d='M10 14.66V17c0 .55-.47 1-1 1H7.5c-.55 0-1-.45-1-1v-2.34'/><path d='M14 14.66V17c0 .55.45 1 1 1h1.5c.55 0 1-.45 1-1v-2.34'/><path d='M18 2H6v7a6 6 0 0 0 12 0V2Z'/></svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-condensed font-black text-sm uppercase tracking-wide text-white">Pronos de Saison</span>
              <span class="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-white/10 text-white border border-white/20 font-bold">${picksCount}/5 Choix</span>
            </div>
            <p class="text-[11px] text-zinc-400 leading-tight mt-0.5">
              Choisis tes 5 vainqueurs avant le coup d'envoi officiel !
            </p>
          </div>
        </div>
        <button onclick="openSeasonModal()" class="shrink-0 bg-white hover:bg-zinc-200 text-black font-condensed font-black text-xs uppercase px-3 py-2 rounded-xl transition cursor-pointer shadow-sm">
          Pronostiquer
        </button>
      </div>
    `;
  }
}

async function openSeasonModal() {
  if (!state.currentUser) {
    openAuthModal('login');
    notify("Connecte-toi pour pronostiquer la saison !", "info");
    return;
  }

  await loadSeasonCandidates();

  if (!state.seasonPrediction) {
    try {
      state.seasonPrediction = await API.getSeasonPrediction();
    } catch (e) {
      console.error("Erreur seasonPrediction:", e);
    }
  }

  const p = state.seasonPrediction;
  const isLocked = p ? p.is_locked : false;

  const mvpSelect = document.getElementById('season-mvp');
  const dpoySelect = document.getElementById('season-dpoy');
  const roySelect = document.getElementById('season-roy');
  const sixthSelect = document.getElementById('season-sixth-man');
  const mipSelect = document.getElementById('season-mip');
  const submitBtn = document.getElementById('season-submit-btn');
  const lockAlert = document.getElementById('season-lock-alert');
  const errBox = document.getElementById('season-error-box');

  if (errBox) errBox.classList.add('hidden');

  if (mvpSelect && p) setSelectValueFuzzy(mvpSelect, p.mvp);
  if (dpoySelect && p) setSelectValueFuzzy(dpoySelect, p.dpoy);
  if (roySelect && p) setSelectValueFuzzy(roySelect, p.roy);
  if (sixthSelect && p) setSelectValueFuzzy(sixthSelect, p.sixth_man);
  if (mipSelect && p) setSelectValueFuzzy(mipSelect, p.mip);

  const selects = [mvpSelect, dpoySelect, roySelect, sixthSelect, mipSelect];

  if (isLocked) {
    selects.forEach(s => { if (s) s.disabled = true; });
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<svg class="lucide-inline lucide-sm lucide-muted" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Pronostics Verrouillés`;
      submitBtn.className = "w-full bg-[#18181c] text-zinc-500 font-condensed text-sm font-black uppercase tracking-wider py-2.5 rounded-xl transition cursor-not-allowed mt-2 border border-zinc-800";
    }
    if (lockAlert) {
      lockAlert.className = "mb-3 p-2.5 rounded-xl border text-xs font-semibold bg-rose-500/10 border-rose-500/30 text-rose-400";
      lockAlert.innerHTML = `
        <div class="flex items-center gap-1.5 font-bold uppercase">
          <svg class='lucide-inline lucide-md lucide-red' viewBox='0 0 24 24'><rect width='18' height='11' x='3' y='11' rx='2' ry='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/></svg> Pronostics Définitivement Verrouillés
        </div>
        <p class="mt-1 text-[11px] text-slate-300 font-normal">
          Le premier match officiel de la saison a débuté. Les choix sont gravés dans le marbre !
        </p>
      `;
      lockAlert.classList.remove('hidden');
    }
  } else {
    selects.forEach(s => { if (s) s.disabled = false; });
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = p && p.nba_champion ? "Mettre à jour mes 5 choix" : "Enregistrer mes 5 choix";
      submitBtn.className = "w-full bg-white hover:bg-zinc-200 text-black font-condensed text-sm font-black uppercase tracking-wider py-2.5 rounded-xl shadow-md transition cursor-pointer mt-2";
    }
    if (lockAlert) {
      let deadlineStr = "";
      if (p && p.deadline) {
        const d = new Date(p.deadline);
        deadlineStr = ` avant le ${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
      }
      lockAlert.className = "mb-3 p-2.5 rounded-xl border text-xs font-semibold bg-white/5 border-white/15 text-zinc-300";
      lockAlert.innerHTML = `
        <div class="flex items-center gap-1.5 font-bold uppercase text-amber-400">
          <svg class='lucide-inline lucide-xs lucide-amber' viewBox='0 0 24 24'><circle cx='12' cy='12' r='10'/><polyline points='12 6 12 12 16 14'/></svg> Choix Modifiables
        </div>
        <p class="mt-1 text-[11px] text-slate-300 font-normal">
          Tu peux ajuster tes pronostics à tout moment${deadlineStr} (coup d'envoi du 1er match).
        </p>
      `;
      lockAlert.classList.remove('hidden');
    }
  }

  const modal = document.getElementById('season-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeSeasonModal() {
  const modal = document.getElementById('season-modal');
  if (modal) modal.classList.add('hidden');
  const errBox = document.getElementById('season-error-box');
  if (errBox) errBox.classList.add('hidden');
}

async function handleSeasonSubmit(e) {
  e.preventDefault();
  const errBox = document.getElementById('season-error-box');
  if (errBox) errBox.classList.add('hidden');

  const mvp = document.getElementById('season-mvp')?.value;
  const dpoy = document.getElementById('season-dpoy')?.value;
  const roy = document.getElementById('season-roy')?.value;
  const sixth_man = document.getElementById('season-sixth-man')?.value;
  const mip = document.getElementById('season-mip')?.value;

  if (!mvp || !dpoy || !roy || !sixth_man || !mip) {
    if (errBox) {
      errBox.textContent = "Merci de compléter les 5 pronostics avant de valider.";
      errBox.classList.remove('hidden');
    }
    return;
  }

  try {
    const updated = await API.saveSeasonPrediction({
      nba_champion: null,
      cup_winner: null,
      mvp,
      dpoy,
      roy,
      sixth_man,
      mip
    });
    state.seasonPrediction = updated;
    closeSeasonModal();
    renderSeasonBanner();
    if (state.activeTab === 'profile') renderProfile();
    notify("Tes 5 pronostics de saison sont enregistrés !", "success");
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  }
}





// --- Gradients Pop Saturés pour les Cartes à Collectionner (Badges & Trophées) ---
function getBadgePopGradient(badgeId) {
  switch (badgeId) {
    case 'rookie':
      return 'linear-gradient(135deg, #FFB703 0%, #FB8500 50%, #D95D39 100%)';
    case 'sniper':
      return 'linear-gradient(135deg, #00F0FF 0%, #0077FE 50%, #002B80 100%)';
    case 'macon':
      return 'linear-gradient(135deg, #FF8A65 0%, #FF5722 50%, #D84315 100%)';
    case 'hot_streak':
      return 'linear-gradient(135deg, #FFEE58 0%, #FF9800 50%, #F44336 100%)';
    case 'underdog':
      return 'linear-gradient(135deg, #EA80FC 0%, #AA00FF 50%, #6200EA 100%)';
    case 'league_captain':
      return 'linear-gradient(135deg, #B9F6CA 0%, #00E676 50%, #00BFA5 100%)';
    case 'clutch':
      return 'linear-gradient(135deg, #FF80AB 0%, #FF1744 50%, #C51162 100%)';
    default:
      return 'linear-gradient(135deg, #FFD54F 0%, #FF9800 50%, #D95D39 100%)';
  }
}
window.getBadgePopGradient = getBadgePopGradient;

// --- Rendu du Profil & Statistiques (Clean Arcade Neo-Brutaliste) ---
async function renderProfile() {
  const container = document.getElementById('profile-content');
  if (!container) return;

  if (!state.currentUser) {
    container.innerHTML = `
      <div class="p-6 bg-[#18181e] rounded-[8px] border-[3px] border-black text-center space-y-4 shadow-[6px_6px_0px_#000000]">
        <div class="w-16 h-16 mx-auto rounded-full bg-[#121216] border-[3px] border-black flex items-center justify-center text-3xl shadow-[3px_3px_0px_#000000]">
          <svg class='lucide-inline lucide-xl lucide-muted' viewBox='0 0 24 24'><path d='M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'/><circle cx='12' cy='7' r='4'/></svg>
        </div>
        <div class="font-condensed font-black text-2xl text-[#F4F4F0] uppercase tracking-wide">Connecte-toi pour voir ton profil</div>
        <p class="text-xs text-zinc-400 max-w-xs mx-auto leading-relaxed">
          Accède à ton Winrate en direct, analyse tes cotes validées et collectionne les cartes de badges.
        </p>
        <button onclick="openAuthModal('login')" class="bg-[#D95D39] hover:bg-[#FF5722] text-white font-condensed font-black text-sm uppercase px-5 py-2.5 rounded-[8px] border-[2.5px] border-black shadow-[3px_3px_0px_#000000] transition cursor-pointer">
          Connexion / Inscription
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="py-12 text-center text-zinc-400 font-condensed text-sm flex flex-col items-center justify-center gap-2.5">
      <img src="/static/icons/logo-secondaire.png" alt="Pick 'n' Swipe" class="arcade-ball-loader" />
      <span class="uppercase tracking-wider">Chargement de tes statistiques...</span>
    </div>
  `;

  try {
    const stats = await API.getMyStats();
    if (!stats) return;

    const initials = stats.username.substring(0, 2).toUpperCase();
    const winrateColor = stats.winrate >= 55 ? 'text-emerald-400' : stats.winrate >= 40 ? 'text-[#FF9800]' : 'text-[#F4F4F0]';
    const avatarUrl = stats.avatar_url || (state.currentUser ? state.currentUser.avatar_url : null);

    container.innerHTML = `
      <!-- EN-TÊTE DU PROFIL NÉO-BRUTALISTE : GRAND AVATAR ROND CENTRÉ & PSEUDO GÉANT -->
      <div class="flex flex-col items-center justify-center text-center pt-2 pb-2 space-y-3">
        
        <!-- Très grand avatar rond tout en haut et au centre de l'écran -->
        <div class="relative cursor-pointer group" onclick="openAvatarSelectorModal()" title="Changer d'avatar Superstar NBA">
          <div class="w-28 h-28 sm:w-32 sm:h-32 rounded-full border-[4px] border-black shadow-[6px_6px_0px_#000000] overflow-hidden bg-[#18181e] flex items-center justify-center mx-auto transition-transform group-hover:scale-105 active:scale-95">
            ${avatarUrl ? `
              <img src="${avatarUrl}" alt="${escapeHtml(stats.username)}" class="w-full h-full object-cover rounded-full" />
            ` : `
              <div class="w-full h-full rounded-full bg-[#1c1b24] flex items-center justify-center text-white font-condensed font-black text-4xl">
                ${initials}
              </div>
            `}
          </div>
          <!-- Bouton circulaire Crayon modifier avatar : petit cercle, fond blanc, bordure noire de 2px -->
          <button 
            type="button"
            onclick="event.stopPropagation(); openAvatarSelectorModal();" 
            class="absolute bottom-0 right-0 sm:bottom-0.5 sm:right-0.5 w-8 h-8 rounded-full bg-white text-black border-2 border-black shadow-[2px_2px_0px_#000000] hover:bg-zinc-100 active:scale-90 transition flex items-center justify-center cursor-pointer z-10" 
            title="Modifier mon avatar"
          >
            <svg class="w-4 h-4 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
              <path d="m15 5 4 4"/>
            </svg>
          </button>
        </div>

        <!-- Pseudo écrit en très grand juste en dessous -->
        <div class="space-y-1">
          <h1 class="font-condensed font-black text-3xl sm:text-4xl text-[#F4F4F0] uppercase tracking-tight leading-none">
            ${escapeHtml(stats.username)}
          </h1>
          <div class="flex items-center justify-center gap-2 pt-0.5">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-[6px] bg-[#1a1924] border-2 border-black text-xs font-condensed font-black uppercase text-[#FFB703] shadow-[2px_2px_0px_#000000]">
              <svg class='lucide-inline lucide-sm lucide-amber-fill' viewBox='0 0 24 24'><path d='M6 9H4.5a2.5 2.5 0 0 1 0-5H6'/><path d='M18 9h1.5a2.5 2.5 0 0 0 0-5H18'/><path d='M4 22h16'/><path d='M10 14.66V17c0 .55-.47 1-1 1H7.5c-.55 0-1-.45-1-1v-2.34'/><path d='M14 14.66V17c0 .55.45 1 1 1h1.5c.55 0 1-.45 1-1v-2.34'/><path d='M18 2H6v7a6 6 0 0 0 12 0V2Z'/></svg> Rang #${stats.rank || '-'} • ${stats.total_points.toFixed(1)} PTS
            </span>
          </div>
          <p class="text-[11px] text-zinc-400 font-medium">
            ${escapeHtml(stats.email || 'Membre Pick \'n\' Swipe')}
          </p>
        </div>
      </div>

      <!-- Grille des Statistiques du Joueur Neo-Brutales -->
      <div class="grid grid-cols-3 gap-2 sm:gap-2.5">
        
        <!-- Winrate -->
        <div class="surface-card bg-[#18181e] border-[3px] border-black rounded-[8px] shadow-[4px_4px_0px_#000000] p-2.5 sm:p-3 text-center flex flex-col justify-between">
          <div class="text-[10px] font-condensed font-black uppercase tracking-wider text-zinc-400 truncate">Winrate</div>
          <div class="font-condensed font-black text-2xl sm:text-3xl ${winrateColor} my-0.5 leading-none">
            ${stats.winrate.toFixed(1)}%
          </div>
          <div class="text-[9px] sm:text-[10px] text-zinc-400 font-bold truncate">
            ${stats.won_predictions}/${stats.finished_predictions} validés
          </div>
        </div>

        <!-- Cote moyenne trouvée -->
        <div class="surface-card bg-[#18181e] border-[3px] border-black rounded-[8px] shadow-[4px_4px_0px_#000000] p-2.5 sm:p-3 text-center flex flex-col justify-between">
          <div class="text-[10px] font-condensed font-black uppercase tracking-wider text-zinc-400 truncate">Cote Moy.</div>
          <div class="font-condensed font-black text-2xl sm:text-3xl text-white my-0.5 leading-none">
            ${stats.avg_odds > 0 ? stats.avg_odds.toFixed(2) : '-'}
          </div>
          <div class="text-[9px] sm:text-[10px] text-zinc-400 font-bold truncate">
            sur victoires
          </div>
        </div>

        <!-- Plus grosse cote -->
        <div class="surface-card bg-[#18181e] border-[3px] border-black rounded-[8px] shadow-[4px_4px_0px_#000000] p-2.5 sm:p-3 text-center flex flex-col justify-between">
          <div class="text-[10px] font-condensed font-black uppercase tracking-wider text-zinc-400 truncate">Max Cote</div>
          <div class="font-condensed font-black text-2xl sm:text-3xl text-[#FFB703] my-0.5 leading-none">
            ${stats.max_odds > 0 ? stats.max_odds.toFixed(2) : '-'}
          </div>
          <div class="text-[9px] sm:text-[10px] text-zinc-400 font-bold truncate">
            record validé
          </div>
        </div>

      </div>

      <!-- Équipe Fétiche & Chat Noir -->
      <div class="grid grid-cols-2 gap-2">
        <div class="surface-card bg-[#18181e] border-[3px] border-black rounded-[8px] shadow-[4px_4px_0px_#000000] p-2.5 space-y-0.5">
          <div class="text-[9px] font-condensed font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1">
            <svg class='lucide-inline lucide-md lucide-green' viewBox='0 0 24 24'><path d='M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 20 .5 20 .5s1 4.5-1 10.5a7 7 0 0 1-8 9Z'/><path d='M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12'/></svg> Équipe Fétiche
          </div>
          <div class="font-condensed font-black text-base text-white truncate">
            ${stats.favorite_team || 'En cours...'}
          </div>
        </div>
        <div class="surface-card bg-[#18181e] border-[3px] border-black rounded-[8px] shadow-[4px_4px_0px_#000000] p-2.5 space-y-0.5">
          <div class="text-[9px] font-condensed font-black uppercase tracking-wider text-rose-400 flex items-center gap-1">
            <svg class='lucide-inline lucide-md' viewBox='0 0 24 24'><path d='M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3.1-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z'/><path d='M8 14v.5'/><path d='M16 14v.5'/><path d='M11.25 16.25h1.5L12 17l-.75-.75Z'/></svg> Chat Noir
          </div>
          <div class="font-condensed font-black text-base text-white truncate">
            ${stats.nemesis_team || 'Aucun'}
          </div>
        </div>
      </div>

      <!-- Section Badges & Trophées (Cartes à Collectionner Neo-Brutalistes) -->
      <div class="space-y-3 pt-2">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-condensed font-black text-xl uppercase tracking-tight text-white flex items-center gap-1.5">
              <span>Badges & Cartes Rares</span>
            </h3>
          </div>
          <span class="text-xs font-condensed font-black text-black bg-[#FFB703] px-2.5 py-1 rounded-[6px] border-2 border-black shadow-[2px_2px_0px_#000000] uppercase tracking-wider">
            ${stats.badges.filter(b => b.unlocked).length} / ${stats.badges.length} Débloqués
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          ${stats.badges.map((badge, idx) => {
            const cardNum = (idx + 1 < 10 ? '0' : '') + (idx + 1);
            const popGrad = getBadgePopGradient(badge.id);

            return `
              <div 
                class="badge-card collector-card-badge ${badge.unlocked ? 'unlocked' : 'locked'}"
                style="${badge.unlocked ? `background: ${popGrad};` : ''}"
              >
                <!-- En-tête de la carte à collectionner -->
                <div class="flex items-center justify-between border-b-2 border-black pb-1.5 text-[10px] font-condensed font-black uppercase tracking-wider">
                  <span class="${badge.unlocked ? 'text-black font-black' : 'text-zinc-400'}">
                    CARD #${cardNum} • SÉRIE 1
                  </span>
                  ${badge.unlocked ? `
                    <span class="px-2 py-0.5 rounded-[4px] bg-black text-[#FFD54F] border border-black shadow-[1px_1px_0px_#000000] flex items-center gap-1">
                      <svg class='lucide-inline lucide-md lucide-amber' viewBox='0 0 24 24'><path d='M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'/><path d='M20 3v4'/><path d='M22 5h-4'/></svg> DÉBLOQUÉ
                    </span>
                  ` : `
                    <span class="px-2 py-0.5 rounded-[4px] bg-[#111016] text-zinc-400 border border-black shadow-[1px_1px_0px_#000000] flex items-center gap-1">
                      <svg class='lucide-inline lucide-sm lucide-muted' viewBox='0 0 24 24'><rect width='18' height='11' x='3' y='11' rx='2' ry='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/></svg> ${badge.current} / ${badge.target}
                    </span>
                  `}
                </div>

                <!-- Corps de la carte : Cadre central & Illustration de la carte -->
                <div class="flex items-center gap-3 my-1">
                  <div class="collector-emblem-box ${badge.unlocked ? 'bg-white/20 text-[#D95D39] filter drop-shadow-[2px_2px_0px_#000]' : 'bg-black/60 text-zinc-500'}">
                    <span class="select-none flex items-center justify-center">
                      ${badge.icon}
                    </span>
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="font-condensed font-black text-lg uppercase leading-tight tracking-wide ${badge.unlocked ? 'text-black' : 'text-white'} truncate">
                      ${escapeHtml(badge.name)}
                    </div>
                    <div class="text-[11px] font-medium leading-snug mt-0.5 ${badge.unlocked ? 'text-black/90 font-semibold' : 'text-zinc-400'}">
                      ${escapeHtml(badge.description)}
                    </div>
                  </div>
                </div>

                <!-- Jauge de complétion & Tampon collector -->
                <div class="space-y-1.5 pt-1 border-t-2 border-black/80">
                  <div class="flex items-center justify-between text-[9px] font-condensed font-black uppercase tracking-wider ${badge.unlocked ? 'text-black font-black' : 'text-zinc-400'}">
                    <span>Progression</span>
                    <span>${Math.round(badge.progress_pct)}%</span>
                  </div>
                  <div class="w-full bg-black/80 rounded-[4px] h-2.5 overflow-hidden border-2 border-black p-0.5">
                    <div 
                      class="h-full rounded-[2px] transition-all duration-500 ${badge.unlocked ? 'bg-black' : 'bg-[#D95D39]'}" 
                      style="width: ${badge.progress_pct}%"
                    ></div>
                  </div>
                  <div class="collector-holo-stamp pt-0.5 ${badge.unlocked ? 'text-black/80 font-black' : 'text-zinc-500'}">
                    <svg class='lucide-inline lucide-xs lucide-amber-fill' viewBox='0 0 24 24'><polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'/></svg> PICK 'N' SWIPE • TROPHÉE <svg class='lucide-inline lucide-xs lucide-amber-fill' viewBox='0 0 24 24'><polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'/></svg>
                  </div>
                </div>

              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Déconnexion -->
      <div class="pt-2">
        <button onclick="handleLogout()" class="btn-tactile w-full py-2.5 rounded-[8px] bg-[#1a1a22] hover:bg-[#281a1d] border-[2.5px] border-black text-zinc-300 hover:text-rose-400 text-xs font-condensed font-black uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5 shadow-[3px_3px_0px_#000000]">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
          <span>Se déconnecter</span>
        </button>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
        Impossible de charger les statistiques : ${err.message}
      </div>
    `;
  }
}

// --- Utilitaires ---
function formatMatchTime(d) {
  const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} • ${time}`;
}

function notify(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.className = `fixed bottom-16 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-xs font-bold text-white shadow-2xl transition-all duration-200 z-50 ${
    type === 'error' ? 'bg-rose-600' : type === 'success' ? 'bg-emerald-600' : 'bg-[#1e2330] border border-[#2f3548]'
  }`;

  toast.classList.remove('opacity-0', 'pointer-events-none');
  setTimeout(() => {
    toast.classList.add('opacity-0', 'pointer-events-none');
  }, 2200);
}

// --- PWA & Partage ---
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/static/sw.js')
        .then(() => console.log('PWA Service Worker actif'))
        .catch(err => console.log('Erreur SW:', err));
    });
  }
}

async function shareApp() {
  const shareData = {
    title: 'HOOPS PRONO - Rejoins la ligue !',
    text: 'Viens pronostiquer les matchs de basket avec nous en 1-clic ! Qui sera n°1 ?',
    url: window.location.origin
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch {
      // Ignorer si l'utilisateur annule le menu
    }
  } else {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      notify("Lien copié dans le presse-papier !", "success");
    } catch {
      notify(`Partage ce lien : ${window.location.origin}`, "info");
    }
  }
}

// --- Ligues Privées & Partage (Chantier 5) ---

function getUserAvatarHtml(username, size = 'sm', avatarUrl = null) {
  const safeName = username || '?';
  const url = avatarUrl || (state.currentUser && state.currentUser.username === username ? state.currentUser.avatar_url : null);
  const sizeClasses = size === 'xl'
    ? 'w-28 h-28 sm:w-32 sm:h-32 text-4xl font-black'
    : (size === 'lg' 
      ? 'w-12 h-12 text-sm font-black' 
      : (size === 'md' ? 'w-8 h-8 text-xs font-bold' : (size === 'xs' ? 'w-6 h-6 text-[9px] font-black' : 'w-7 h-7 text-[10px] font-black')));

  if (url) {
    return `<img src="${url}" alt="${safeName}" class="${sizeClasses} rounded-full object-cover border-2 border-black shadow-[2px_2px_0px_#000000] shrink-0 bg-[#18181b]" onerror="this.style.display='none'" />`;
  }

  const initials = safeName.substring(0, 2).toUpperCase();
  const tones = [
    'bg-[#27272a] text-zinc-200 border-2 border-black',
    'bg-[#18181b] text-white border-2 border-black',
    'bg-[#3f3f46] text-white border-2 border-black',
    'bg-[#202024] text-zinc-300 border-2 border-black',
    'bg-[#2e2e36] text-zinc-100 border-2 border-black'
  ];
  let hash = 0;
  for (let i = 0; i < safeName.length; i++) {
    hash = safeName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const toneClass = tones[Math.abs(hash) % tones.length];

  return `<div class="${sizeClasses} rounded-full ${toneClass} flex items-center justify-center shadow-[2px_2px_0px_#000000] uppercase tracking-wider shrink-0 font-condensed font-black">${initials}</div>`;
}

async function loadAndRenderLeagues() {
  const listContainer = document.getElementById('my-leagues-list');
  if (!listContainer) return;

  if (!state.currentUser) {
    document.getElementById('leagues-list-container').classList.remove('hidden');
    document.getElementById('league-detail-container').classList.add('hidden');
    listContainer.innerHTML = `
      <div class="p-6 bg-[#12141a] rounded-2xl border border-[#1f222d] text-center space-y-4 shadow-xl">
        <div class="w-12 h-12 rounded-2xl bg-white/10 text-white mx-auto flex items-center justify-center text-2xl border border-white/20">
          <svg class='lucide-inline lucide-md lucide-muted' viewBox='0 0 24 24'><rect width='18' height='11' x='3' y='11' rx='2' ry='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/></svg>
        </div>
        <div class="font-condensed font-black text-lg text-white">Connexion requise</div>
        <p class="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
          Connecte-toi ou crée un compte pour créer ta ligue privée ou rejoindre celle de tes amis avec un code d'invitation !
        </p>
        <button onclick="openAuthModal('login')" class="px-5 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-condensed font-black uppercase text-xs tracking-wider transition shadow-md cursor-pointer">
          Se connecter / S'inscrire
        </button>
      </div>
    `;
    return;
  }

  try {
    const leagues = await API.getMyLeagues();
    state.myLeagues = leagues;

    if (state.activeLeague) {
      // Si une ligue était déjà ouverte, rafraîchir ses données
      await viewLeague(state.activeLeague.id);
    } else {
      renderLeaguesList();
    }
  } catch (err) {
    console.error("Erreur chargement ligues:", err);
    notify("Erreur lors de la récupération des ligues", "error");
  }
}

function renderLeaguesList() {
  const listContainer = document.getElementById('my-leagues-list');
  const leaguesListWrapper = document.getElementById('leagues-list-container');
  const detailContainer = document.getElementById('league-detail-container');
  if (!listContainer || !leaguesListWrapper || !detailContainer) return;

  leaguesListWrapper.classList.remove('hidden');
  detailContainer.classList.add('hidden');

  const leagues = state.myLeagues || [];

  if (leagues.length === 0) {
    listContainer.innerHTML = `
      <div class="p-6 bg-[#12141a] rounded-2xl border border-[#1f222d] text-center space-y-4 shadow-xl">
        <div class="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 mx-auto flex items-center justify-center text-2xl border border-amber-500/20 shadow-lg shadow-amber-500/10">
          <svg class='lucide-inline lucide-md lucide-amber-fill' viewBox='0 0 24 24'><path d='M6 9H4.5a2.5 2.5 0 0 1 0-5H6'/><path d='M18 9h1.5a2.5 2.5 0 0 0 0-5H18'/><path d='M4 22h16'/><path d='M10 14.66V17c0 .55-.47 1-1 1H7.5c-.55 0-1-.45-1-1v-2.34'/><path d='M14 14.66V17c0 .55.45 1 1 1h1.5c.55 0 1-.45 1-1v-2.34'/><path d='M18 2H6v7a6 6 0 0 0 12 0V2Z'/></svg>
        </div>
        <div class="font-condensed font-black text-lg text-white">Aucune ligue pour le moment</div>
        <p class="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
          Défie tes amis et collègues ! Crée ta propre ligue pour générer un code d'invitation unique ou rejoins une ligue existante.
        </p>
        <div class="flex items-center justify-center gap-2 pt-1">
          <button onclick="openJoinLeagueModal()" class="px-4 py-2 rounded-xl bg-[#171a24] hover:bg-[#202534] border border-[#2b3044] text-slate-200 font-condensed font-bold text-xs uppercase tracking-wider transition cursor-pointer">
            <svg class='lucide-inline lucide-sm lucide-amber' viewBox='0 0 24 24'><path d='m15.5 7.5 2.3-2.3a1 1 0 0 1 1.4 0l1.1 1.1a1 1 0 0 1 0 1.4L18 10'/><path d='m2.1 21.8 6.4-6.3'/><path d='M8.5 15.5 10 14'/><circle cx='15' cy='9' r='5'/></svg> Rejoindre
          </button>
          <button onclick="openCreateLeagueModal()" class="px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-condensed font-black text-xs uppercase tracking-wider transition shadow-md cursor-pointer">
            + Créer une ligue
          </button>
        </div>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = leagues.map(l => {
    const isCreator = state.currentUser && state.currentUser.id === l.creator_id;
    const rankLabel = l.user_rank ? (l.user_rank === 1 ? `<svg class="lucide-inline lucide-sm lucide-gold" viewBox="0 0 24 24"><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/></svg> #1` : `#${l.user_rank}`) : "-";

    return `
      <div 
        onclick="viewLeague(${l.id})" 
        class="bg-[#12141a] hover:bg-[#161924] border border-[#1f222d] hover:border-amber-400/50 rounded-2xl p-4 transition-all duration-150 shadow-lg cursor-pointer group active:scale-[0.99] flex items-center justify-between gap-3"
      >
        <div class="space-y-1.5 flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="font-condensed font-black text-lg text-white group-hover:text-amber-300 uppercase tracking-tight transition truncate">${escapeHtml(l.name)}</h3>
            ${isCreator ? '<span class="text-[9px] bg-amber-400/20 text-amber-300 border border-amber-400/30 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0">Créateur</span>' : ''}
          </div>
          <div class="flex items-center gap-3 text-xs text-slate-400">
            <span class="flex items-center gap-1"><svg class='lucide-inline lucide-sm lucide-muted' viewBox='0 0 24 24'><path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/></svg> ${l.members_count} membre${l.members_count > 1 ? 's' : ''}</span>
            <span>•</span>
            <span class="text-amber-400 font-bold flex items-center gap-1">Mon rang : ${rankLabel}</span>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <div class="w-8 h-8 rounded-xl bg-white/5 group-hover:bg-amber-400/20 group-hover:text-amber-300 text-slate-400 flex items-center justify-center transition text-sm font-black">
            →
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function viewLeague(leagueId) {
  try {
    const detail = await API.getLeagueDetail(leagueId);
    state.activeLeague = detail;
    renderLeagueDetail(detail);

    // Démarrage du rafraîchissement automatique du chat (toutes les 3.5s)
    if (state.chatPollingInterval) {
      clearInterval(state.chatPollingInterval);
    }
    state.chatPollingInterval = setInterval(() => {
      if (state.activeLeague && state.activeLeague.id === leagueId) {
        loadLeagueMessages(leagueId, true);
      } else {
        clearInterval(state.chatPollingInterval);
        state.chatPollingInterval = null;
      }
    }, 3500);
  } catch (err) {
    console.error("Erreur consultation ligue:", err);
    notify(err.message || "Impossible d'accéder à cette ligue", "error");
  }
}

function backToLeaguesList() {
  if (state.chatPollingInterval) {
    clearInterval(state.chatPollingInterval);
    state.chatPollingInterval = null;
  }
  state.activeLeague = null;
  renderLeaguesList();
}

function renderLeagueDetail(league) {
  const leaguesListWrapper = document.getElementById('leagues-list-container');
  const detailContainer = document.getElementById('league-detail-container');
  if (!leaguesListWrapper || !detailContainer) return;

  leaguesListWrapper.classList.add('hidden');
  detailContainer.classList.remove('hidden');

  const members = league.members || [];
  const top1 = members[0];
  const top2 = members[1];
  const top3 = members[2];

  detailContainer.innerHTML = `
    <!-- Barre de retour et En-tête -->
    <div class="flex items-center justify-between pb-2 border-b border-[#1b1e28]">
      <button onclick="backToLeaguesList()" class="px-2.5 py-1 rounded-lg bg-[#171a24] hover:bg-[#202534] border border-[#2b3044] text-slate-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer">
        ← Retour aux ligues
      </button>
      <button onclick="leaveLeagueAction(${league.id})" class="text-[11px] text-rose-400 hover:text-rose-300 font-bold transition cursor-pointer">
        Quitter la ligue
      </button>
    </div>

    <!-- Titre et infos ligue -->
    <div class="space-y-1">
      <div class="flex items-center gap-2">
        <h2 class="font-condensed font-black text-2xl uppercase tracking-tight text-white">${escapeHtml(league.name)}</h2>
        <span class="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
          ${league.members_count} membre${league.members_count > 1 ? 's' : ''}
        </span>
      </div>
      <p class="text-xs text-slate-400">Créée par <span class="text-slate-200 font-bold">${escapeHtml(league.creator_username)}</span></p>
    </div>

    <!-- Bloc d'invitation et de partage au sein de la ligue -->
    <div class="p-4 bg-gradient-to-r from-amber-500/10 via-[#161822] to-amber-500/10 border border-amber-500/30 rounded-2xl space-y-3 shadow-lg">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div class="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <svg class='lucide-inline lucide-md lucide-amber' viewBox='0 0 24 24'><path d='M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z'/><path d='M13 5v2'/><path d='M13 17v2'/><path d='M13 11v2'/></svg> Inviter des amis dans la ligue
          </div>
          <div class="text-xs text-slate-300">Transmets ce code ou le lien direct pour qu'ils rejoignent ta ligue :</div>
        </div>
        <div class="flex items-center gap-2">
          <div class="font-mono text-xl sm:text-2xl font-black tracking-widest text-amber-300 bg-[#12141c] border border-amber-500/40 px-3 py-1 rounded-xl shadow-inner select-all">
            ${league.code}
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
        <button onclick="copyLeagueCode('${league.code}')" class="px-3 py-2 rounded-xl bg-[#1e2230] hover:bg-[#282e42] border border-[#2e354c] text-slate-200 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer">
          <svg class='lucide-inline lucide-sm lucide-white' viewBox='0 0 24 24'><rect width='8' height='4' x='8' y='2' rx='1' ry='1'/><path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'/></svg> Copier le code
        </button>
        <button onclick="shareLeague('${league.code}', '${escapeHtml(league.name).replace(/'/g, "\\'")}')" class="px-3 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-black uppercase font-condensed tracking-wider transition shadow-md shadow-amber-400/20 flex items-center justify-center gap-1.5 cursor-pointer">
          <svg class='lucide-inline lucide-sm lucide-white' viewBox='0 0 24 24'><path d='M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8'/><polyline points='16 6 12 2 8 6'/><line x1='12' x2='12' y1='2' y2='15'/></svg> Partager l'invit
        </button>
      </div>
    </div>

    <!-- Podium Top 3 de la Ligue -->
    ${members.length >= 2 ? `
      <div class="grid grid-cols-3 gap-2 items-end pt-2 pb-1">
        <!-- 2ème Place -->
        <div class="podium-step-2 rounded-xl p-2.5 text-center border flex flex-col justify-end min-h-[110px]">
          ${top2 ? `
            <div class="flex justify-center mb-1">${getUserAvatarHtml(top2.username, 'md', top2.avatar_url)}</div>
            <div class="w-5 h-5 mx-auto mb-1 rounded-full bg-slate-300 text-black font-black text-[10px] flex items-center justify-center">2</div>
            <div class="font-bold text-xs text-white truncate">${top2.username}</div>
            <div class="font-condensed font-black text-sm text-slate-300">${top2.total_points.toFixed(1)} <span class="text-[9px]">pts</span></div>
          ` : '<div class="text-slate-600 text-xs">-</div>'}
        </div>

        <!-- 1ère Place (Au centre, surélevé) -->
        <div class="podium-step-1 rounded-xl p-3 text-center border flex flex-col justify-end min-h-[135px]">
          ${top1 ? `
            <div class="flex justify-center mb-1.5">${getUserAvatarHtml(top1.username, 'lg', top1.avatar_url)}</div>
            <div class="w-6 h-6 mx-auto mb-1 rounded-full bg-amber-400 text-black font-black text-xs flex items-center justify-center shadow-lg shadow-amber-400/30">1</div>
            <div class="font-black text-xs text-white truncate">${top1.username}</div>
            <div class="font-condensed font-black text-base text-amber-400">${top1.total_points.toFixed(1)} <span class="text-[10px]">pts</span></div>
          ` : '<div class="text-slate-600 text-xs">-</div>'}
        </div>

        <!-- 3ème Place -->
        <div class="podium-step-3 rounded-xl p-2.5 text-center border flex flex-col justify-end min-h-[95px]">
          ${top3 ? `
            <div class="flex justify-center mb-1">${getUserAvatarHtml(top3.username, 'md', top3.avatar_url)}</div>
            <div class="w-5 h-5 mx-auto mb-1 rounded-full bg-amber-700 text-white font-black text-[10px] flex items-center justify-center">3</div>
            <div class="font-bold text-xs text-white truncate">${top3.username}</div>
            <div class="font-condensed font-black text-sm text-amber-500">${top3.total_points.toFixed(1)} <span class="text-[9px]">pts</span></div>
          ` : '<div class="text-slate-600 text-xs">-</div>'}
        </div>
      </div>
    ` : ''}

    <!-- Tableau de Classement Interne -->
    <div class="bg-[#12141a] border border-[#1f222d] rounded-xl overflow-hidden shadow-lg">
      <div class="grid grid-cols-12 px-3.5 py-2 bg-[#171922] border-b border-[#212432] text-[10px] font-black uppercase tracking-wider text-slate-400">
        <div class="col-span-2 text-center">Rang</div>
        <div class="col-span-6">Joueur</div>
        <div class="col-span-2 text-center">Pronos</div>
        <div class="col-span-2 text-right">Pts</div>
      </div>
      <div class="divide-y divide-[#1b1e28]">
        ${members.map(member => {
          const isMe = state.currentUser && state.currentUser.id === member.user_id;
          let rankBadge = `<span class="text-slate-400 font-bold">${member.rank}</span>`;
          if (member.rank === 1) rankBadge = `<svg class="lucide-inline lucide-sm lucide-gold" viewBox="0 0 24 24"><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/></svg>`;
          else if (member.rank === 2) rankBadge = `<svg class="lucide-inline lucide-sm lucide-silver" viewBox="0 0 24 24"><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/></svg>`;
          else if (member.rank === 3) rankBadge = `<svg class="lucide-inline lucide-sm lucide-bronze" viewBox="0 0 24 24"><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/></svg>`;

          return `
            <div class="grid grid-cols-12 px-3.5 py-3 items-center text-xs transition ${
              isMe ? 'bg-white/10 font-bold text-white border-l-2 border-white' : 'hover:bg-white/5'
            }">
              <div class="col-span-2 text-center text-sm font-black">
                ${rankBadge}
              </div>
              <div class="col-span-6 flex items-center gap-2 truncate">
                ${getUserAvatarHtml(member.username, 'sm', member.avatar_url)}
                <div class="truncate">
                  <div class="font-bold flex items-center gap-1.5 truncate">
                    <span class="truncate">${member.username}</span>
                    ${member.is_creator ? '<span class="text-[9px] bg-amber-400/20 text-amber-400 px-1 rounded font-normal shrink-0"><svg class="lucide-inline lucide-xs lucide-amber-fill" viewBox="0 0 24 24"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5.21 16.5h13.58"/></svg></span>' : ''}
                    ${isMe ? '<span class="text-[9px] bg-white text-black font-black px-1 rounded uppercase tracking-wider shrink-0">Moi</span>' : ''}
                  </div>
                </div>
              </div>
              <div class="col-span-2 text-center text-slate-400 font-mono text-[11px]">
                ${member.won_count}/${member.predictions_count}
              </div>
              <div class="col-span-2 text-right font-condensed font-black text-white text-sm">
                ${member.total_points.toFixed(1)}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    </div>
        <button onclick="loadLeagueMessages(${league.id})" class="text-[11px] text-slate-400 hover:text-white p-1 cursor-pointer" title="Rafraîchir les messages">
          <svg class='lucide-inline lucide-sm lucide-white' viewBox='0 0 24 24'><path d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'/><path d='M21 3v5h-5'/><path d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'/><path d='M8 16H3v5'/></svg>
        </button>
      </div>

      <!-- Liste des messages -->
      <div id="league-chat-messages" class="max-h-64 overflow-y-auto space-y-2 pr-1 text-xs">
        <div class="text-center text-slate-500 text-[11px] py-4">Chargement des messages...</div>
      </div>

      <!-- Formulaire d'envoi -->
      <form id="league-chat-form" onsubmit="handleSendLeagueMessage(event, ${league.id}); return false;" class="flex items-center gap-2">
        <input 
          type="text" 
          id="league-chat-input" 
          maxlength="280" 
          placeholder="Chambre tes potes... (ex: Préparez les mouchoirs...)" 
          class="flex-1 bg-[#181a24] border border-[#282c3e] rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-white"
          onkeydown="if(event.key==='Enter' && !event.shiftKey){ event.preventDefault(); handleSendLeagueMessage(event, ${league.id}); }"
        >
        <button 
          id="league-chat-submit-btn"
          type="submit" 
          class="px-3.5 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-condensed font-black text-xs uppercase tracking-wider transition cursor-pointer shrink-0 shadow-md"
        >
          Envoyer
        </button>
      </form>
    </div>
  `;

  // Charger les messages du chat de la ligue
  loadLeagueMessages(league.id);
}

// --- Modales Création / Rejoindre Ligue ---
function openCreateLeagueModal() {
  if (!state.currentUser) {
    openAuthModal('login');
    notify("Connecte-toi pour créer une ligue", "info");
    return;
  }
  const modal = document.getElementById('create-league-modal');
  if (modal) {
    modal.classList.remove('hidden');
    const input = document.getElementById('create-league-name');
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

function closeCreateLeagueModal() {
  const modal = document.getElementById('create-league-modal');
  if (modal) modal.classList.add('hidden');
}

function openJoinLeagueModal(prefillCode = '') {
  if (!state.currentUser) {
    openAuthModal('login');
    notify("Connecte-toi pour rejoindre une ligue", "info");
    return;
  }
  const modal = document.getElementById('join-league-modal');
  if (modal) {
    modal.classList.remove('hidden');
    const input = document.getElementById('join-league-code');
    if (input) {
      input.value = prefillCode || '';
      input.focus();
    }
  }
}

function closeJoinLeagueModal() {
  const modal = document.getElementById('join-league-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleCreateLeagueSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('create-league-name');
  if (!nameInput) return;

  const name = nameInput.value.trim();
  if (name.length < 3) {
    notify("Le nom doit faire au moins 3 caractères", "error");
    return;
  }

  try {
    const newLeague = await API.createLeague(name);
    closeCreateLeagueModal();
    notify(`Ligue "${newLeague.name}" créée avec succès !`, "success");
    await loadAndRenderLeagues();
    viewLeague(newLeague.id);
  } catch (err) {
    console.error("Erreur création ligue:", err);
    notify(err.message || "Erreur lors de la création de la ligue", "error");
  }
}

async function handleJoinLeagueSubmit(e) {
  e.preventDefault();
  const codeInput = document.getElementById('join-league-code');
  if (!codeInput) return;

  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 6) {
    notify("Le code d'invitation doit comporter 6 caractères", "error");
    return;
  }

  try {
    const joined = await API.joinLeague(code);
    closeJoinLeagueModal();
    notify(`Tu as rejoint la ligue "${joined.name}" !`, "success");
    await loadAndRenderLeagues();
    viewLeague(joined.id);
  } catch (err) {
    console.error("Erreur rejoindre ligue:", err);
    notify(err.message || "Code invalide ou introuvable", "error");
  }
}

async function copyLeagueCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    notify(`Code ${code} copié dans le presse-papier !`, "success");
  } catch {
    notify(`Code d'invitation : ${code}`, "info");
  }
}

async function shareLeague(code, name) {
  const shareUrl = `${window.location.origin}/?join=${code}`;
  const shareData = {
    title: `Rejoins ma ligue HOOPS Prono : ${name}`,
    text: `Rejoins ma ligue privée "${name}" sur HOOPS Prono avec le code : ${code} !`,
    url: shareUrl
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch {
      // Annulation utilisateur
    }
  } else {
    try {
      await navigator.clipboard.writeText(shareUrl);
      notify("Lien d'invitation copié dans le presse-papier !", "success");
    } catch {
      copyLeagueCode(code);
    }
  }
}

async function leaveLeagueAction(leagueId) {
  if (!confirm("Es-tu sûr de vouloir quitter cette ligue ?")) {
    return;
  }

  try {
    const res = await API.leaveLeague(leagueId);
    notify(res.message || "Tu as quitté la ligue", "info");
    backToLeaguesList();
    await loadAndRenderLeagues();
  } catch (err) {
    console.error("Erreur départ ligue:", err);
    notify(err.message || "Impossible de quitter la ligue", "error");
  }
}

// --- Améliorations MPP : Transparence des pronostics de ligue ---
async function openLeagueMatchVotesModal(matchId, explicitLeagueId = null) {
  if (!state.currentUser) {
    openAuthModal('login');
    notify("Connecte-toi pour voir les pronos de ta ligue !", "info");
    return;
  }

  // Si l'utilisateur n'a pas encore de ligues chargées, on tente de les récupérer
  if (!state.myLeagues || state.myLeagues.length === 0) {
    try {
      state.myLeagues = await API.getMyLeagues();
    } catch (e) {
      console.error(e);
    }
  }

  if (!state.myLeagues || state.myLeagues.length === 0) {
    notify("Rejoins ou crée d'abord une ligue privée pour voir les pronos !", "info");
    selectTab('leagues');
    return;
  }

  state.activeLeagueVotesMatchId = matchId;
  const targetLeagueId = explicitLeagueId || state.activeLeagueVotesLeagueId || state.activeLeague?.id || state.myLeagues[0].id;
  state.activeLeagueVotesLeagueId = targetLeagueId;

  const modal = document.getElementById('league-match-votes-modal');
  const selectorContainer = document.getElementById('lmv-league-selector-container');
  const leagueSelect = document.getElementById('lmv-league-select');
  const content = document.getElementById('lmv-modal-content');
  const modalTitle = document.getElementById('lmv-modal-title');
  const modalSub = document.getElementById('lmv-modal-subtitle');

  if (!modal || !content) return;

  // Configuration du sélecteur de ligue
  if (state.myLeagues.length > 1 && leagueSelect && selectorContainer) {
    selectorContainer.classList.remove('hidden');
    leagueSelect.innerHTML = state.myLeagues.map(l => 
      `<option value="${l.id}" ${l.id === targetLeagueId ? 'selected' : ''}>${l.name}</option>`
    ).join('');
  } else if (selectorContainer) {
    selectorContainer.classList.add('hidden');
  }

  const match = state.matches.find(m => m.id === matchId);
  if (match && modalTitle) {
    modalTitle.textContent = `${match.home_team.code} vs ${match.away_team.code}`;
  }

  content.innerHTML = `
    <div class="text-center py-6 text-zinc-400 text-xs flex items-center justify-center gap-2.5">
      <img src="/static/icons/logo-secondaire.png" alt="Pick 'n' Swipe" class="arcade-ball-loader" />
      <span>Chargement des pronostics...</span>
    </div>
  `;
  modal.classList.remove('hidden');

  try {
    const data = await API.getLeagueMatchVotes(targetLeagueId, matchId);
    renderLeagueMatchVotes(data, match);
  } catch (err) {
    content.innerHTML = `
      <div class="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs text-center">
        ${err.message || "Erreur de chargement des pronostics de la ligue."}
      </div>
    `;
  }
}

function closeLeagueMatchVotesModal() {
  const modal = document.getElementById('league-match-votes-modal');
  if (modal) modal.classList.add('hidden');
  state.activeLeagueVotesMatchId = null;
}

function renderLeagueMatchVotes(data, match) {
  const content = document.getElementById('lmv-modal-content');
  const modalSub = document.getElementById('lmv-modal-subtitle');
  if (!content) return;

  if (modalSub) {
    modalSub.textContent = data.is_revealed 
      ? "<svg class='lucide-inline lucide-sm lucide-green' viewBox='0 0 24 24'><rect width='18' height='11' x='3' y='11' rx='2' ry='2'/><path d='M7 11V7a5 5 0 0 1 9.9-1'/></svg> Coup d'envoi sifflé : les pronostics sont révélés !"
      : "<svg class='lucide-inline lucide-sm lucide-muted' viewBox='0 0 24 24'><rect width='18' height='11' x='3' y='11' rx='2' ry='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/></svg> Avant coup d'envoi : les choix restent secrets !";
  }

  if (!data.is_revealed) {
    // Mode Secret avant le match
    content.innerHTML = `
      <div class="p-3 bg-gradient-to-r from-amber-500/10 to-[#181a24] border border-amber-500/30 rounded-xl space-y-1.5 text-center">
        <div class="text-xs font-bold text-amber-400 flex items-center justify-center gap-1.5">
          <svg class='lucide-inline lucide-md lucide-muted' viewBox='0 0 24 24'><rect width='18' height='11' x='3' y='11' rx='2' ry='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/></svg> Pronostics secrets (Suspense MPP)
        </div>
        <p class="text-[11px] text-slate-300">
          Les choix d'équipes et les Bonus x2 seront révélés au coup d'envoi du match !
        </p>
        <div class="text-xs font-black text-white pt-1">
          <span class="text-white">${data.voted_count}</span> / ${data.total_members} membres ont pronostiqué
        </div>
      </div>

      <div class="space-y-1.5 pt-1">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Statut des membres</div>
        <div class="divide-y divide-[#1f222e] bg-[#171922] border border-[#232738] rounded-xl overflow-hidden">
          ${data.votes.map(v => {
            const isMe = state.currentUser && state.currentUser.id === v.user_id;
            return `
              <div class="flex items-center justify-between px-3 py-2 text-xs">
                <div class="flex items-center gap-2">
                  ${getUserAvatarHtml(v.username, 'sm', v.avatar_url)}
                  <span class="font-bold text-white ${isMe ? 'text-[#ff5500]' : ''}">${v.username}</span>
                  ${isMe ? '<span class="text-[9px] bg-white text-black font-black px-1 rounded uppercase">Moi</span>' : ''}
                </div>
                <div>
                  ${v.has_voted 
                    ? `<span class="text-[10px] font-black uppercase text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1"><span><svg class="lucide-inline lucide-xs lucide-green" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span> A voté</span>`
                    : '<span class="text-[10px] font-bold uppercase text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full flex items-center gap-1"><svg class=\'lucide-inline lucide-xs lucide-muted\' viewBox=\'0 0 24 24\'><circle cx=\'12\' cy=\'12\' r=\'10\'/><polyline points=\'12 6 12 12 16 14\'/></svg> En attente</span>'
                  }
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  } else {
    // Mode Révélé après le coup d'envoi
    const homeColor = match?.home_team?.color || '#3b82f6';
    const awayColor = match?.away_team?.color || '#ef4444';
    const homeCode = match?.home_team?.code || data.home_team_city;
    const awayCode = match?.away_team?.code || data.away_team_city;

    content.innerHTML = `
      <!-- Jauge de répartition des votes en % -->
      <div class="p-3 bg-[#171922] border border-[#232738] rounded-xl space-y-2">
        <div class="flex items-center justify-between text-xs font-black uppercase">
          <div class="flex items-center gap-1.5" style="color: ${homeColor}">
            <span>${homeCode}</span>
            <span class="text-white">${data.home_pct}%</span>
            <span class="text-[10px] text-slate-400 font-normal">(${data.home_votes_count})</span>
          </div>
          <div class="flex items-center gap-1.5" style="color: ${awayColor}">
            <span class="text-[10px] text-slate-400 font-normal">(${data.away_votes_count})</span>
            <span class="text-white">${data.away_pct}%</span>
            <span>${awayCode}</span>
          </div>
        </div>

        <div class="vote-gauge-bar">
          <div class="vote-gauge-home" style="width: ${data.home_pct}%; background-color: ${homeColor};"></div>
          <div class="vote-gauge-away" style="width: ${data.away_pct}%; background-color: ${awayColor};"></div>
        </div>
      </div>

      <!-- Liste détaillée des choix -->
      <div class="space-y-1.5 pt-1">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Choix de la ligue</div>
        <div class="divide-y divide-[#1f222e] bg-[#171922] border border-[#232738] rounded-xl overflow-hidden">
          ${data.votes.map(v => {
            const isMe = state.currentUser && state.currentUser.id === v.user_id;
            return `
              <div class="flex items-center justify-between px-3 py-2 text-xs">
                <div class="flex items-center gap-2 truncate">
                  ${getUserAvatarHtml(v.username, 'sm', v.avatar_url)}
                  <span class="font-bold text-white truncate ${isMe ? 'text-[#ff5500]' : ''}">${v.username}</span>
                  ${isMe ? '<span class="text-[9px] bg-white text-black font-black px-1 rounded uppercase shrink-0">Moi</span>' : ''}
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  ${v.has_voted ? `
                    <span class="font-condensed font-black text-xs px-2 py-0.5 rounded bg-[#202535] border border-[#2c3348] text-white">
                      ${v.selected_team_code || v.selected_team_city}
                    </span>
                    ${v.is_boosted ? '<span class="text-[10px] font-black text-amber-400 bg-amber-400/15 border border-amber-400/30 px-1.5 py-0.5 rounded" title="Bonus x2 joué !"> x2</span>' : ''}
                    ${v.points_won > 0 ? `<span class="font-condensed font-black text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">+${v.points_won.toFixed(1)}</span>` : ''}
                  ` : `
                    <span class="text-[10px] text-slate-500 italic">Pas de prono</span>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }
}

// --- Améliorations MPP : Mur de Chambrage (Trash-Talk) ---
async function loadLeagueMessages(leagueId, isBackground = false) {
  const container = document.getElementById('league-chat-messages');
  if (!container) return;

  try {
    const messages = await API.getLeagueMessages(leagueId);

    // En polling d'arrière-plan : vérifier si de nouveaux messages sont arrivés pour éviter de redessiner inutilement
    const prev = state.leagueMessages[leagueId] || [];
    if (isBackground && prev.length === messages.length && prev.length > 0 && prev[prev.length - 1].id === messages[messages.length - 1].id) {
      return;
    }

    state.leagueMessages[leagueId] = messages;

    if (messages.length === 0) {
      container.innerHTML = `
        <div class="text-center text-slate-500 text-[11px] py-6">
          Aucun message pour le moment.<br>Sois le premier à chambrer tes potes !
        </div>
      `;
      return;
    }

    const wasNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 70;

    container.innerHTML = messages.map(m => {
      const isMe = m.is_me;
      const timeStr = formatChatTime(m.created_at);

      return `
        <div class="flex items-end gap-1.5 ${isMe ? 'justify-end' : 'justify-start'}">
          ${!isMe ? `<div class="shrink-0 mb-0.5">${getUserAvatarHtml(m.username, 'xs', m.avatar_url)}</div>` : ''}
          <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%] space-y-0.5">
            <div class="flex items-center gap-1.5 text-[10px] text-slate-400 px-1">
              <span class="font-bold text-slate-300">${isMe ? 'Moi' : escapeHtml(m.username)}</span>
              ${timeStr ? `<span>•</span><span>${timeStr}</span>` : ''}
            </div>
            <div class="px-3.5 py-1.5 rounded-2xl text-xs leading-relaxed break-words ${isMe ? 'chat-bubble-me text-white' : 'chat-bubble-other text-slate-200'}">
              ${escapeHtml(m.content)}
            </div>
          </div>
          ${isMe ? `<div class="shrink-0 mb-0.5">${getUserAvatarHtml(m.username, 'xs', m.avatar_url)}</div>` : ''}
        </div>
      `;
    }).join('');

    // Défilement automatique en bas
    if (!isBackground || wasNearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  } catch (err) {
    if (!isBackground) {
      console.error("Erreur chargement messages:", err);
      container.innerHTML = `
        <div class="text-center text-rose-400 text-[11px] py-4 space-y-2">
          <div><svg class='lucide-inline lucide-md lucide-red' viewBox='0 0 24 24'><path d='m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'/><path d='M12 9v4'/><path d='M12 17h.01'/></svg> ${escapeHtml(err.message || 'Impossible de charger les messages')}</div>
          <button type="button" onclick="loadLeagueMessages(${leagueId})" class="px-2.5 py-1 rounded-lg bg-[#1c1f2e] text-zinc-300 hover:text-white border border-zinc-700 text-[10px] cursor-pointer">
            <svg class='lucide-inline lucide-sm lucide-white' viewBox='0 0 24 24'><path d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'/><path d='M21 3v5h-5'/><path d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'/><path d='M8 16H3v5'/></svg> Réessayer
          </button>
        </div>
      `;
    }
  }
}

async function handleSendLeagueMessage(e, leagueId) {
  if (e && e.preventDefault) e.preventDefault();
  const input = document.getElementById('league-chat-input');
  if (!input) return;

  const content = input.value.trim();
  if (!content) return;

  const submitBtn = document.getElementById('league-chat-submit-btn') || (e.target && e.target.querySelector ? e.target.querySelector('button[type="submit"]') : null);
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '...';
  }

  try {
    await API.sendLeagueMessage(leagueId, content);
    input.value = '';
    await loadLeagueMessages(leagueId, false);
    input.focus();
  } catch (err) {
    console.error("Erreur envoi message:", err);
    notify(err.message || "Erreur lors de l'envoi du message", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Envoyer';
    }
  }
}

function insertEmojiToChat(emoji) {
  const input = document.getElementById('league-chat-input');
  if (input) {
    input.value += emoji;
    input.focus();
  }
}

// --- Animation Confettis (Canvas Native, Ultra-Légère, 0 Dépendance) ---
function launchConfetti() {
  try {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '99999';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = [];
    const colors = ['#ffffff', '#e4e4e7', '#facc15', '#60a5fa', '#f87171', '#34d399', '#fb923c'];
    for (let i = 0; i < 65; i++) {
      pieces.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 80,
        y: canvas.height / 3 + (Math.random() - 0.5) * 40,
        vx: (Math.random() - 0.5) * 14,
        vy: Math.random() * -12 - 4,
        size: Math.random() * 6 + 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 12,
        opacity: 1
      });
    }

    let animationFrame;
    const startTime = Date.now();

    function update() {
      const elapsed = Date.now() - startTime;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.38;
        p.rotation += p.rotSpeed;
        if (elapsed > 1800) {
          p.opacity -= 0.035;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
        ctx.restore();
      }

      if (elapsed < 2800) {
        animationFrame = requestAnimationFrame(update);
      } else {
        cancelAnimationFrame(animationFrame);
        canvas.remove();
      }
    }
    animationFrame = requestAnimationFrame(update);
  } catch (e) {
    console.warn("Confetti non disponible:", e);
  }
}

// --- HOOPS WRAPPED (Hebdomadaire & Fin de Saison) ---
let currentWrappedPeriod = 'weekly';
let currentWrappedShareText = '';

async function loadWrappedData(period = 'weekly') {
  currentWrappedPeriod = period;
  const modal = document.getElementById('share-recap-modal');
  if (!modal) return;

  const btnWeekly = document.getElementById('wrapped-tab-weekly');
  const btnSeason = document.getElementById('wrapped-tab-season');
  if (btnWeekly && btnSeason) {
    if (period === 'weekly') {
      btnWeekly.className = "py-1.5 px-2 rounded-lg font-condensed font-black text-xs uppercase tracking-wider transition cursor-pointer bg-white text-black shadow";
      btnSeason.className = "py-1.5 px-2 rounded-lg font-condensed font-black text-xs uppercase tracking-wider transition cursor-pointer text-zinc-400 hover:text-white";
    } else {
      btnSeason.className = "py-1.5 px-2 rounded-lg font-condensed font-black text-xs uppercase tracking-wider transition cursor-pointer bg-white text-black shadow";
      btnWeekly.className = "py-1.5 px-2 rounded-lg font-condensed font-black text-xs uppercase tracking-wider transition cursor-pointer text-zinc-400 hover:text-white";
    }
  }

  try {
    const data = await API.getMyWrapped(period);
    if (!data) return;

    currentWrappedShareText = data.share_text;

    const weekBadge = document.getElementById('recap-week-badge');
    const avatarEl = document.getElementById('recap-avatar');
    const usernameEl = document.getElementById('recap-username');
    const rankBadgeEl = document.getElementById('recap-rank-badge');
    const titleEl = document.getElementById('recap-title');
    const pointsEl = document.getElementById('recap-points');
    const winrateEl = document.getElementById('recap-winrate');
    const accuracyEl = document.getElementById('recap-accuracy');
    const favTeamEl = document.getElementById('recap-favorite-team');
    const nemTeamEl = document.getElementById('recap-nemesis-team');
    const punchlineEl = document.getElementById('recap-punchline');

    if (weekBadge) weekBadge.textContent = data.period_title;
    if (avatarEl) avatarEl.innerHTML = getUserAvatarHtml(data.username, 'lg', data.avatar_url);
    if (usernameEl) usernameEl.textContent = data.username;
    if (rankBadgeEl) rankBadgeEl.textContent = data.rank ? `#${data.rank}` : '-';
    if (pointsEl) pointsEl.textContent = (period === 'weekly' ? data.points : data.total_points).toFixed(1);
    if (winrateEl) winrateEl.textContent = `${data.winrate}%`;
    if (accuracyEl) accuracyEl.textContent = data.max_odds_won > 0 ? data.max_odds_won.toFixed(2) : `${data.won_predictions}/${data.total_predictions}`;
    if (favTeamEl) favTeamEl.textContent = data.favorite_team || 'En cours...';
    if (nemTeamEl) nemTeamEl.textContent = data.nemesis_team || 'Aucun';

    if (titleEl) {
      if (data.winrate >= 70) titleEl.textContent = "Précision chirurgicale";
      else if (data.winrate >= 50) titleEl.textContent = "Clutch Player";
      else titleEl.textContent = "En pleine montée en puissance";
    }

    if (punchlineEl) {
      if (data.winrate >= 60) {
        punchlineEl.textContent = "« MVP sur le parquet ! Qui peut rivaliser ? Venez tester vos pronos ! »";
      } else {
        punchlineEl.textContent = "« La saison est encore longue, préparez-vous au comeback ! »";
      }
    }
  } catch (err) {
    console.error("Erreur chargement Wrapped:", err);
  }
}

async function openShareRecapModal(preferredLeagueId = null) {
  if (!state.currentUser) {
    openAuthModal('login');
    notify("Connecte-toi pour générer ton bilan !", "info");
    return;
  }

  const modal = document.getElementById('share-recap-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  await loadWrappedData('weekly');
  launchConfetti();
}

function switchWrappedPeriod(period) {
  loadWrappedData(period);
  launchConfetti();
}

function closeShareRecapModal() {
  const modal = document.getElementById('share-recap-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleNativeShareRecap() {
  const text = currentWrappedShareText || (state.currentUser ? `PICK 'N' SWIPE - Bilan de ${state.currentUser.username} : ${state.currentUser.total_points.toFixed(1)} pts !\nRejoins-moi sur ${window.location.origin}` : "");
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Mon Wrapped HOOPS Prono",
        text: text,
        url: window.location.origin
      });
    } catch {
      // Annulé par l'utilisateur
    }
  } else {
    try {
      await navigator.clipboard.writeText(text);
      notify("Bilan copié ! Colle-le dans WhatsApp ou ta Story", "success");
    } catch {
      notify("Impossible de copier le bilan.", "error");
    }
  }
}

async function handleCopyRecapText() {
  const text = currentWrappedShareText || (state.currentUser ? ` HOOPS PRONO - Bilan de ${state.currentUser.username} : ${state.currentUser.total_points.toFixed(1)} pts !\nRejoins-moi sur ${window.location.origin}` : "");
  try {
    await navigator.clipboard.writeText(text);
    notify("Texte récapitulatif copié dans le presse-papier !", "success");
  } catch {
    notify("Erreur lors de la copie.", "error");
  }
}

// Export pour handlers HTML inline
window.openSeasonModal = openSeasonModal;
window.closeSeasonModal = closeSeasonModal;
window.openCreateLeagueModal = openCreateLeagueModal;
window.closeCreateLeagueModal = closeCreateLeagueModal;
window.openJoinLeagueModal = openJoinLeagueModal;
window.closeJoinLeagueModal = closeJoinLeagueModal;
window.copyLeagueCode = copyLeagueCode;
window.shareLeague = shareLeague;
window.viewLeague = viewLeague;
window.backToLeaguesList = backToLeaguesList;
window.leaveLeagueAction = leaveLeagueAction;
window.openLeagueMatchVotesModal = openLeagueMatchVotesModal;
window.closeLeagueMatchVotesModal = closeLeagueMatchVotesModal;
window.loadLeagueMessages = loadLeagueMessages;
window.handleSendLeagueMessage = handleSendLeagueMessage;
window.insertEmojiToChat = insertEmojiToChat;
window.openShareRecapModal = openShareRecapModal;
window.closeShareRecapModal = closeShareRecapModal;
window.switchWrappedPeriod = switchWrappedPeriod;
window.launchConfetti = launchConfetti;

// --- Modale Mentions Légales & Fair Use ---
function openLegalModal() {
  const modal = document.getElementById('legal-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeLegalModal() {
  const modal = document.getElementById('legal-modal');
  if (modal) modal.classList.add('hidden');
}

window.openLegalModal = openLegalModal;
window.closeLegalModal = closeLegalModal;

// --- Modale Galerie d'Avatars Superstars NBA ---
async function openAvatarSelectorModal() {
  const modal = document.getElementById('avatar-selector-modal');
  const grid = document.getElementById('avatars-grid');
  if (!modal || !grid) return;

  modal.classList.remove('hidden');

  grid.innerHTML = `
    <div class="py-12 text-center text-zinc-400 font-condensed text-sm flex flex-col items-center justify-center gap-2.5">
      <img src="/static/icons/logo-secondaire.png" alt="Pick 'n' Swipe" class="arcade-ball-loader-lg" />
      <span class="uppercase tracking-wider">Chargement des superstars NBA...</span>
    </div>
  `;

  try {
    const avatars = await fetchAvatarsList();
    if (!avatars || avatars.length === 0) {
      grid.innerHTML = `<div class="p-6 text-center text-zinc-400 text-xs font-condensed uppercase">Aucun avatar disponible pour le moment.</div>`;
      return;
    }

    const currentUrl = state.currentUser ? state.currentUser.avatar_url : null;

    grid.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 10px;">
        ${avatars.map(av => {
          const isSelected = currentUrl === av.url;
          return `
            <div 
              onclick="handleSelectAvatar('${av.url}')" 
              class="flex flex-col items-center justify-between p-2 rounded-[8px] border-[2px] cursor-pointer transition select-none text-center ${
                isSelected 
                  ? 'border-[#D95D39] bg-[#D95D39]/20 shadow-[3px_3px_0px_#D95D39]' 
                  : 'border-black bg-[#141418] hover:bg-[#202028] shadow-[3px_3px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none'
              }"
              title="${escapeHtml(av.title)} - ${escapeHtml(av.meme || '')}"
            >
              <div class="relative w-14 h-14 mx-auto mb-1">
                <img 
                  src="${av.url}" 
                  alt="${escapeHtml(av.title)}" 
                  loading="lazy"
                  class="w-14 h-14 rounded-full object-cover border-[2px] border-black shadow-[2px_2px_0px_#000000] bg-[#18181b]" 
                />
                ${isSelected ? `
                  <div class="absolute -top-1 -right-1 w-4 h-4 bg-[#D95D39] text-white rounded-full border border-black flex items-center justify-center text-[9px] font-black">
                    <svg class='lucide-inline lucide-xs lucide-green' viewBox='0 0 24 24'><path d='M20 6 9 17l-5-5'/></svg>
                  </div>
                ` : ''}
              </div>
              <span class="text-[10px] font-condensed font-black uppercase text-[#F4F4F0] leading-tight truncate w-full text-center">
                ${escapeHtml(av.title.split(' ').pop())}
              </span>
              <span class="text-[8px] text-zinc-400 truncate w-full text-center leading-none mt-0.5">
                ${isSelected ? '<strong class="text-[#D95D39]">ACTIF</strong>' : escapeHtml(av.meme || '')}
              </span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    console.error("Erreur openAvatarSelectorModal:", err);
    grid.innerHTML = `
      <div class="p-6 text-center text-rose-400 text-xs bg-[#18181e] border-2 border-black rounded-[8px] space-y-2">
        <p>Erreur lors du chargement des avatars.</p>
        <button onclick="openAvatarSelectorModal()" class="px-3 py-1 bg-[#D95D39] text-white text-xs font-condensed font-bold uppercase rounded-[6px] border border-black">
          Réessayer
        </button>
      </div>
    `;
  }
}

function closeAvatarSelectorModal() {
  const modal = document.getElementById('avatar-selector-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleSelectAvatar(avatarUrl) {
  try {
    const updated = await API.setMyAvatar(avatarUrl);
    if (state.currentUser) {
      state.currentUser.avatar_url = updated.avatar_url;
    }
    notify("Avatar Superstar NBA sélectionné !", "success");
    if (typeof launchConfetti === 'function') {
      launchConfetti();
    }
    closeAvatarSelectorModal();
    if (typeof renderProfile === 'function') {
      renderProfile();
    }
  } catch (err) {
    notify(err.message || "Erreur lors du choix de l'avatar", "error");
  }
}

window.openAvatarSelectorModal = openAvatarSelectorModal;
window.closeAvatarSelectorModal = closeAvatarSelectorModal;
window.handleSelectAvatar = handleSelectAvatar;

// --- Modale Récapitulatif Arcade de la Nuit (Bilan complet des choix) ---
function openNightRecapModal() {
  const modal = document.getElementById('night-recap-modal');
  const statsBar = document.getElementById('night-recap-stats-bar');
  const matchesList = document.getElementById('night-recap-matches-list');
  if (!modal) return;

  const matches = state.matches || [];
  const totalMatches = matches.length;
  const myPredictions = state.myPredictions || {};
  const boostedPredictions = state.boostedPredictions || {};

  let predictedCount = 0;
  let potentialPoints = 0;
  let boostedMatch = null;

  matches.forEach(m => {
    const chosenId = myPredictions[m.id];
    const isBoosted = !!boostedPredictions[m.id];
    if (isBoosted) {
      boostedMatch = m;
    }
    if (chosenId) {
      predictedCount++;
      const isHome = chosenId === m.home_team.id;
      const odds = isHome ? (m.home_odds || 1.0) : (m.away_odds || 1.0);
      potentialPoints += odds * (isBoosted ? 2 : 1);
    }
  });

  if (statsBar) {
    statsBar.innerHTML = `
      <div class="p-2 rounded-[8px] bg-[#100F15] border-2 border-black shadow-[2px_2px_0px_#000000]">
        <div class="text-[9px] font-condensed font-black text-zinc-400 uppercase tracking-wider">Pronos</div>
        <div class="text-lg font-black text-[#FFD600] font-mono leading-tight">${predictedCount} / ${totalMatches}</div>
      </div>
      <div class="p-2 rounded-[8px] bg-[#100F15] border-2 border-black shadow-[2px_2px_0px_#000000]">
        <div class="text-[9px] font-condensed font-black text-zinc-400 uppercase tracking-wider">Bonus x2</div>
        <div class="text-[11px] font-black uppercase leading-tight pt-1 ${boostedMatch ? 'text-[#FF5722]' : 'text-zinc-500'}">
          ${boostedMatch ? `<svg class="lucide-inline lucide-sm lucide-orange-fill" viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg> LOCKÉ` : "NON UTILISÉ"}
        </div>
      </div>
      <div class="p-2 rounded-[8px] bg-[#100F15] border-2 border-black shadow-[2px_2px_0px_#000000]">
        <div class="text-[9px] font-condensed font-black text-zinc-400 uppercase tracking-wider">Gain Max</div>
        <div class="text-lg font-black text-[#00E676] font-mono leading-tight">${potentialPoints.toFixed(1)} <span class="text-[10px] text-zinc-400">pts</span></div>
      </div>
    `;
  }

  if (matchesList) {
    if (matches.length === 0) {
      matchesList.innerHTML = `<div class="p-4 text-center text-xs text-zinc-400">Aucun match disponible pour le moment.</div>`;
    } else {
      matchesList.innerHTML = matches.map(match => {
        const chosenId = myPredictions[match.id];
        const isBoosted = !!boostedPredictions[match.id];
        const chosenTeam = chosenId ? (chosenId === match.home_team.id ? match.home_team : match.away_team) : null;
        const chosenOdds = chosenId ? (chosenId === match.home_team.id ? match.home_odds : match.away_odds) : null;
        const multiplier = isBoosted ? 2 : 1;
        const finalOdds = chosenOdds ? (chosenOdds * multiplier).toFixed(2) : null;

        return `
          <div class="pt-2 pb-1 text-left">
            <div class="flex items-center justify-between text-[11px] mb-1">
              <span class="font-condensed font-black uppercase text-zinc-300">
                ${escapeHtml(match.away_team.code)} <span class="text-zinc-500 font-normal">@</span> ${escapeHtml(match.home_team.code)}
              </span>
              <div class="flex items-center gap-1.5">
                ${isBoosted ? `
                  <span class="text-[9px] font-condensed font-black px-1.5 py-0.5 rounded-[4px] bg-[#FF5722] text-white border border-black shadow-[1px_1px_0px_#000000] flex items-center gap-0.5">
                    <span></span> x2
                  </span>
                ` : ''}
                <span class="text-[10px] text-zinc-400 font-mono">${formatMatchTime(new Date(match.deadline))}</span>
              </div>
            </div>

            ${chosenTeam ? `
              <div class="flex items-center justify-between p-2 rounded-[8px] border-2 border-black ${isBoosted ? 'bg-[#FF5722]/15 shadow-[2px_2px_0px_#FF5722]' : 'bg-[#121118] shadow-[2px_2px_0px_#000000]'}">
                <div class="flex items-center gap-2">
                  <div class="w-6 h-6 rounded-[5px] flex items-center justify-center font-condensed font-black text-xs border border-black shrink-0"
                       style="background-color: ${chosenTeam.color || '#D95D39'}; color: ${chosenTeam.text_color || '#FFFFFF'};">
                    ${escapeHtml(chosenTeam.code)}
                  </div>
                  <div>
                    <div class="font-condensed font-black text-xs text-white leading-tight">
                      ${escapeHtml(chosenTeam.city)} ${escapeHtml(chosenTeam.name)}
                    </div>
                    <div class="text-[9px] text-[#00E676] font-bold"><svg class='lucide-inline lucide-xs lucide-green' viewBox='0 0 24 24'><path d='M20 6 9 17l-5-5'/></svg> Pronostic validé</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-[9px] text-zinc-400 font-condensed font-bold uppercase">Cote ${isBoosted ? 'x2' : ''}</div>
                  <div class="font-condensed font-black text-sm ${isBoosted ? 'text-[#FF9800]' : 'text-[#F4F4F0]'}">
                    ${finalOdds}
                  </div>
                </div>
              </div>
            ` : `
              <div class="flex items-center justify-between p-2 rounded-[8px] bg-black/40 border border-dashed border-zinc-700">
                <span class="text-[11px] text-zinc-400 italic">Pas de pronostic</span>
                <span class="text-[10px] font-condensed font-bold text-amber-400 uppercase">En attente</span>
              </div>
            `}
          </div>
        `;
      }).join('');
    }
  }

  modal.classList.remove('hidden');
  if (typeof launchConfetti === 'function') {
    launchConfetti();
  }
}

function closeNightRecapModal() {
  const modal = document.getElementById('night-recap-modal');
  if (modal) modal.classList.add('hidden');
}

window.openNightRecapModal = openNightRecapModal;
window.closeNightRecapModal = closeNightRecapModal;

// ==========================================================================
// SCORES & RÉSULTATS DES MATCHS PASSÉS (BANDEAUX TV US x NEO-BRUTALISME)
// ==========================================================================

state.resultsWeekFilter = 'all';
state.finishedMatchesCache = null;

function getTeamSaturatedGradient(hexColor, isHome = false) {
  if (!hexColor || hexColor.toLowerCase() === '#111111') {
    return isHome 
      ? 'linear-gradient(225deg, #2E2D38 0%, #15141C 100%)' 
      : 'linear-gradient(135deg, #2E2D38 0%, #15141C 100%)';
  }
  let hex = hexColor.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  let r = parseInt(hex.substring(0, 2), 16) || 0;
  let g = parseInt(hex.substring(2, 4), 16) || 0;
  let b = parseInt(hex.substring(4, 6), 16) || 0;

  // Boost saturation and vibrancy
  const max = Math.max(r, g, b, 1);
  const factor = Math.min(1.4, 235 / max);
  const rVibrant = Math.min(255, Math.round(r * factor + 15));
  const gVibrant = Math.min(255, Math.round(g * factor + 15));
  const bVibrant = Math.min(255, Math.round(b * factor + 15));

  const rDeep = Math.max(0, Math.round(r * 0.65));
  const gDeep = Math.max(0, Math.round(g * 0.65));
  const bDeep = Math.max(0, Math.round(b * 0.65));

  const angle = isHome ? 225 : 135;
  return `linear-gradient(${angle}deg, rgb(${rVibrant}, ${gVibrant}, ${bVibrant}) 0%, rgb(${rDeep}, ${gDeep}, ${bDeep}) 100%)`;
}

async function renderResultsView() {
  const container = document.getElementById('results-scoreboard-list');
  const countBadge = document.getElementById('results-count-badge');
  const weeksContainer = document.getElementById('results-weeks-selector');
  if (!container) return;

  container.innerHTML = `
    <div class="py-10 text-center text-zinc-400 font-condensed text-sm flex items-center justify-center gap-2.5">
      <img src="/static/icons/logo-secondaire.png" alt="Pick 'n' Swipe" class="arcade-ball-loader" />
      <span>Chargement des scores TV US...</span>
    </div>
  `;

  try {
    const finishedMatches = await API.getMatches('finished');
    state.finishedMatchesCache = finishedMatches;

    // Récupération des semaines disponibles
    const weeksSet = new Set(finishedMatches.map(m => m.week_number || 1));
    const availableWeeks = Array.from(weeksSet).sort((a, b) => a - b);

    // Rendu du sélecteur de semaines
    if (weeksContainer) {
      const isAll = state.resultsWeekFilter === 'all';
      let weeksHtml = `
        <button 
          onclick="setResultsWeekFilter('all')" 
          class="px-2.5 py-1 rounded-[6px] font-condensed font-black text-xs uppercase tracking-wider border-2 border-black transition cursor-pointer shrink-0 ${
            isAll 
              ? 'bg-[#D95D39] text-white shadow-[2px_2px_0px_#000000]' 
              : 'bg-[#18181e] text-zinc-400 hover:text-white shadow-none'
          }"
        >
          Toutes
        </button>
      `;
      availableWeeks.forEach(wk => {
        const isSelected = String(state.resultsWeekFilter) === String(wk);
        weeksHtml += `
          <button 
            onclick="setResultsWeekFilter(${wk})" 
            class="px-2.5 py-1 rounded-[6px] font-condensed font-black text-xs uppercase tracking-wider border-2 border-black transition cursor-pointer shrink-0 ${
              isSelected 
                ? 'bg-[#D95D39] text-white shadow-[2px_2px_0px_#000000]' 
                : 'bg-[#18181e] text-zinc-400 hover:text-white shadow-none'
            }"
          >
            Semaine ${wk}
          </button>
        `;
      });
      weeksContainer.innerHTML = weeksHtml;
    }

    // Filtrer selon la semaine
    const displayed = (state.resultsWeekFilter === 'all')
      ? finishedMatches
      : finishedMatches.filter(m => String(m.week_number) === String(state.resultsWeekFilter));

    if (countBadge) {
      countBadge.innerHTML = `
        <span class="text-[10px] font-condensed font-black uppercase px-2.5 py-1 rounded-[6px] bg-[#181722] text-[#00E676] border-2 border-black shadow-[2px_2px_0px_#000000]">
          ${displayed.length} Matchs
        </span>
      `;
    }

    if (displayed.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center bg-[#18181e] border-[3px] border-black rounded-[10px] shadow-[4px_4px_0px_#000000] space-y-2">
          <div class="font-condensed font-black text-lg text-white uppercase tracking-wider">Aucun match terminé</div>
          <p class="text-xs text-zinc-400">Les résultats s'afficheront ici en direct dès la clôture des rencontres.</p>
        </div>
      `;
      return;
    }

    // Rendu des barres horizontales de résultats
    container.innerHTML = displayed.map(match => {
      const awayWon = (match.away_score || 0) > (match.home_score || 0);
      const homeWon = (match.home_score || 0) > (match.away_score || 0);
      const awayGrad = getTeamSaturatedGradient(match.away_team.color, false);
      const homeGrad = getTeamSaturatedGradient(match.home_team.color, true);

      // Pronostic du joueur sur ce match
      const userPickId = state.myPredictions ? state.myPredictions[match.id] : null;
      const isBoosted = state.boostedPredictions ? !!state.boostedPredictions[match.id] : false;
      let pronoBadgeHtml = '';

      if (userPickId) {
        const isPickWon = userPickId === match.winner_team_id;
        const multiplier = isBoosted ? ' x2' : '';
        if (isPickWon) {
          pronoBadgeHtml = `
            <div class="tv-prono-indicator tv-prono-won" title="Pronostic réussi !">
              <svg class='lucide-inline lucide-sm lucide-green' viewBox='0 0 24 24'><path d='M20 6 9 17l-5-5'/></svg> PRONO GAGNÉ${multiplier}
            </div>
          `;
        } else {
          pronoBadgeHtml = `
            <div class="tv-prono-indicator tv-prono-lost" title="Pronostic manqué">
              <svg class='lucide-inline lucide-sm lucide-red' viewBox='0 0 24 24'><path d='M18 6 6 18'/><path d='m6 6 12 12'/></svg> MANQUÉ
            </div>
          `;
        }
      }

      return `
        <div 
          class="tv-scoreboard-bar" 
          onclick="handleScoreboardClick(${match.id}, this)"
          data-match-id="${match.id}"
          title="Clique pour voir le résumé complet du match"
        >
          ${pronoBadgeHtml}

          <!-- Bloc de gauche : Équipe extérieure (Couleur + Acronyme + Score) -->
          <div class="tv-team-block away-block ${awayWon ? 'is-winner' : (homeWon ? 'is-loser' : '')}" style="background: ${awayGrad};">
            <span class="tv-team-code">${escapeHtml(match.away_team.code)}</span>
            <span class="tv-team-score">${match.away_score !== null && match.away_score !== undefined ? match.away_score : '--'}</span>
          </div>

          <!-- Bloc central : Logo de l'application (ballon logo-secondaire) sur fond sombre à la place de l'horloge -->
          <div class="tv-center-bug">
            <div class="tv-logo-badge">
              <img src="/static/icons/logo-secondaire.png" alt="Pick 'n' Swipe" class="tv-center-logo-ball select-none" />
              <span class="tv-logo-nba sr-only hidden" style="display:none;">NBA</span>
              <span class="tv-logo-pro sr-only hidden" style="display:none;">PRO</span>
            </div>
            <div class="tv-status-final">
              <span class="status-dot"></span>
              <span>FINAL</span>
            </div>
          </div>

          <!-- Bloc de droite : Équipe à domicile (Score + Acronyme + Couleur) -->
          <div class="tv-team-block home-block ${homeWon ? 'is-winner' : (awayWon ? 'is-loser' : '')}" style="background: ${homeGrad};">
            <span class="tv-team-score">${match.home_score !== null && match.home_score !== undefined ? match.home_score : '--'}</span>
            <span class="tv-team-code">${escapeHtml(match.home_team.code)}</span>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error("Erreur chargement résultats:", err);
    container.innerHTML = `
      <div class="p-6 text-center text-rose-400 text-xs bg-[#18181e] border-2 border-red-500 rounded-[10px]">
        Erreur lors du chargement des résultats des matchs.
      </div>
    `;
  }
}

function setResultsWeekFilter(week) {
  state.resultsWeekFilter = week;
  renderResultsView();
}

function handleScoreboardClick(matchId, element) {
  if (element) {
    element.classList.add('is-pressed');
    setTimeout(() => element.classList.remove('is-pressed'), 120);
  }
  if (navigator.vibrate) {
    try { navigator.vibrate(25); } catch {}
  }
  openMatchResultDetails(matchId);
}

function openMatchResultDetails(matchId) {
  const modal = document.getElementById('match-result-modal');
  const content = document.getElementById('match-result-modal-content');
  if (!modal || !content) return;

  const matchesPool = (state.finishedMatchesCache || []).concat(state.matches || []);
  const match = matchesPool.find(m => m.id === matchId);
  if (!match) return;

  const awayWon = (match.away_score || 0) > (match.home_score || 0);
  const homeWon = (match.home_score || 0) > (match.away_score || 0);
  const diff = Math.abs((match.home_score || 0) - (match.away_score || 0));

  const awayColor = match.away_team.color || '#CE1141';
  const homeColor = match.home_team.color || '#007AC1';
  const awayGrad = getTeamSaturatedGradient(awayColor, false);
  const homeGrad = getTeamSaturatedGradient(homeColor, true);

  const userPickId = state.myPredictions ? state.myPredictions[match.id] : null;
  const isBoosted = state.boostedPredictions ? !!state.boostedPredictions[match.id] : false;
  let userPronoCard = '';

  if (userPickId) {
    const isPickHome = userPickId === match.home_team.id;
    const pickedTeam = isPickHome ? match.home_team : match.away_team;
    const pickedOdds = isPickHome ? match.home_odds : match.away_odds;
    const isWon = userPickId === match.winner_team_id;
    const multiplier = isBoosted ? 2 : 1;
    const pointsWon = isWon ? (pickedOdds * multiplier) : 0.0;

    userPronoCard = `
      <div class="p-3 rounded-[10px] border-2 border-black ${isWon ? 'bg-[#00E676]/10 border-[#00E676]' : 'bg-red-500/10 border-red-500'} shadow-[3px_3px_0px_#000000] space-y-1.5">
        <div class="flex items-center justify-between text-[11px] font-condensed font-black uppercase">
          <span class="text-zinc-300">Ton Pronostic</span>
          <span class="${isWon ? 'text-[#00E676]' : 'text-red-400'}">
            ${isWon ? `<svg class="lucide-inline lucide-sm lucide-green" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg> GAGNÉ` : `<svg class="lucide-inline lucide-sm lucide-red" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> MANQUÉ`} ${isBoosted ? `<svg class="lucide-inline lucide-sm lucide-amber-fill" viewBox="0 0 24 24"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg> x2 ACTIF` : ""}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-[6px] flex items-center justify-center font-condensed font-black text-xs border border-black shadow-[1px_1px_0px_#000000]"
                 style="background-color: ${pickedTeam.color}; color: ${pickedTeam.text_color || '#FFF'};">
              ${escapeHtml(pickedTeam.code)}
            </div>
            <div>
              <div class="font-condensed font-black text-sm text-white leading-tight">
                ${escapeHtml(pickedTeam.city)} ${escapeHtml(pickedTeam.name || '')}
              </div>
              <div class="text-[10px] text-zinc-400 font-mono">Cote : ${pickedOdds.toFixed(2)} ${isBoosted ? 'x 2' : ''}</div>
            </div>
          </div>
          <div class="text-right">
            <div class="text-[9px] font-condensed font-bold uppercase text-zinc-400">Points</div>
            <div class="font-condensed font-black text-lg ${isWon ? 'text-[#00E676]' : 'text-zinc-500'} font-mono">
              +${pointsWon.toFixed(2)} pts
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    userPronoCard = `
      <div class="p-3 rounded-[10px] bg-black/40 border-2 border-dashed border-zinc-700 text-center space-y-1">
        <div class="text-[11px] font-condensed font-bold text-zinc-400 uppercase">Non pronostiqué</div>
        <p class="text-[10px] text-zinc-500">Tu n'avais pas validé de pronostic avant le coup d'envoi de cette rencontre.</p>
      </div>
    `;
  }

  content.innerHTML = `
    <!-- Scoreboard Grand Format TV US -->
    <div class="border-[3px] border-black rounded-[12px] overflow-hidden shadow-[5px_5px_0px_#000000]">
      <div class="flex items-stretch h-24">
        <!-- Équipe Extérieure -->
        <div class="flex-1 p-3 flex flex-col justify-between relative ${awayWon ? 'is-winner' : 'is-loser'}" style="background: ${awayGrad};">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-black/60 text-white border border-black">EXT</span>
            ${awayWon ? '<span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-[#FFEB3B] text-black border border-black shadow-[1px_1px_0px_#000]">WINNER</span>' : ''}
          </div>
          <div class="font-condensed font-black text-3xl text-white leading-none tracking-wide text-shadow">
            ${escapeHtml(match.away_team.code)}
          </div>
          <div class="font-mono font-black text-4xl text-white leading-none ${awayWon ? 'text-[#FFEB3B]' : ''}">
            ${match.away_score ?? '--'}
          </div>
        </div>

        <!-- Centre TV Bug -->
        <div class="w-16 bg-[#0B0A10] border-l-[3px] border-r-[3px] border-black flex flex-col items-center justify-center p-1 text-center shrink-0">
          <div class="tv-logo-badge mb-1">
            <span class="tv-logo-nba">NBA</span>
            <span class="tv-logo-pro">PRO</span>
          </div>
          <span class="text-[9px] font-condensed font-black text-zinc-400 uppercase">FINAL</span>
          <span class="text-[8px] text-zinc-500 font-mono mt-0.5">W${match.week_number || 1}</span>
        </div>

        <!-- Équipe Domicile -->
        <div class="flex-1 p-3 flex flex-col justify-between text-right relative ${homeWon ? 'is-winner' : 'is-loser'}" style="background: ${homeGrad};">
          <div class="flex items-center justify-between">
            ${homeWon ? '<span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-[#FFEB3B] text-black border border-black shadow-[1px_1px_0px_#000]">WINNER</span>' : '<span></span>'}
            <span class="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-black/60 text-white border border-black">DOM</span>
          </div>
          <div class="font-condensed font-black text-3xl text-white leading-none tracking-wide text-shadow">
            ${escapeHtml(match.home_team.code)}
          </div>
          <div class="font-mono font-black text-4xl text-white leading-none ${homeWon ? 'text-[#FFEB3B]' : ''}">
            ${match.home_score ?? '--'}
          </div>
        </div>
      </div>
    </div>

    <!-- Franchises & Écart -->
    <div class="flex items-center justify-between px-3 py-2 rounded-[8px] bg-[#100F15] border-2 border-black shadow-[2px_2px_0px_#000000] text-xs font-condensed font-black uppercase">
      <span class="text-zinc-300 truncate max-w-[40%]">${escapeHtml(match.away_team.city)}</span>
      <span class="text-[#FF9800] bg-black/60 px-2 py-0.5 rounded border border-black">Écart : +${diff} pts</span>
      <span class="text-zinc-300 truncate max-w-[40%] text-right">${escapeHtml(match.home_team.city)}</span>
    </div>

    <!-- Cotes Officielles d'Avant-Match -->
    <div class="grid grid-cols-2 gap-2 text-center">
      <div class="p-2 rounded-[8px] bg-[#18181e] border-2 border-black shadow-[2px_2px_0px_#000000]">
        <div class="text-[9px] font-condensed font-black uppercase text-zinc-400">Cote ${escapeHtml(match.away_team.code)}</div>
        <div class="font-condensed font-black text-lg text-white font-mono">${(match.away_odds || 1.90).toFixed(2)}</div>
      </div>
      <div class="p-2 rounded-[8px] bg-[#18181e] border-2 border-black shadow-[2px_2px_0px_#000000]">
        <div class="text-[9px] font-condensed font-black uppercase text-zinc-400">Cote ${escapeHtml(match.home_team.code)}</div>
        <div class="font-condensed font-black text-lg text-white font-mono">${(match.home_odds || 1.90).toFixed(2)}</div>
      </div>
    </div>

    <!-- Carte Pronostic Utilisateur -->
    ${userPronoCard}
  `;

  modal.classList.remove('hidden');
}

function closeMatchResultDetails() {
  const modal = document.getElementById('match-result-modal');
  if (modal) modal.classList.add('hidden');
}

window.renderResultsView = renderResultsView;
window.setResultsWeekFilter = setResultsWeekFilter;
window.handleScoreboardClick = handleScoreboardClick;
window.openMatchResultDetails = openMatchResultDetails;
window.closeMatchResultDetails = closeMatchResultDetails;
window.getTeamSaturatedGradient = getTeamSaturatedGradient;





window.handleLeaderboardFilterChange = async function() {
  const selectEl = document.getElementById('leaderboard-league-select');
  if (!selectEl) return;
  const val = selectEl.value;
  
  if (val === 'general') {
    state.displayedLeaderboard = state.leaderboard;
  } else {
    try {
      const detail = await API.getLeagueDetail(val);
      state.displayedLeaderboard = detail.members || [];
    } catch (e) {
      notify("Erreur lors du chargement du classement de la ligue", "error");
      return;
    }
  }
  renderLeaderboard();
};
