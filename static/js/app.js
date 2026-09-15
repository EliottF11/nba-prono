/**
 * NBA PRONO - Logique applicative
 * Interface sportive épurée, sélection 1-clic et classement en direct.
 */

const state = {
  currentUser: null,
  activeTab: 'matches',
  matchesFilter: 'all',
  matches: [],
  myPredictions: {}, // matchId -> selectedTeamId
  leaderboard: [],
  authMode: 'login'
};

document.addEventListener('DOMContentLoaded', async () => {
  registerServiceWorker();
  initUIEvents();
  await checkSession();
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
    updateHeaderUser();
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
    const [matches, preds, leaderboard] = await Promise.all([
      API.getMatches(),
      API.getMyPredictions(),
      API.getLeaderboard()
    ]);

    state.matches = matches;
    state.leaderboard = leaderboard;

    state.myPredictions = {};
    preds.forEach(p => {
      state.myPredictions[p.match_id] = p.selected_team_id;
    });

    const openCount = matches.filter(m => m.status === 'upcoming').length;
    const countBadge = document.getElementById('open-matches-count');
    if (countBadge) {
      countBadge.textContent = `${openCount} OUVERT${openCount > 1 ? 'S' : ''}`;
    }

    renderMatchesList();
    renderLeaderboard();
  } catch (err) {
    console.error('Erreur chargement:', err);
    notify("Erreur lors de la synchronisation des données", "error");
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
      statusPill = `<span class="text-[10px] font-bold text-slate-500">Coup d'envoi : ${dateFormatted}</span>`;
    }

    return `
      <div class="match-card rounded-xl p-3.5 space-y-3">
        
        <!-- En-tête : Date & État -->
        <div class="flex items-center justify-between text-xs pb-2 border-b border-[#1b1e28]">
          <div class="flex items-center space-x-1.5 text-slate-400 font-medium text-[11px]">
            <span class="w-1.5 h-1.5 rounded-full ${isFinished ? 'bg-slate-600' : 'bg-[#ff5500]'}"></span>
            <span>${isFinished ? 'Match terminé' : dateFormatted}</span>
          </div>
          <div>${statusPill}</div>
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
    const stats = await API.getMyStats();
    if (!stats) return;

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

