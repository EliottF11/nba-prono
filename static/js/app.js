/**
 * NBA PRONO - Logique applicative
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
  authMode: 'login'
};

document.addEventListener('DOMContentLoaded', async () => {
  registerServiceWorker();
  initUIEvents();
  await checkSession();
  loadSeasonCandidates();
  await refreshData();
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
        c.classList.remove('active', 'bg-[#ff5500]', 'text-black');
        c.classList.add('bg-[#171a24]', 'text-slate-300');
      });
      chip.classList.add('active', 'bg-[#ff5500]', 'text-black');
      chip.classList.remove('bg-[#171a24]', 'text-slate-300');
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
      <button onclick="handleLogout()" class="flex items-center space-x-1.5 bg-[#171a24] hover:bg-[#202534] border border-[#272d3e] px-3 py-1 rounded-lg text-xs font-bold text-white transition cursor-pointer">
        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
        <span class="max-w-[85px] truncate">${state.currentUser.username}</span>
      </button>
    `;
  } else {
    scoreBadge.classList.add('hidden');
    container.innerHTML = `
      <button onclick="openAuthModal('login')" class="bg-[#ff5500] hover:bg-[#ff661a] text-black font-condensed font-black text-xs uppercase px-3.5 py-1.5 rounded-lg transition cursor-pointer shadow-md shadow-[#ff5500]/20">
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
    btn.classList.toggle('text-[#ff5500]', isCurrent);
    btn.classList.toggle('text-slate-400', !isCurrent);
  });

  const matchesView = document.getElementById('matches-view');
  const leaguesView = document.getElementById('leagues-view');
  const leaderboardView = document.getElementById('leaderboard-view');
  const profileView = document.getElementById('profile-view');

  if (matchesView) matchesView.classList.toggle('hidden', tab !== 'matches');
  if (leaguesView) leaguesView.classList.toggle('hidden', tab !== 'leagues');
  if (leaderboardView) leaderboardView.classList.toggle('hidden', tab !== 'leaderboard');
  if (profileView) profileView.classList.toggle('hidden', tab !== 'profile');

  if (tab === 'leaderboard') {
    renderLeaderboard();
  } else if (tab === 'profile') {
    renderProfile();
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

    renderSeasonBanner();
    renderWeeksSelector();
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
      class="px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
        state.selectedWeek === 'all' 
          ? 'bg-[#ff5500] text-black font-black' 
          : 'bg-[#181a24] text-slate-300 hover:text-white border border-[#262a3c]'
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
        class="px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
          isSelected 
            ? 'bg-[#ff5500] text-black font-black shadow-md shadow-[#ff5500]/25' 
            : 'bg-[#181a24] text-slate-300 hover:text-white border border-[#262a3c]'
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
      <div class="p-8 text-center bg-[#12141a] rounded-xl border border-[#1f222d] text-slate-500 text-xs font-semibold">
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
      statusPill = `<span class="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">Terminé</span>`;
    } else if (selectedTeamId) {
      statusPill = `<span class="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-[#ff5500]/15 text-[#ff5500] border border-[#ff5500]/30">Prono validé</span>`;
    } else {
      statusPill = `<span class="text-[10px] font-bold text-slate-500">${dateFormatted}</span>`;
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
        <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center gap-1">
          <span>⚡</span> x2 Joué
        </span>
      `;
    }

    return `
      <div class="match-card rounded-xl p-3.5 space-y-3 ${isBoosted ? 'match-card-boosted' : ''}">
        
        <!-- En-tête : Semaine, Date, Bonus x2 & État -->
        <div class="flex items-center justify-between text-xs pb-2 border-b border-[#1b1e28]">
          <div class="flex items-center space-x-1.5 text-slate-400 font-medium text-[11px]">
            <span class="px-1.5 py-0.5 rounded bg-[#181a24] text-slate-300 font-bold border border-[#282c3e] text-[10px]">W${match.week_number || 1}</span>
            <span class="w-1.5 h-1.5 rounded-full ${isFinished ? 'bg-slate-600' : 'bg-[#ff5500]'}"></span>
            <span>${isFinished ? 'Match terminé' : dateFormatted}</span>
          </div>
          <div class="flex items-center space-x-1.5">
            ${boostButton}
            <div>${statusPill}</div>
          </div>
        </div>

        <!-- Deux blocs équipes et cotes -->
        <div class="grid grid-cols-2 gap-2.5">
          
          <!-- ÉQUIPE DOMICILE -->
          <button
            onclick="voteForTeam(${match.id}, ${match.home_team.id}, ${isFinished})"
            class="odds-btn rounded-xl p-3 flex flex-col justify-between text-left relative ${
              homeSelected ? 'odds-btn-selected' : ''
            } ${isFinished ? 'cursor-default' : ''}"
          >
            <div class="flex items-center space-x-2 w-full mb-2">
              <div 
                class="w-7 h-7 rounded-md flex items-center justify-center font-condensed font-black text-xs shadow"
                style="background-color: ${match.home_team.color}; color: ${match.home_team.text_color};"
              >
                ${match.home_team.code}
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-condensed font-black text-sm uppercase tracking-wide text-white truncate">
                  ${match.home_team.city}
                </div>
                <div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Domicile</div>
              </div>
            </div>

            <div class="w-full flex items-center justify-between pt-1.5 border-t border-[#202434]">
              <span class="text-[10px] font-bold uppercase text-slate-400">Cote</span>
              <span class="font-condensed text-base font-black ${homeSelected ? 'text-[#ff5500]' : 'text-white'}">
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
            class="odds-btn rounded-xl p-3 flex flex-col justify-between text-left relative ${
              awaySelected ? 'odds-btn-selected' : ''
            } ${isFinished ? 'cursor-default' : ''}"
          >
            <div class="flex items-center space-x-2 w-full mb-2">
              <div 
                class="w-7 h-7 rounded-md flex items-center justify-center font-condensed font-black text-xs shadow"
                style="background-color: ${match.away_team.color}; color: ${match.away_team.text_color};"
              >
                ${match.away_team.code}
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-condensed font-black text-sm uppercase tracking-wide text-white truncate">
                  ${match.away_team.city}
                </div>
                <div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Extérieur</div>
              </div>
            </div>

            <div class="w-full flex items-center justify-between pt-1.5 border-t border-[#202434]">
              <span class="text-[10px] font-bold uppercase text-slate-400">Cote</span>
              <span class="font-condensed text-base font-black ${awaySelected ? 'text-[#ff5500]' : 'text-white'}">
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
        <div class="w-6 h-6 mx-auto mb-1 rounded-full bg-slate-300 text-black font-black text-xs flex items-center justify-center">2</div>
        <div class="font-bold text-xs text-white truncate">${top2.username}</div>
        <div class="font-condensed font-black text-sm text-slate-300">${top2.total_points.toFixed(1)} <span class="text-[10px]">pts</span></div>
      ` : '<div class="text-slate-600 text-xs">-</div>'}
    </div>

    <!-- 1ère Place (Au centre, surélevé) -->
    <div class="podium-step-1 rounded-xl p-3 text-center border flex flex-col justify-end min-h-[135px]">
      ${top1 ? `
        <div class="w-7 h-7 mx-auto mb-1.5 rounded-full bg-amber-400 text-black font-black text-sm flex items-center justify-center shadow-lg shadow-amber-400/30">1</div>
        <div class="font-black text-xs text-white truncate">${top1.username}</div>
        <div class="font-condensed font-black text-base text-amber-400">${top1.total_points.toFixed(1)} <span class="text-[10px]">pts</span></div>
      ` : '<div class="text-slate-600 text-xs">-</div>'}
    </div>

    <!-- 3ème Place -->
    <div class="podium-step-3 rounded-xl p-2.5 text-center border flex flex-col justify-end min-h-[95px]">
      ${top3 ? `
        <div class="w-6 h-6 mx-auto mb-1 rounded-full bg-amber-700 text-white font-black text-xs flex items-center justify-center">3</div>
        <div class="font-bold text-xs text-white truncate">${top3.username}</div>
        <div class="font-condensed font-black text-sm text-amber-500">${top3.total_points.toFixed(1)} <span class="text-[10px]">pts</span></div>
      ` : '<div class="text-slate-600 text-xs">-</div>'}
    </div>
  `;

  // Lignes du tableau complet
  rowsContainer.innerHTML = lb.map(player => {
    const isMe = state.currentUser && state.currentUser.id === player.user_id;

    return `
      <div class="grid grid-cols-12 px-3.5 py-3 items-center text-xs transition ${
        isMe ? 'bg-[#ff5500]/10 font-bold text-white' : 'hover:bg-[#161821]'
      }">
        <div class="col-span-2 text-center font-condensed font-black text-slate-400">
          #${player.rank}
        </div>
        <div class="col-span-6 flex items-center space-x-1.5 truncate">
          <span class="truncate ${isMe ? 'text-[#ff5500]' : 'text-slate-200'}">${player.username}</span>
          ${isMe ? '<span class="text-[9px] uppercase tracking-wider bg-[#ff5500] text-black font-black px-1 rounded">Moi</span>' : ''}
        </div>
        <div class="col-span-2 text-center text-slate-400 text-[11px]">
          ${player.won_count}/${player.predictions_count}
        </div>
        <div class="col-span-2 text-right font-condensed font-black text-sm ${isMe ? 'text-[#ff5500]' : 'text-white'}">
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

function populateSeasonSelects() {
  if (!state.seasonCandidates) return;
  const { teams, mvp, dpoy, roy } = state.seasonCandidates;

  const populate = (id, items, placeholder) => {
    const el = document.getElementById(id);
    if (!el) return;
    const currentVal = el.value;
    el.innerHTML = `<option value="">${placeholder}</option>` +
      items.map(item => `<option value="${item}">${item}</option>`).join('');
    if (currentVal) el.value = currentVal;
  };

  populate('season-champion', teams, 'Sélectionne le champion NBA...');
  populate('season-cup', teams, 'Sélectionne le vainqueur de la Cup...');
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
      <div class="p-3.5 bg-gradient-to-r from-[#21160d] via-[#26190e] to-[#21160d] rounded-2xl border border-[#ff5500]/30 shadow-lg flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-[#ff5500]/15 border border-[#ff5500]/30 flex items-center justify-center text-xl shrink-0 text-[#ff5500]">
            🏆
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-condensed font-black text-sm uppercase tracking-wide text-white">Pronos d'Avant-Saison</span>
              <span class="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-[#ff5500]/20 text-[#ff5500] border border-[#ff5500]/30 font-bold">${picksCount}/5 Choix</span>
            </div>
            <p class="text-[11px] text-slate-300 leading-tight mt-0.5">
              Choisis tes 5 vainqueurs avant le coup d'envoi officiel !
            </p>
          </div>
        </div>
        <button onclick="openSeasonModal()" class="shrink-0 bg-[#ff5500] hover:bg-[#ff661a] text-black font-condensed font-black text-xs uppercase px-3 py-2 rounded-xl transition cursor-pointer shadow-md shadow-[#ff5500]/20">
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

  if (champSelect && p) champSelect.value = p.nba_champion || '';
  if (cupSelect && p) cupSelect.value = p.cup_winner || '';
  if (mvpSelect && p) mvpSelect.value = p.mvp || '';
  if (dpoySelect && p) dpoySelect.value = p.dpoy || '';
  if (roySelect && p) roySelect.value = p.roy || '';

  const selects = [champSelect, cupSelect, mvpSelect, dpoySelect, roySelect];

  if (isLocked) {
    selects.forEach(s => { if (s) s.disabled = true; });
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "🔒 Pronostics Verrouillés";
      submitBtn.className = "w-full bg-[#1b1e28] text-slate-500 font-condensed text-sm font-black uppercase tracking-wider py-2.5 rounded-xl transition cursor-not-allowed mt-2 border border-[#272d3e]";
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
      submitBtn.className = "w-full bg-[#ff5500] hover:bg-[#ff661a] text-black font-condensed text-sm font-black uppercase tracking-wider py-2.5 rounded-xl shadow-lg shadow-[#ff5500]/20 transition cursor-pointer mt-2";
    }
    if (lockAlert) {
      let deadlineStr = "";
      if (p && p.deadline) {
        const d = new Date(p.deadline);
        deadlineStr = ` avant le ${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
      }
      lockAlert.className = "mb-3 p-2.5 rounded-xl border text-xs font-semibold bg-amber-500/10 border-amber-500/30 text-amber-300";
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

// --- Rendu du Profil & Statistiques (Chantier 1) ---
async function renderProfile() {
  const container = document.getElementById('profile-content');
  if (!container) return;

  if (!state.currentUser) {
    container.innerHTML = `
      <div class="p-6 bg-[#12141a] rounded-2xl border border-[#1f222d] text-center space-y-4 shadow-xl">
        <div class="w-14 h-14 mx-auto rounded-full bg-[#ff5500]/10 border border-[#ff5500]/20 flex items-center justify-center text-2xl text-[#ff5500] shadow-lg shadow-[#ff5500]/10">
          👤
        </div>
        <div class="font-condensed font-black text-xl text-white">Connecte-toi pour voir ton profil</div>
        <p class="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
          Accède à ton Winrate en direct, analyse tes cotes validées et débloque les badges officiels.
        </p>
        <button onclick="openAuthModal('login')" class="bg-[#ff5500] hover:bg-[#ff661a] text-black font-condensed font-black text-sm uppercase px-5 py-2.5 rounded-xl transition cursor-pointer shadow-lg shadow-[#ff5500]/25">
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
      <!-- Carte Joueur -->
      <div class="p-4 bg-[#12141a] rounded-2xl border border-[#1f222d] shadow-xl flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-[#ff5500] to-[#b33c00] flex items-center justify-center font-condensed font-black text-lg text-black shadow-md shadow-[#ff5500]/20">
            ${initials}
          </div>
          <div>
            <div class="font-condensed font-black text-xl text-white leading-tight">
              ${stats.username}
            </div>
            <div class="text-[11px] text-slate-400 truncate max-w-[160px]">
              ${stats.email || 'Membre NBA Prono'}
            </div>
          </div>
        </div>

        <div class="text-right">
          <div class="text-[9px] font-bold uppercase tracking-wider text-slate-400">Classement</div>
          <div class="font-condensed font-black text-lg text-[#ff5500]">
            #${stats.rank || '-'} <span class="text-xs text-slate-400">(${stats.total_points.toFixed(1)} pts)</span>
          </div>
        </div>
      </div>

      <!-- Grille des Statistiques du Joueur -->
      <div class="grid grid-cols-3 gap-2.5">
        
        <!-- Winrate -->
        <div class="bg-[#12141a] p-3 rounded-xl border border-[#1f222d] text-center flex flex-col justify-between">
          <div class="text-[9px] font-bold uppercase tracking-wider text-slate-400">Winrate</div>
          <div class="font-condensed font-black text-2xl ${winrateColor} my-0.5">
            ${stats.winrate.toFixed(1)}%
          </div>
          <div class="text-[10px] text-slate-500 font-semibold">
            ${stats.won_predictions}/${stats.finished_predictions} validés
          </div>
        </div>

        <!-- Cote moyenne trouvée -->
        <div class="bg-[#12141a] p-3 rounded-xl border border-[#1f222d] text-center flex flex-col justify-between">
          <div class="text-[9px] font-bold uppercase tracking-wider text-slate-400">Cote Moyenne</div>
          <div class="font-condensed font-black text-2xl text-white my-0.5">
            ${stats.avg_odds > 0 ? stats.avg_odds.toFixed(2) : '-'}
          </div>
          <div class="text-[10px] text-slate-500 font-semibold">
            sur victoires
          </div>
        </div>

        <!-- Plus grosse cote -->
        <div class="bg-[#12141a] p-3 rounded-xl border border-[#1f222d] text-center flex flex-col justify-between">
          <div class="text-[9px] font-bold uppercase tracking-wider text-slate-400">Max Cote</div>
          <div class="font-condensed font-black text-2xl text-[#ff5500] my-0.5">
            ${stats.max_odds > 0 ? stats.max_odds.toFixed(2) : '-'}
          </div>
          <div class="text-[10px] text-slate-500 font-semibold">
            record validé
          </div>
        </div>

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

      <!-- Section Badges & Trophées -->
      <div class="space-y-3 pt-2">
        <div class="flex items-center justify-between">
          <h3 class="font-condensed font-black text-lg uppercase tracking-tight text-white flex items-center gap-1.5">
            <span>Badges & Trophées</span>
            <span class="text-xs text-slate-400 font-sans font-medium">(${stats.badges.filter(b => b.unlocked).length}/${stats.badges.length})</span>
          </h3>
        </div>

        <div class="space-y-2.5">
          ${stats.badges.map(badge => `
            <div class="badge-card ${badge.unlocked ? 'unlocked' : 'locked'} p-3.5 space-y-2.5">
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
                  class="h-full transition-all duration-500 ${badge.unlocked ? 'bg-gradient-to-r from-[#ff5500] to-emerald-400' : 'bg-[#ff5500]'}" 
                  style="width: ${badge.progress_pct}%"
                ></div>
              </div>

            </div>
          `).join('')}
        </div>
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
    title: 'NBA PRONO - Rejoins la ligue !',
    text: 'Viens pronostiquer les matchs NBA avec nous en 1-clic ! Qui aura le meilleur classement ?',
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

// Export pour handlers HTML inline
window.openSeasonModal = openSeasonModal;
window.closeSeasonModal = closeSeasonModal;

