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
  }
};
