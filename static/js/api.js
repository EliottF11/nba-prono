/**
 * Client API pour l'application NBA Prono
 * Gère les requêtes HTTP, l'authentification par token JWT/Bearer, et le stockage local.
 */
const API = {
  baseUrl: '',

  getToken() {
    return localStorage.getItem('nba_prono_token');
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('nba_prono_token', token);
    } else {
      localStorage.removeItem('nba_prono_token');
    }
  },

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  },

  async request(endpoint, options = {}) {
    const config = {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...(options.headers || {})
      }
    };

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Une erreur est survenue.');
      }
      return data;
    } catch (error) {
      console.error(`Erreur API (${endpoint}):`, error);
      throw error;
    }
  },

  // --- Authentification ---
  async register(username, email, password) {
    const data = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password })
    });
    this.setToken(data.access_token);
    return data;
  },

  async login(username, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    this.setToken(data.access_token);
    return data;
  },

  async getMe() {
    if (!this.getToken()) return null;
    return await this.request('/api/auth/me');
  },

  async getMyStats() {
    if (!this.getToken()) return null;
    return await this.request('/api/users/me/stats');
  },

  logout() {
    this.setToken(null);
  },

  // --- Matchs & Pronostics ---
  async getMatches(statusFilter = null, week = null) {
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== 'all') params.append('status_filter', statusFilter);
    if (week && week !== 'all') params.append('week', week);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return await this.request(`/api/matches${qs}`);
  },

  async getWeeks() {
    return await this.request('/api/weeks');
  },

  async toggleBoost(matchId) {
    return await this.request(`/api/predictions/${matchId}/boost`, {
      method: 'POST'
    });
  },

  async getMyPredictions() {
    if (!this.getToken()) return [];
    return await this.request('/api/predictions/me');
  },

  async makePrediction(matchId, selectedTeamId) {
    return await this.request('/api/predictions', {
      method: 'POST',
      body: JSON.stringify({
        match_id: matchId,
        selected_team_id: selectedTeamId
      })
    });
  },

  // --- Classement ---
  async getLeaderboard() {
    return await this.request('/api/leaderboard');
  },

  // --- Pronostics d'Avant-Saison (Chantier 3) ---
  async getSeasonCandidates() {
    return await this.request('/api/season/candidates');
  },

  async getSeasonPrediction() {
    if (!this.getToken()) return null;
    return await this.request('/api/season/predictions');
  },

  async saveSeasonPrediction(data) {
    return await this.request('/api/season/predictions', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // --- Pronostics Hebdomadaires - Joueurs de la Semaine (Chantier 4) ---
  async getWeeklyCandidates() {
    return await this.request('/api/weekly-players/candidates');
  },

  async getWeeklyPlayerPrediction(week) {
    if (!this.getToken()) return null;
    return await this.request(`/api/weekly-players/${week}`);
  },

  async saveWeeklyPlayerPrediction(week, eastPlayer, westPlayer) {
    return await this.request('/api/weekly-players', {
      method: 'POST',
      body: JSON.stringify({
        week_number: parseInt(week),
        east_player: eastPlayer,
        west_player: westPlayer
      })
    });
  },

  // --- Ligues Privées (Chantier 5) ---
  async createLeague(name) {
    return await this.request('/api/leagues', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
  },

  async joinLeague(code) {
    return await this.request('/api/leagues/join', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
  },

  async getMyLeagues() {
    if (!this.getToken()) return [];
    return await this.request('/api/leagues/my');
  },

  async getLeagueDetail(leagueId) {
    return await this.request(`/api/leagues/${leagueId}`);
  },

  async leaveLeague(leagueId) {
    return await this.request(`/api/leagues/${leagueId}/leave`, {
      method: 'POST'
    });
  },

  // --- Améliorations MPP : Transparence des votes & Mur de chambrage ---
  async getLeagueMatchVotes(leagueId, matchId) {
    return await this.request(`/api/leagues/${leagueId}/matches/${matchId}/predictions`);
  },

  async getLeagueMessages(leagueId) {
    return await this.request(`/api/leagues/${leagueId}/messages`);
  },

  async sendLeagueMessage(leagueId, content) {
    return await this.request(`/api/leagues/${leagueId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content })
    });
  },

  async getMyWrapped(period = 'weekly') {
    return await this.request(`/api/users/me/wrapped?period=${period}`);
  }
};

