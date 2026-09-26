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
  weeklyPlayerCandidates: null,
  weeklyPlayersMap: {}, // weekNumber -> WeeklyPlayerPredictionResponse
  myLeagues: [],
  activeLeague: null,
  activeLeagueVotesMatchId: null,
  activeLeagueVotesLeagueId: null,
  leagueMessages: {},
  chatPollingInterval: null,
  authMode: 'login'
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

document.addEventListener('DOMContentLoaded', async () => {
  registerServiceWorker();
  initUIEvents();
  await checkSession();
  loadSeasonCandidates();
  loadWeeklyPlayerCandidates();
  await refreshData();

  // Détection automatique d'un code de ligue d'invitation dans l'URL (?join=XXXXXX)
  const urlParams = new URLSearchParams(window.location.search);
  const joinCode = urlParams.get('join');
  if (joinCode && joinCode.trim().length === 6) {
    selectTab('leagues');
    openJoinLeagueModal(joinCode.trim().toUpperCase());
  }
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

  // Filtres de statut de match
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => {
        c.classList.remove('active', 'bg-white', 'text-black');
        c.classList.add('bg-[#141418]', 'text-zinc-400');
      });
      chip.classList.add('active', 'bg-white', 'text-black');
      chip.classList.remove('bg-[#141418]', 'text-zinc-400');
      state.matchesFilter = chip.getAttribute('data-filter');
      renderMatchesList();
    });
  });

  // Gestion modale d'authentification
  const closeBtn = document.getElementById('close-auth-modal');
  const switchBtn = document.getElementById('auth-switch-btn');
  const authForm = document.getElementById('auth-form');

  if (closeBtn) closeBtn.addEventListener('click', closeAuthModal);
  if (switchBtn) {
    switchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      setAuthMode(state.authMode === 'login' ? 'register' : 'login');
    });
  }
  if (authForm) authForm.addEventListener('submit', handleAuthSubmit);

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

  // Fermer les suggestions de recherche de joueur au clic à l'extérieur
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#weekly-players-container')) {
      document.querySelectorAll('[id^="weekly-"][id*="-suggestions-"]').forEach(el => {
        el.classList.add('hidden');
      });
    }
  });
}

// --- Session & Utilisateur ---
async function checkSession() {
  try {
    const user = await API.getMe();
    state.currentUser = user;
  } catch {
    state.currentUser = null;
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
  } else {
    scoreBadge.classList.add('hidden');
    container.innerHTML = `
      <button onclick="openAuthModal('login')" class="btn-tactile bg-white hover:bg-zinc-200 text-black font-condensed font-black text-xs uppercase px-2.5 sm:px-3.5 py-1.5 rounded-lg transition cursor-pointer shadow-md shrink-0">
        Connexion
      </button>
    `;
  }
}

function handleLogout() {
  if (confirm(`Se déconnecter du compte ${state.currentUser.username} ?`)) {
    API.logout();
    state.currentUser = null;
    state.myPredictions = {};
    state.boostedPredictions = {};
    state.seasonPrediction = null;
    updateHeaderUser();
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
    btn.classList.toggle('text-white', isCurrent);
    btn.classList.toggle('text-zinc-500', !isCurrent);
  });

  const matchesView = document.getElementById('matches-view');
  const leaguesView = document.getElementById('leagues-view');
  const leaderboardView = document.getElementById('leaderboard-view');
  const profileView = document.getElementById('profile-view');

  if (matchesView) matchesView.classList.toggle('hidden', tab !== 'matches');
  if (leaguesView) leaguesView.classList.toggle('hidden', tab !== 'leagues');
  if (leaderboardView) leaderboardView.classList.toggle('hidden', tab !== 'leaderboard');
  if (profileView) profileView.classList.toggle('hidden', tab !== 'profile');

  if (tab !== 'leagues' && state.chatPollingInterval) {
    clearInterval(state.chatPollingInterval);
    state.chatPollingInterval = null;
  }

  if (tab === 'leaderboard') {
    renderLeaderboard();
  } else if (tab === 'profile') {
    renderProfile();
  } else if (tab === 'leagues') {
    loadAndRenderLeagues();
  }
}

// --- Modale Auth ---
function openAuthModal(mode = 'login') {
  setAuthMode(mode);
  document.getElementById('auth-modal').classList.remove('hidden');
  document.getElementById('auth-username-input').focus();
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('auth-error-box').classList.add('hidden');
  document.getElementById('auth-form').reset();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const submitBtn = document.getElementById('auth-submit-btn');
  const switchText = document.getElementById('auth-switch-text');
  const switchBtn = document.getElementById('auth-switch-btn');
  const usernameLabel = document.getElementById('auth-username-label');
  const usernameInput = document.getElementById('auth-username-input');
  const emailContainer = document.getElementById('auth-email-container');
  const emailInput = document.getElementById('auth-email-input');

  if (mode === 'login') {
    title.textContent = 'Connexion';
    subtitle.textContent = 'Accède à ta ligue et enregistre tes pronostics.';
    submitBtn.textContent = 'Se connecter';
    switchText.textContent = "Pas encore de compte ?";
    switchBtn.textContent = "Créer un compte";
    if (usernameLabel) usernameLabel.textContent = "Pseudo ou Email";
    if (usernameInput) usernameInput.placeholder = "Pseudo ou adresse email";
    if (emailContainer) emailContainer.classList.add('hidden');
    if (emailInput) emailInput.removeAttribute('required');
  } else {
    title.textContent = 'Création de compte';
    subtitle.textContent = 'Rejoins la ligue et défie tes amis.';
    submitBtn.textContent = 'Créer mon compte';
    switchText.textContent = "Déjà inscrit ?";
    switchBtn.textContent = "Se connecter";
    if (usernameLabel) usernameLabel.textContent = "Pseudo de joueur";
    if (usernameInput) usernameInput.placeholder = "Ex: Anteto34";
    if (emailContainer) emailContainer.classList.remove('hidden');
    if (emailInput) emailInput.setAttribute('required', 'true');
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('auth-username-input').value.trim();
  const password = document.getElementById('auth-password-input').value;
  const errBox = document.getElementById('auth-error-box');

  errBox.classList.add('hidden');

  try {
    let res;
    if (state.authMode === 'login') {
      res = await API.login(username, password);
    } else {
      const email = document.getElementById('auth-email-input').value.trim();
      res = await API.register(username, email, password);
    }

    state.currentUser = res.user;
    updateHeaderUser();
    closeAuthModal();
    notify(`Connecté en tant que ${res.user.username}`, 'success');
    await refreshData();
    if (state.activeTab === 'profile') renderProfile();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  }
}

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

    // Chargement des Joueurs de la Semaine (Chantier 4)
    if (state.currentUser && weeks.length > 0) {
      try {
        const wpList = await Promise.all(weeks.map(w => API.getWeeklyPlayerPrediction(w.week)));
        wpList.forEach(wp => {
          if (wp) {
            state.weeklyPlayersMap[wp.week_number] = wp;
          }
        });
      } catch (e) {
        console.error("Erreur chargement joueurs de la semaine:", e);
      }
    }

    renderSeasonBanner();
    renderWeeksSelector();
    renderWeeklyPlayersCard();
    renderMatchesList();
    renderLeaderboard();
  } catch (err) {
    console.error('Erreur chargement:', err);
    notify("Erreur lors de la synchronisation des données", "error");
  }
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
  renderWeeksSelector();
  renderWeeklyPlayersCard();
  try {
    const matches = await API.getMatches(state.matchesFilter, state.selectedWeek);
    state.matches = matches;
    renderMatchesList();
  } catch (err) {
    notify(err.message, "error");
  }
}

// --- Rendu des Matchs ---
function renderMatchesList() {
  const container = document.getElementById('matches-list');
  if (!container) return;

  let filtered = state.matches;
  if (state.matchesFilter === 'upcoming') {
    filtered = filtered.filter(m => m.status === 'upcoming');
  } else if (state.matchesFilter === 'finished') {
    filtered = filtered.filter(m => m.status === 'finished');
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center bg-[#121216] rounded-xl border border-[rgba(255,255,255,0.08)] text-zinc-500 text-xs font-semibold">
        Aucun match dans cette catégorie.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(match => {
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
      statusPill = `<span class="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">Terminé</span>`;
    } else if (selectedTeamId) {
      statusPill = `<span class="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-white text-black border border-white">Prono validé</span>`;
    } else {
      statusPill = `<span class="text-[10px] font-bold text-zinc-400">${dateFormatted}</span>`;
    }

    let boostButton = '';
    if (!isFinished) {
      boostButton = `
        <button 
          onclick="handleToggleBoost(${match.id}, event)" 
          class="boost-btn px-2 py-0.5 rounded-lg text-[10px] font-condensed font-black uppercase tracking-wider flex items-center gap-1 transition ${
            isBoosted ? 'boost-btn-active' : 'boost-btn-inactive'
          }"
          title="Bonus x2 : double les points en cas de victoire (1 seul par semaine)"
        >
          <span>⚡</span>
          <span>${isBoosted ? 'x2 Actif' : 'Bonus x2'}</span>
        </button>
      `;
    } else if (isBoosted) {
      boostButton = `
        <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-white/10 text-white border border-white/25 flex items-center gap-1">
          <span>⚡</span> x2 Joué
        </span>
      `;
    }

    return `
      <div class="match-card rounded-2xl p-3 sm:p-3.5 space-y-3 ${isBoosted ? 'match-card-boosted' : ''}">
        
        <!-- En-tête : Semaine, Date, Bonus x2 & État -->
        <div class="flex items-center justify-between text-xs pb-2 border-b border-[rgba(255,255,255,0.08)] gap-1.5">
          <div class="flex items-center space-x-1.5 text-zinc-400 font-medium text-[11px] min-w-0 truncate">
            <span class="px-1.5 py-0.5 rounded bg-[#18181c] text-zinc-300 font-bold border border-[rgba(255,255,255,0.08)] text-[10px] shrink-0">W${match.week_number || 1}</span>
            <span class="w-1.5 h-1.5 rounded-full ${isFinished ? 'bg-zinc-600' : 'bg-white'} shrink-0"></span>
            <span class="truncate">${isFinished ? 'Terminé' : dateFormatted}</span>
          </div>
          <div class="flex items-center space-x-1.5 shrink-0">
            ${boostButton}
            <div>${statusPill}</div>
          </div>
        </div>

        <!-- Deux blocs équipes et cotes -->
        <div class="grid grid-cols-2 gap-2 sm:gap-2.5 items-stretch">
          
          <!-- ÉQUIPE DOMICILE -->
          <button
            onclick="voteForTeam(${match.id}, ${match.home_team.id}, ${isFinished})"
            class="odds-btn h-full rounded-xl p-2.5 sm:p-3 flex flex-col justify-between text-left relative ${
              homeSelected ? 'odds-btn-selected' : ''
            } ${isFinished ? 'cursor-default' : ''}"
          >
            <div class="flex items-center space-x-2 w-full mb-1.5">
              <div 
                class="w-7 h-7 rounded-md flex items-center justify-center font-condensed font-black text-xs shadow shrink-0"
                style="background-color: ${match.home_team.color}; color: ${match.home_team.text_color};"
              >
                ${match.home_team.code}
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-condensed font-black text-xs sm:text-sm uppercase tracking-wide text-white truncate leading-tight">
                  ${match.home_team.city}
                </div>
                <div class="flex items-center justify-between gap-1 mt-0.5">
                  <span class="text-[9px] font-bold uppercase tracking-wider text-slate-500 truncate">Dom.</span>
                  <div class="flex items-center gap-0.5 shrink-0" title="Forme (5 derniers matchs)">
                    ${(match.home_team.recent_form || []).map(r => r === 'W' 
                      ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shadow-sm shadow-emerald-500/50"></span>' 
                      : '<span class="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block shadow-sm shadow-rose-500/50"></span>'
                    ).join('')}
                  </div>
                </div>
              </div>
            </div>

            <div class="w-full flex items-center justify-between pt-1.5 border-t border-[rgba(255,255,255,0.06)]">
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

          <!-- ÉQUIPE EXTÉRIEUR -->
          <button
            onclick="voteForTeam(${match.id}, ${match.away_team.id}, ${isFinished})"
            class="odds-btn h-full rounded-xl p-2.5 sm:p-3 flex flex-col justify-between text-left relative ${
              awaySelected ? 'odds-btn-selected' : ''
            } ${isFinished ? 'cursor-default' : ''}"
          >
            <div class="flex items-center space-x-2 w-full mb-1.5">
              <div 
                class="w-7 h-7 rounded-md flex items-center justify-center font-condensed font-black text-xs shadow shrink-0"
                style="background-color: ${match.away_team.color}; color: ${match.away_team.text_color};"
              >
                ${match.away_team.code}
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-condensed font-black text-xs sm:text-sm uppercase tracking-wide text-white truncate leading-tight">
                  ${match.away_team.city}
                </div>
                <div class="flex items-center justify-between gap-1 mt-0.5">
                  <span class="text-[9px] font-bold uppercase tracking-wider text-slate-500 truncate">Ext.</span>
                  <div class="flex items-center gap-0.5 shrink-0" title="Forme (5 derniers matchs)">
                    ${(match.away_team.recent_form || []).map(r => r === 'W' 
                      ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shadow-sm shadow-emerald-500/50"></span>' 
                      : '<span class="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block shadow-sm shadow-rose-500/50"></span>'
                    ).join('')}
                  </div>
                </div>
              </div>
            </div>

            <div class="w-full flex items-center justify-between pt-1.5 border-t border-[rgba(255,255,255,0.06)]">
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

        </div>

        <!-- Footer carte : Pronostics de ligue -->
        <div class="pt-2 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
          <span class="text-[10px] text-zinc-400 font-semibold flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 text-zinc-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <span>Pronos de ligue</span>
          </span>
          <button 
            onclick="openLeagueMatchVotesModal(${match.id})" 
            class="btn-tactile text-[10px] font-condensed font-bold uppercase tracking-wider text-zinc-200 hover:text-white bg-[#18181c] hover:bg-[#24242c] px-2.5 py-1 rounded-lg border border-[rgba(255,255,255,0.10)] transition cursor-pointer flex items-center gap-1"
          >
            <span>Qui a voté quoi ?</span>
            <span>›</span>
          </button>
        </div>

      </div>
    `;
  }).join('');
}

// --- Action Bonus x2 (Chantier 2) ---
async function handleToggleBoost(matchId, event) {
  if (event) event.stopPropagation();

  if (!state.currentUser) {
    openAuthModal('login');
    notify("Connecte-toi pour activer ton Bonus x2 !", "info");
    return;
  }

  if (!state.myPredictions[matchId]) {
    notify("Choisis d'abord ton équipe gagnante avant d'activer le Bonus x2 !", "error");
    return;
  }

  try {
    const res = await API.toggleBoost(matchId);
    const targetMatch = state.matches.find(m => m.id === matchId);
    const week = targetMatch ? targetMatch.week_number : (res.week_number || 1);

    if (res.is_boosted) {
      // Désactiver le bonus sur les autres matchs de cette semaine
      state.matches.forEach(m => {
        if (m.week_number === week && m.id !== matchId) {
          delete state.boostedPredictions[m.id];
        }
      });
      state.boostedPredictions[matchId] = true;
      launchConfetti();
      notify(`Bonus x2 activé pour la Semaine ${week} ! ⚡ (Points doublés)`, "success");
    } else {
      delete state.boostedPredictions[matchId];
      notify("Bonus x2 désactivé sur ce match.", "info");
    }

    renderMatchesList();
  } catch (err) {
    notify(err.message, "error");
  }
}

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

  // Chantier 4 : Obligation de choisir ses Joueurs de la Semaine (Est & Ouest)
  const targetMatch = state.matches.find(m => m.id === matchId);
  const weekNum = targetMatch ? targetMatch.week_number : 1;
  const wp = state.weeklyPlayersMap[weekNum];

  if (!wp || !wp.east_player || !wp.west_player) {
    notify(`⚠️ Choisis d'abord tes 2 Joueurs de la Semaine pour la Week ${weekNum} !`, "error");
    const container = document.getElementById('weekly-players-container');
    if (container) {
      container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      container.classList.add('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-[#09090b]');
      setTimeout(() => {
        container.classList.remove('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-[#09090b]');
      }, 2000);
    }
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

  const lb = state.leaderboard;

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
    <div class="podium-step-2 rounded-xl p-2.5 text-center border flex flex-col justify-end min-h-[110px]">
      ${top2 ? `
        <div class="flex justify-center mb-1">${getUserAvatarHtml(top2.username, 'sm', top2.avatar_url)}</div>
        <div class="w-5 h-5 mx-auto mb-1 rounded-full bg-zinc-300 text-black font-black text-[10px] flex items-center justify-center">2</div>
        <div class="font-bold text-xs text-white truncate">${top2.username}</div>
        <div class="font-condensed font-black text-sm text-zinc-300">${top2.total_points.toFixed(1)} <span class="text-[10px]">pts</span></div>
      ` : '<div class="text-zinc-600 text-xs">-</div>'}
    </div>

    <!-- 1ère Place (Au centre, surélevé) -->
    <div class="podium-step-1 rounded-xl p-3 text-center border flex flex-col justify-end min-h-[135px]">
      ${top1 ? `
        <div class="flex justify-center mb-1.5">${getUserAvatarHtml(top1.username, 'md', top1.avatar_url)}</div>
        <div class="w-6 h-6 mx-auto mb-1 rounded-full bg-white text-black font-black text-xs flex items-center justify-center shadow-md">1</div>
        <div class="font-black text-xs text-white truncate">${top1.username}</div>
        <div class="font-condensed font-black text-base text-white">${top1.total_points.toFixed(1)} <span class="text-[10px]">pts</span></div>
      ` : '<div class="text-zinc-600 text-xs">-</div>'}
    </div>

    <!-- 3ème Place -->
    <div class="podium-step-3 rounded-xl p-2.5 text-center border flex flex-col justify-end min-h-[95px]">
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
            🏆
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-condensed font-black text-sm uppercase tracking-wide text-white">Pronos d'Avant-Saison</span>
              <span class="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">5 Choix Clés</span>
            </div>
            <p class="text-[11px] text-slate-400 leading-tight mt-0.5">
              Champion, MVP, DPOY, ROY, In-Season Cup : pronostique avant le 1er match !
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
  const picksCount = p ? [p.nba_champion, p.cup_winner, p.mvp, p.dpoy, p.roy].filter(Boolean).length : 0;
  const hasAllPicks = picksCount === 5;

  if (isLocked) {
    container.innerHTML = `
      <div class="p-3.5 bg-[#12141a] rounded-2xl border border-[#23273a] shadow-lg flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-lg shrink-0 text-slate-400">
            🔒
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
            ✨
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
            🏆
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

  const champSelect = document.getElementById('season-champion');
  const cupSelect = document.getElementById('season-cup');
  const mvpSelect = document.getElementById('season-mvp');
  const dpoySelect = document.getElementById('season-dpoy');
  const roySelect = document.getElementById('season-roy');
  const submitBtn = document.getElementById('season-submit-btn');
  const lockAlert = document.getElementById('season-lock-alert');
  const errBox = document.getElementById('season-error-box');

  if (errBox) errBox.classList.add('hidden');

  if (champSelect && p) setSelectValueFuzzy(champSelect, p.nba_champion);
  if (cupSelect && p) setSelectValueFuzzy(cupSelect, p.cup_winner);
  if (mvpSelect && p) setSelectValueFuzzy(mvpSelect, p.mvp);
  if (dpoySelect && p) setSelectValueFuzzy(dpoySelect, p.dpoy);
  if (roySelect && p) setSelectValueFuzzy(roySelect, p.roy);

  const selects = [champSelect, cupSelect, mvpSelect, dpoySelect, roySelect];

  if (isLocked) {
    selects.forEach(s => { if (s) s.disabled = true; });
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "🔒 Pronostics Verrouillés";
      submitBtn.className = "w-full bg-[#18181c] text-zinc-500 font-condensed text-sm font-black uppercase tracking-wider py-2.5 rounded-xl transition cursor-not-allowed mt-2 border border-zinc-800";
    }
    if (lockAlert) {
      lockAlert.className = "mb-3 p-2.5 rounded-xl border text-xs font-semibold bg-rose-500/10 border-rose-500/30 text-rose-400";
      lockAlert.innerHTML = `
        <div class="flex items-center gap-1.5 font-bold uppercase">
          <span>🔒</span> Pronostics Définitivement Verrouillés
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
        <div class="flex items-center gap-1.5 font-bold uppercase">
          <span>⏳</span> Choix Modifiables
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

  const nba_champion = document.getElementById('season-champion')?.value;
  const cup_winner = document.getElementById('season-cup')?.value;
  const mvp = document.getElementById('season-mvp')?.value;
  const dpoy = document.getElementById('season-dpoy')?.value;
  const roy = document.getElementById('season-roy')?.value;

  if (!nba_champion || !cup_winner || !mvp || !dpoy || !roy) {
    if (errBox) {
      errBox.textContent = "Merci de compléter les 5 pronostics avant de valider.";
      errBox.classList.remove('hidden');
    }
    return;
  }

  try {
    const updated = await API.saveSeasonPrediction({
      nba_champion,
      cup_winner,
      mvp,
      dpoy,
      roy
    });
    state.seasonPrediction = updated;
    closeSeasonModal();
    renderSeasonBanner();
    if (state.activeTab === 'profile') renderProfile();
    notify("🏆 Tes 5 pronostics de saison sont enregistrés !", "success");
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  }
}

// --- Pronostics Hebdomadaires - Joueurs de la Semaine (Chantier 4) ---
async function loadWeeklyPlayerCandidates() {
  if (!state.weeklyPlayerCandidates) {
    try {
      state.weeklyPlayerCandidates = await API.getWeeklyCandidates();
    } catch (err) {
      console.error("Erreur chargement candidats joueurs hebdo:", err);
    }
  }
}

function renderWeeklyPlayersCard() {
  const container = document.getElementById('weekly-players-container');
  if (!container) return;

  const availableWeeks = state.availableWeeks || [];
  const defaultWeek = availableWeeks[0]?.week || 1;
  const currentWeek = state.selectedWeek === 'all' ? defaultWeek : parseInt(state.selectedWeek);

  const wp = state.weeklyPlayersMap[currentWeek];
  const isLocked = wp ? wp.is_locked : false;
  const hasChoices = wp && !!wp.east_player && !!wp.west_player;

  const candidates = state.weeklyPlayerCandidates || { east: [], west: [] };
  const eastList = [...(candidates.east || [])].sort((a, b) => a.localeCompare(b, 'fr'));
  const westList = [...(candidates.west || [])].sort((a, b) => a.localeCompare(b, 'fr'));

  const matchedEast = wp ? findMatchingPlayerOption(eastList, wp.east_player) : '';
  const matchedWest = wp ? findMatchingPlayerOption(westList, wp.west_player) : '';

  container.innerHTML = `
    <div class="p-3.5 bg-[#121216] rounded-2xl border ${hasChoices ? 'border-white/20' : 'border-[rgba(255,255,255,0.10)]'} shadow-md space-y-3 transition-all duration-300">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <span class="text-base">🌟</span>
          <div>
            <div class="flex items-center gap-1.5">
              <span class="font-condensed font-black text-sm uppercase tracking-wide text-white">
                Joueurs de la Semaine • Week ${currentWeek}
              </span>
              <span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                isLocked 
                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30' 
                  : hasChoices 
                    ? 'bg-white text-black font-bold' 
                    : 'bg-white/10 text-white border border-white/20'
              }">
                ${isLocked ? '🔒 Verrouillé' : hasChoices ? '✅ 2/2 Validés' : '⚡ Obligatoire'}
              </span>
            </div>
            <p class="text-[10px] text-zinc-400 leading-tight mt-0.5">
              ${isLocked 
                ? 'Les matchs de cette semaine ont débuté. Choix définitivement verrouillés.' 
                : hasChoices 
                  ? 'Tes 2 choix sont enregistrés ! Modifiables avant le premier match.' 
                  : 'Recherche 1 joueur Est et 1 joueur Ouest pour débloquer tes pronostics.'}
            </p>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <!-- Conférence Est -->
        <div class="relative">
          <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1 flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-zinc-300 inline-block"></span>
              <span>Conférence Est</span>
            </span>
            <span class="text-[9px] text-slate-500 font-mono">${eastList.length} joueurs</span>
          </label>
          <input type="hidden" id="weekly-east-select-${currentWeek}" value="${matchedEast || ''}">
          
          ${matchedEast ? `
            <div class="flex items-center justify-between p-2 rounded-xl bg-[#181a24] border border-white/20">
              <div class="flex items-center space-x-2 truncate">
                <span class="text-zinc-300 font-bold text-xs">🏀</span>
                <span class="font-bold text-xs text-white truncate">${matchedEast}</span>
              </div>
              ${!isLocked ? `
                <button type="button" onclick="clearWeeklyPlayerSelection('east', ${currentWeek})" class="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-[#202535] hover:bg-[#282f42] border border-[#2f374e] transition cursor-pointer shrink-0">
                  Changer
                </button>
              ` : ''}
            </div>
          ` : `
            <div class="relative">
              <input 
                type="text" 
                id="weekly-east-search-${currentWeek}" 
                oninput="filterPlayerSuggestions('east', ${currentWeek})"
                onfocus="filterPlayerSuggestions('east', ${currentWeek})"
                ${isLocked ? 'disabled' : ''} 
                placeholder="Tape un nom (ex: Tatum, Giannis...)"
                autocomplete="off"
                class="w-full bg-[#181a24] border border-[#282c3e] rounded-xl px-2.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-white disabled:opacity-50"
              >
              <div id="weekly-east-suggestions-${currentWeek}" class="absolute z-30 left-0 right-0 top-full mt-1 bg-[#151822] border border-[#2c3244] rounded-xl shadow-2xl max-h-48 overflow-y-auto hidden divide-y divide-[#202535]"></div>
            </div>
          `}
        </div>

        <!-- Conférence Ouest -->
        <div class="relative">
          <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1 flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-zinc-500 inline-block"></span>
              <span>Conférence Ouest</span>
            </span>
            <span class="text-[9px] text-slate-500 font-mono">${westList.length} joueurs</span>
          </label>
          <input type="hidden" id="weekly-west-select-${currentWeek}" value="${matchedWest || ''}">

          ${matchedWest ? `
            <div class="flex items-center justify-between p-2 rounded-xl bg-[#181a24] border border-white/20">
              <div class="flex items-center space-x-2 truncate">
                <span class="text-zinc-300 font-bold text-xs">🏀</span>
                <span class="font-bold text-xs text-white truncate">${matchedWest}</span>
              </div>
              ${!isLocked ? `
                <button type="button" onclick="clearWeeklyPlayerSelection('west', ${currentWeek})" class="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-[#202535] hover:bg-[#282f42] border border-[#2f374e] transition cursor-pointer shrink-0">
                  Changer
                </button>
              ` : ''}
            </div>
          ` : `
            <div class="relative">
              <input 
                type="text" 
                id="weekly-west-search-${currentWeek}" 
                oninput="filterPlayerSuggestions('west', ${currentWeek})"
                onfocus="filterPlayerSuggestions('west', ${currentWeek})"
                ${isLocked ? 'disabled' : ''} 
                placeholder="Tape un nom (ex: Doncic, Curry...)"
                autocomplete="off"
                class="w-full bg-[#181a24] border border-[#282c3e] rounded-xl px-2.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-white disabled:opacity-50"
              >
              <div id="weekly-west-suggestions-${currentWeek}" class="absolute z-30 left-0 right-0 top-full mt-1 bg-[#151822] border border-[#2c3244] rounded-xl shadow-2xl max-h-48 overflow-y-auto hidden divide-y divide-[#202535]"></div>
            </div>
          `}
        </div>
      </div>

      ${!isLocked ? `
        <button 
          onclick="saveWeeklyPlayers(${currentWeek})" 
          class="w-full ${
            hasChoices 
              ? 'bg-[#18181c] hover:bg-[#222228] text-zinc-200 border border-zinc-700' 
              : 'bg-white hover:bg-zinc-200 text-black shadow-md'
          } font-condensed font-black text-xs uppercase tracking-wider py-2 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
        >
          <span>${hasChoices ? '💾 Mettre à jour mes 2 choix' : '⚡ Valider mes 2 Joueurs de la Semaine'}</span>
        </button>
      ` : ''}
    </div>
  `;
}

function filterPlayerSuggestions(conf, week) {
  const input = document.getElementById(`weekly-${conf}-search-${week}`);
  const suggBox = document.getElementById(`weekly-${conf}-suggestions-${week}`);
  if (!input || !suggBox) return;

  const q = (input.value || '').trim().toLowerCase();
  const list = conf === 'east' 
    ? (state.weeklyPlayerCandidates?.east || []) 
    : (state.weeklyPlayerCandidates?.west || []);

  const filtered = list.filter(p => p.toLowerCase().includes(q)).slice(0, 10);

  if (filtered.length === 0) {
    suggBox.innerHTML = `<div class="p-2.5 text-center text-slate-500 text-[11px]">Aucun joueur correspondant</div>`;
    suggBox.classList.remove('hidden');
    return;
  }

  suggBox.innerHTML = filtered.map(p => `
    <div 
      onclick="selectWeeklyPlayer('${conf}', ${week}, '${p.replace(/'/g, "\\'")}')" 
      class="player-suggest-item px-3 py-2 text-xs font-semibold text-slate-200 hover:text-white cursor-pointer flex items-center justify-between"
    >
      <span>${p}</span>
      <span class="text-[9px] text-slate-500 font-bold uppercase">${conf === 'east' ? 'EST' : 'OUEST'}</span>
    </div>
  `).join('');
  suggBox.classList.remove('hidden');
}

function selectWeeklyPlayer(conf, week, playerName) {
  const hiddenInput = document.getElementById(`weekly-${conf}-select-${week}`);
  if (hiddenInput) hiddenInput.value = playerName;
  if (!state.weeklyPlayersMap[week]) {
    state.weeklyPlayersMap[week] = { week_number: week, is_locked: false, east_player: null, west_player: null };
  }
  if (conf === 'east') state.weeklyPlayersMap[week].east_player = playerName;
  if (conf === 'west') state.weeklyPlayersMap[week].west_player = playerName;
  renderWeeklyPlayersCard();
}

function clearWeeklyPlayerSelection(conf, week) {
  const hiddenInput = document.getElementById(`weekly-${conf}-select-${week}`);
  if (hiddenInput) hiddenInput.value = '';
  if (state.weeklyPlayersMap[week]) {
    if (conf === 'east') state.weeklyPlayersMap[week].east_player = '';
    if (conf === 'west') state.weeklyPlayersMap[week].west_player = '';
  }
  renderWeeklyPlayersCard();
}

async function saveWeeklyPlayers(weekNumber) {
  if (!state.currentUser) {
    openAuthModal('login');
    notify("Connecte-toi pour valider tes Joueurs de la Semaine", "info");
    return;
  }

  const eastEl = document.getElementById(`weekly-east-select-${weekNumber}`);
  const westEl = document.getElementById(`weekly-west-select-${weekNumber}`);
  const eastPlayer = eastEl?.value;
  const westPlayer = westEl?.value;

  if (!eastPlayer || !westPlayer) {
    notify("Sélectionne 1 joueur Est et 1 joueur Ouest !", "error");
    return;
  }

  try {
    const res = await API.saveWeeklyPlayerPrediction(weekNumber, eastPlayer, westPlayer);
    state.weeklyPlayersMap[weekNumber] = res;
    renderWeeklyPlayersCard();
    if (state.activeTab === 'profile') renderProfile();
    notify(`⭐ Joueurs de la Semaine ${weekNumber} validés ! Tu peux maintenant pronostiquer tes matchs.`, "success");
  } catch (err) {
    notify(err.message, "error");
  }
}

// --- Rendu du Profil & Statistiques (Chantier 1) ---
async function renderProfile() {
  const container = document.getElementById('profile-content');
  if (!container) return;

  if (!state.currentUser) {
    container.innerHTML = `
      <div class="p-6 bg-[#121216] rounded-2xl border border-[rgba(255,255,255,0.08)] text-center space-y-4 shadow-xl">
        <div class="w-14 h-14 mx-auto rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-2xl text-white">
          👤
        </div>
        <div class="font-condensed font-black text-xl text-white">Connecte-toi pour voir ton profil</div>
        <p class="text-xs text-zinc-400 max-w-xs mx-auto leading-relaxed">
          Accède à ton Winrate en direct, analyse tes cotes validées et débloque les badges officiels.
        </p>
        <button onclick="openAuthModal('login')" class="bg-white hover:bg-zinc-200 text-black font-condensed font-black text-sm uppercase px-5 py-2.5 rounded-xl transition cursor-pointer shadow-md">
          Connexion / Inscription
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="p-8 text-center text-slate-500 text-xs font-semibold">
      Chargement de tes statistiques...
    </div>
  `;

  try {
    const [stats, seasonPred] = await Promise.all([
      API.getMyStats(),
      API.getSeasonPrediction()
    ]);
    if (!stats) return;
    state.seasonPrediction = seasonPred;

    const initials = stats.username.substring(0, 2).toUpperCase();
    const winrateColor = stats.winrate >= 55 ? 'text-emerald-400' : stats.winrate >= 40 ? 'text-[#ff5500]' : 'text-slate-200';

    container.innerHTML = `
      <!-- Carte Joueur avec Avatar Culte -->
      <div class="p-3.5 sm:p-4 surface-card flex items-center justify-between gap-3 shadow-xl">
        <div class="flex items-center space-x-3 min-w-0">
          <div class="relative cursor-pointer group" onclick="openAvatarSelectorModal()" title="Changer d'avatar">
            ${getUserAvatarHtml(stats.username, 'lg', stats.avatar_url)}
            <div class="absolute -bottom-1 -right-1 bg-white text-black p-0.5 rounded-full shadow border border-black/40 text-[9px] flex items-center justify-center w-4 h-4">
              ✏️
            </div>
          </div>
          <div class="min-w-0">
            <div class="font-condensed font-black text-lg sm:text-xl text-white leading-tight truncate">
              ${stats.username}
            </div>
            <div class="text-[11px] text-zinc-400 truncate max-w-[140px] sm:max-w-[200px]">
              ${stats.email || 'Membre HOOPS Prono'}
            </div>
          </div>
        </div>

        <div class="text-right shrink-0">
          <div class="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Classement</div>
          <div class="font-condensed font-black text-base sm:text-lg text-white">
            #${stats.rank || '-'} <span class="text-xs text-zinc-400">(${stats.total_points.toFixed(1)} pts)</span>
          </div>
        </div>
      </div>

      <!-- Bouton Changer Avatar Meme -->
      <button onclick="openAvatarSelectorModal()" class="w-full bg-[#16161a] hover:bg-[#202026] border border-white/10 p-2.5 rounded-xl flex items-center justify-center gap-2 text-xs font-condensed font-bold uppercase tracking-wider text-zinc-300 hover:text-white transition cursor-pointer shadow-sm">
        <span>🎭</span> Choisir mon avatar Meme NBA
      </button>

      <!-- Grille des Statistiques du Joueur -->
      <div class="grid grid-cols-3 gap-2 sm:gap-2.5">
        
        <!-- Winrate -->
        <div class="surface-card p-2 sm:p-3 text-center flex flex-col justify-between">
          <div class="text-[9px] font-bold uppercase tracking-wider text-slate-400 truncate">Winrate</div>
          <div class="font-condensed font-black text-xl sm:text-2xl ${winrateColor} my-0.5">
            ${stats.winrate.toFixed(1)}%
          </div>
          <div class="text-[9px] sm:text-[10px] text-slate-500 font-semibold truncate">
            ${stats.won_predictions}/${stats.finished_predictions} validés
          </div>
        </div>

        <!-- Cote moyenne trouvée -->
        <div class="surface-card p-2 sm:p-3 text-center flex flex-col justify-between">
          <div class="text-[9px] font-bold uppercase tracking-wider text-slate-400 truncate">Cote Moy.</div>
          <div class="font-condensed font-black text-xl sm:text-2xl text-white my-0.5">
            ${stats.avg_odds > 0 ? stats.avg_odds.toFixed(2) : '-'}
          </div>
          <div class="text-[9px] sm:text-[10px] text-slate-500 font-semibold truncate">
            sur victoires
          </div>
        </div>

        <!-- Plus grosse cote -->
        <div class="surface-card p-2 sm:p-3 text-center flex flex-col justify-between">
          <div class="text-[9px] font-bold uppercase tracking-wider text-slate-400 truncate">Max Cote</div>
          <div class="font-condensed font-black text-xl sm:text-2xl text-white my-0.5">
            ${stats.max_odds > 0 ? stats.max_odds.toFixed(2) : '-'}
          </div>
          <div class="text-[9px] sm:text-[10px] text-slate-500 font-semibold truncate">
            record validé
          </div>
        </div>

      </div>

      <!-- Équipe Fétiche & Chat Noir -->
      <div class="grid grid-cols-2 gap-2">
        <div class="surface-card p-2.5 rounded-xl border border-white/5 space-y-0.5">
          <div class="text-[9px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
            <span>🍀</span> Équipe Fétiche
          </div>
          <div class="font-condensed font-black text-sm text-white truncate">
            ${stats.favorite_team || 'En cours...'}
          </div>
        </div>
        <div class="surface-card p-2.5 rounded-xl border border-white/5 space-y-0.5">
          <div class="text-[9px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1">
            <span>🐈‍⬛</span> Chat Noir
          </div>
          <div class="font-condensed font-black text-sm text-white truncate">
            ${stats.nemesis_team || 'Aucun 🛡️'}
          </div>
        </div>
      </div>

      <!-- Actions Rapides Profil (Bilan Story & Défier) -->
      <div class="grid grid-cols-2 gap-2 pt-1">
        <button onclick="openShareRecapModal()" class="btn-tactile p-2.5 rounded-xl bg-[#18181c] hover:bg-[#222228] border border-[rgba(255,255,255,0.08)] flex items-center justify-center gap-1.5 text-xs font-condensed font-black uppercase tracking-wider text-zinc-200 cursor-pointer">
          <svg class="w-3.5 h-3.5 text-zinc-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          <span>Bilan Story</span>
        </button>
        <button onclick="shareApp()" class="btn-tactile p-2.5 rounded-xl bg-[#18181c] hover:bg-[#222228] border border-[rgba(255,255,255,0.08)] flex items-center justify-center gap-1.5 text-xs font-condensed font-black uppercase tracking-wider text-white cursor-pointer">
          <svg class="w-3.5 h-3.5 text-zinc-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
          <span>Défier des amis</span>
        </button>
      </div>

      <!-- Section Pronostics d'Avant-Saison (Chantier 3) -->
      <div class="space-y-2.5 pt-2">
        <div class="flex items-center justify-between">
          <h3 class="font-condensed font-black text-lg uppercase tracking-tight text-white flex items-center gap-1.5">
            <span>Pronostics de Saison</span>
            <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${seasonPred && seasonPred.is_locked ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'}">
              ${seasonPred && seasonPred.is_locked ? '🔒 Verrouillé' : '⏳ Modifiable'}
            </span>
          </h3>
          ${!seasonPred?.is_locked ? `
            <button onclick="openSeasonModal()" class="text-xs text-[#ff5500] hover:underline font-bold cursor-pointer">
              ${seasonPred && seasonPred.nba_champion ? 'Modifier' : 'Faire mes 5 choix'}
            </button>
          ` : ''}
        </div>

        <div class="bg-[#12141a] p-3.5 rounded-2xl border border-[#1f222d] space-y-2 text-xs shadow-lg">
          <div class="flex items-center justify-between border-b border-[#1b1e28] pb-1.5">
            <span class="text-slate-400 font-medium flex items-center gap-1.5">
              <span>🏆</span> Champion NBA
            </span>
            <span class="font-bold ${seasonPred?.nba_champion ? 'text-white' : 'text-slate-500 italic'}">
              ${seasonPred?.nba_champion || 'Non pronostiqué'}
            </span>
          </div>

          <div class="flex items-center justify-between border-b border-[#1b1e28] pb-1.5">
            <span class="text-slate-400 font-medium flex items-center gap-1.5">
              <span>🥇</span> In-Season Tournament
            </span>
            <span class="font-bold ${seasonPred?.cup_winner ? 'text-white' : 'text-slate-500 italic'}">
              ${seasonPred?.cup_winner || 'Non pronostiqué'}
            </span>
          </div>

          <div class="flex items-center justify-between border-b border-[#1b1e28] pb-1.5">
            <span class="text-slate-400 font-medium flex items-center gap-1.5">
              <span>⭐</span> MVP
            </span>
            <span class="font-bold ${seasonPred?.mvp ? 'text-amber-400' : 'text-slate-500 italic'}">
              ${seasonPred?.mvp || 'Non pronostiqué'}
            </span>
          </div>

          <div class="flex items-center justify-between border-b border-[#1b1e28] pb-1.5">
            <span class="text-slate-400 font-medium flex items-center gap-1.5">
              <span>🛡️</span> DPOY
            </span>
            <span class="font-bold ${seasonPred?.dpoy ? 'text-white' : 'text-slate-500 italic'}">
              ${seasonPred?.dpoy || 'Non pronostiqué'}
            </span>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-slate-400 font-medium flex items-center gap-1.5">
              <span>👶</span> ROY
            </span>
            <span class="font-bold ${seasonPred?.roy ? 'text-white' : 'text-slate-500 italic'}">
              ${seasonPred?.roy || 'Non pronostiqué'}
            </span>
          </div>
        </div>
      </div>

      <!-- Section Joueurs de la Semaine (Chantier 4) -->
      <div class="space-y-2.5 pt-2">
        <div class="flex items-center justify-between">
          <h3 class="font-condensed font-black text-lg uppercase tracking-tight text-white flex items-center gap-1.5">
            <span>Joueurs de la Semaine</span>
            <span class="text-xs text-slate-400 font-sans font-medium">(Par Semaine)</span>
          </h3>
        </div>

        <div class="space-y-2">
          ${(state.availableWeeks || []).map(w => {
            const wp = state.weeklyPlayersMap[w.week];
            const hasWp = wp && wp.east_player && wp.west_player;
            return `
              <div class="bg-[#12141a] p-3 rounded-xl border border-[#1f222d] text-xs space-y-1.5 shadow-md">
                <div class="flex items-center justify-between border-b border-[#1b1e28] pb-1">
                  <span class="font-condensed font-black text-white uppercase text-sm">Week ${w.week}</span>
                  <span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${hasWp ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'}">
                    ${hasWp ? '✅ 2/2 Validés' : '⚡ À compléter'}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-slate-400 font-medium">🔵 Est</span>
                  <span class="font-bold ${wp?.east_player ? 'text-white' : 'text-slate-500 italic'}">${wp?.east_player || 'Non choisi'}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-slate-400 font-medium">🔴 Ouest</span>
                  <span class="font-bold ${wp?.west_player ? 'text-white' : 'text-slate-500 italic'}">${wp?.west_player || 'Non choisi'}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Section Badges & Trophées -->
      <div class="space-y-3 pt-2">
        <div class="flex items-center justify-between">
          <h3 class="font-condensed font-black text-lg uppercase tracking-tight text-white flex items-center gap-1.5">
            <span>Badges & Trophées</span>
            <span class="text-xs text-slate-400 font-sans font-medium">(${stats.badges.filter(b => b.unlocked).length}/${stats.badges.length})</span>
          </h3>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          ${stats.badges.map(badge => `
            <div class="badge-card ${badge.unlocked ? 'unlocked' : 'locked'} p-3.5 space-y-2.5 flex flex-col justify-between">
              <div class="flex items-start justify-between gap-3">
                
                <div class="flex items-center space-x-3">
                  <div class="badge-icon-wrap">
                    ${badge.icon}
                  </div>
                  <div>
                    <div class="font-condensed font-black text-base uppercase tracking-wide text-white">
                      ${badge.name}
                    </div>
                    <div class="text-xs text-slate-400 leading-tight">
                      ${badge.description}
                    </div>
                  </div>
                </div>

                <div>
                  ${badge.unlocked ? `
                    <span class="text-[10px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap shadow-sm shadow-emerald-500/10">
                      <span>✨</span> Débloqué
                    </span>
                  ` : `
                    <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-[#161822] border border-[#262a3c] px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap">
                      <span>🔒</span> ${badge.current}/${badge.target}
                    </span>
                  `}
                </div>

              </div>

              <!-- Barre de progression -->
              <div class="w-full bg-[#161824] rounded-full h-1.5 overflow-hidden border border-[#232738]">
                <div 
                  class="h-full transition-all duration-500 ${badge.unlocked ? 'bg-white' : 'bg-zinc-600'}" 
                  style="width: ${badge.progress_pct}%"
                ></div>
              </div>

            </div>
          `).join('')}
        </div>
      </div>

      <!-- Déconnexion -->
      <div class="pt-2">
        <button onclick="handleLogout()" class="btn-tactile w-full py-2.5 rounded-xl bg-[#141722] hover:bg-rose-500/10 border border-[rgba(255,255,255,0.08)] hover:border-rose-500/30 text-slate-400 hover:text-rose-400 text-xs font-condensed font-black uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5">
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
  const sizeClasses = size === 'lg' 
    ? 'w-12 h-12 text-sm font-black' 
    : (size === 'md' ? 'w-8 h-8 text-xs font-bold' : (size === 'xs' ? 'w-6 h-6 text-[9px] font-black' : 'w-7 h-7 text-[10px] font-black'));

  if (url) {
    return `<img src="${url}" alt="${safeName}" class="${sizeClasses} rounded-xl object-cover border border-white/20 shadow-md shrink-0 bg-[#18181b]" onerror="this.style.display='none'" />`;
  }

  const initials = safeName.substring(0, 2).toUpperCase();
  const tones = [
    'bg-[#27272a] text-zinc-200 border border-white/15',
    'bg-[#18181b] text-white border border-white/25',
    'bg-[#3f3f46] text-white border border-white/20',
    'bg-[#202024] text-zinc-300 border border-white/15',
    'bg-[#2e2e36] text-zinc-100 border border-white/20'
  ];
  let hash = 0;
  for (let i = 0; i < safeName.length; i++) {
    hash = safeName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const toneClass = tones[Math.abs(hash) % tones.length];

  return `<div class="${sizeClasses} rounded-xl ${toneClass} flex items-center justify-center shadow-sm uppercase tracking-wider shrink-0 font-condensed font-black">${initials}</div>`;
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
          🔒
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
          🏆
        </div>
        <div class="font-condensed font-black text-lg text-white">Aucune ligue pour le moment</div>
        <p class="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
          Défie tes amis et collègues ! Crée ta propre ligue pour générer un code d'invitation unique ou rejoins une ligue existante.
        </p>
        <div class="flex items-center justify-center gap-2 pt-1">
          <button onclick="openJoinLeagueModal()" class="px-4 py-2 rounded-xl bg-[#171a24] hover:bg-[#202534] border border-[#2b3044] text-slate-200 font-condensed font-bold text-xs uppercase tracking-wider transition cursor-pointer">
            🔑 Rejoindre
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
    const rankLabel = l.user_rank ? (l.user_rank === 1 ? '🥇 #1' : `#${l.user_rank}`) : '-';

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
            <span class="flex items-center gap-1">👥 ${l.members_count} membre${l.members_count > 1 ? 's' : ''}</span>
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
            <span>🎟️</span> Inviter des amis dans la ligue
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
          <span>📋</span> Copier le code
        </button>
        <button onclick="shareLeague('${league.code}', '${escapeHtml(league.name).replace(/'/g, "\\'")}')" class="px-3 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-black uppercase font-condensed tracking-wider transition shadow-md shadow-amber-400/20 flex items-center justify-center gap-1.5 cursor-pointer">
          <span>📤</span> Partager l'invit
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
          if (member.rank === 1) rankBadge = '🥇';
          else if (member.rank === 2) rankBadge = '🥈';
          else if (member.rank === 3) rankBadge = '🥉';

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
                    ${member.is_creator ? '<span class="text-[9px] bg-amber-400/20 text-amber-400 px-1 rounded font-normal shrink-0">👑</span>' : ''}
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

    <!-- Bouton Bilan Partageable de la Ligue (Format Story / WhatsApp) -->
    <div class="pt-1">
      <button 
        onclick="openShareRecapModal(${league.id})" 
        class="w-full bg-[#181a24] hover:bg-[#202534] border border-[#2b3044] text-slate-200 font-condensed font-black text-xs uppercase tracking-wider py-2.5 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-md"
      >
        <span>📸</span> Carte Bilan Partageable (Story & WhatsApp)
      </button>
    </div>

    <!-- Mur de chambrage / Mini-chat (Signature MPP) -->
    <div class="bg-[#12141a] border border-[#1f222d] rounded-2xl p-3.5 space-y-3 shadow-lg">
      <div class="flex items-center justify-between pb-2 border-b border-[#1b1e28]">
        <div class="flex items-center space-x-2">
          <span class="text-base">💬</span>
          <div>
            <h3 class="font-condensed font-black text-sm uppercase tracking-wide text-white">Mur de chambrage</h3>
            <p class="text-[10px] text-slate-400">Trash-talk en direct entre membres de la ligue</p>
          </div>
        </div>
        <button onclick="loadLeagueMessages(${league.id})" class="text-[11px] text-slate-400 hover:text-white p-1 cursor-pointer" title="Rafraîchir les messages">
          🔄
        </button>
      </div>

      <!-- Liste des messages -->
      <div id="league-chat-messages" class="max-h-64 overflow-y-auto space-y-2 pr-1 text-xs">
        <div class="text-center text-slate-500 text-[11px] py-4">Chargement des messages...</div>
      </div>

      <!-- Barre d'emojis rapides -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <button type="button" onclick="insertEmojiToChat('🏀')" class="emoji-pill px-2 py-0.5 rounded-lg bg-[#181a24] border border-[#262a3c] text-xs cursor-pointer">🏀</button>
        <button type="button" onclick="insertEmojiToChat('🔥')" class="emoji-pill px-2 py-0.5 rounded-lg bg-[#181a24] border border-[#262a3c] text-xs cursor-pointer">🔥</button>
        <button type="button" onclick="insertEmojiToChat('🗑️')" class="emoji-pill px-2 py-0.5 rounded-lg bg-[#181a24] border border-[#262a3c] text-xs cursor-pointer">🗑️</button>
        <button type="button" onclick="insertEmojiToChat('👀')" class="emoji-pill px-2 py-0.5 rounded-lg bg-[#181a24] border border-[#262a3c] text-xs cursor-pointer">👀</button>
        <button type="button" onclick="insertEmojiToChat('🐐')" class="emoji-pill px-2 py-0.5 rounded-lg bg-[#181a24] border border-[#262a3c] text-xs cursor-pointer">🐐</button>
        <button type="button" onclick="insertEmojiToChat('💩')" class="emoji-pill px-2 py-0.5 rounded-lg bg-[#181a24] border border-[#262a3c] text-xs cursor-pointer">💩</button>
        <button type="button" onclick="insertEmojiToChat('🥱')" class="emoji-pill px-2 py-0.5 rounded-lg bg-[#181a24] border border-[#262a3c] text-xs cursor-pointer">🥱</button>
        <button type="button" onclick="insertEmojiToChat('🎯')" class="emoji-pill px-2 py-0.5 rounded-lg bg-[#181a24] border border-[#262a3c] text-xs cursor-pointer">🎯</button>
      </div>

      <!-- Formulaire d'envoi -->
      <form id="league-chat-form" onsubmit="handleSendLeagueMessage(event, ${league.id}); return false;" class="flex items-center gap-2">
        <input 
          type="text" 
          id="league-chat-input" 
          maxlength="280" 
          placeholder="Chambre tes potes... (ex: Préparez les mouchoirs 😈)" 
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
    <div class="text-center py-6 text-slate-400 text-xs flex items-center justify-center gap-2">
      <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
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
      ? "🔓 Coup d'envoi sifflé : les pronostics sont révélés !"
      : "🔒 Avant coup d'envoi : les choix restent secrets !";
  }

  if (!data.is_revealed) {
    // Mode Secret avant le match
    content.innerHTML = `
      <div class="p-3 bg-gradient-to-r from-amber-500/10 to-[#181a24] border border-amber-500/30 rounded-xl space-y-1.5 text-center">
        <div class="text-xs font-bold text-amber-400 flex items-center justify-center gap-1.5">
          <span>🔒</span> Pronostics secrets (Suspense MPP)
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
                    ? '<span class="text-[10px] font-black uppercase text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1"><span>✅</span> A voté</span>'
                    : '<span class="text-[10px] font-bold uppercase text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">⏳ En attente</span>'
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
                    ${v.is_boosted ? '<span class="text-[10px] font-black text-amber-400 bg-amber-400/15 border border-amber-400/30 px-1.5 py-0.5 rounded" title="Bonus x2 joué !">⚡ x2</span>' : ''}
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
          Aucun message pour le moment.<br>Sois le premier à chambrer tes potes ! 🔥
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
          <div>⚠️ ${escapeHtml(err.message || 'Impossible de charger les messages')}</div>
          <button type="button" onclick="loadLeagueMessages(${leagueId})" class="px-2.5 py-1 rounded-lg bg-[#1c1f2e] text-zinc-300 hover:text-white border border-zinc-700 text-[10px] cursor-pointer">
            🔄 Réessayer
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
    if (nemTeamEl) nemTeamEl.textContent = data.nemesis_team || 'Aucun 🛡️';

    if (titleEl) {
      if (data.winrate >= 70) titleEl.textContent = "🔥 Précision chirurgicale";
      else if (data.winrate >= 50) titleEl.textContent = "🏀 Clutch Player";
      else titleEl.textContent = "🎯 En pleine montée en puissance";
    }

    if (punchlineEl) {
      if (data.winrate >= 60) {
        punchlineEl.textContent = "« MVP sur le parquet ! Qui peut rivaliser ? Venez tester vos pronos ! »";
      } else {
        punchlineEl.textContent = "« La saison est encore longue, préparez-vous au comeback ! 🚀 »";
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
  const text = currentWrappedShareText || (state.currentUser ? `🏀 HOOPS PRONO - Bilan de ${state.currentUser.username} : ${state.currentUser.total_points.toFixed(1)} pts !\nRejoins-moi sur ${window.location.origin}` : "");
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
      notify("Bilan copié ! Colle-le dans WhatsApp ou ta Story 📸", "success");
    } catch {
      notify("Impossible de copier le bilan.", "error");
    }
  }
}

async function handleCopyRecapText() {
  const text = currentWrappedShareText || (state.currentUser ? `🏀 HOOPS PRONO - Bilan de ${state.currentUser.username} : ${state.currentUser.total_points.toFixed(1)} pts !\nRejoins-moi sur ${window.location.origin}` : "");
  try {
    await navigator.clipboard.writeText(text);
    notify("Texte récapitulatif copié dans le presse-papier ! 📋", "success");
  } catch {
    notify("Erreur lors de la copie.", "error");
  }
}

// Export pour handlers HTML inline
window.openSeasonModal = openSeasonModal;
window.closeSeasonModal = closeSeasonModal;
window.saveWeeklyPlayers = saveWeeklyPlayers;
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
window.filterPlayerSuggestions = filterPlayerSuggestions;
window.selectWeeklyPlayer = selectWeeklyPlayer;
window.clearWeeklyPlayerSelection = clearWeeklyPlayerSelection;



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

// --- Modale Galerie d'Avatars Memes NBA ---
let availableAvatarsCache = null;

async function openAvatarSelectorModal() {
  const modal = document.getElementById('avatar-selector-modal');
  const grid = document.getElementById('avatars-grid');
  if (!modal || !grid) return;

  modal.classList.remove('hidden');

  try {
    if (!availableAvatarsCache) {
      grid.innerHTML = `
        <div class="py-8 text-center text-zinc-500 text-xs flex items-center justify-center gap-2">
          <div class="animate-spin w-4 h-4 border-2 border-white/20 border-t-white rounded-full"></div>
          Chargement des avatars cultes...
        </div>
      `;
      availableAvatarsCache = await API.getAvatars();
    }

    const currentUrl = state.currentUser ? state.currentUser.avatar_url : null;

    grid.innerHTML = availableAvatarsCache.map(av => {
      const isSelected = currentUrl === av.url;
      return `
        <div onclick="handleSelectAvatar('${av.url}')" class="flex items-center gap-3 p-2.5 rounded-xl border transition cursor-pointer select-none ${
          isSelected 
            ? 'bg-white/10 border-white shadow-lg' 
            : 'bg-[#141417] hover:bg-[#1f1f24] border-white/10 hover:border-white/30'
        }">
          <img src="${av.url}" alt="${av.title}" class="w-12 h-12 rounded-xl object-cover border ${isSelected ? 'border-white ring-2 ring-white/50' : 'border-white/20'} bg-[#18181b] shrink-0 shadow" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-1">
              <span class="font-condensed font-bold text-sm text-white truncate">${av.title}</span>
              ${isSelected ? '<span class="text-[10px] font-condensed font-black px-1.5 py-0.5 rounded bg-white text-black uppercase">Actif</span>' : ''}
            </div>
            <p class="text-[11px] text-zinc-400 truncate">${av.meme}</p>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    grid.innerHTML = `<div class="p-4 text-center text-rose-400 text-xs">Erreur de chargement des avatars.</div>`;
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
    notify("Avatar Meme NBA sélectionné ! 🔥", "success");
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
