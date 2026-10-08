from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, UniqueConstraint, Boolean
from sqlalchemy.orm import relationship
from database import Base

def utcnow():
    return datetime.now(timezone.utc)

class Team(Base):
    """
    Modèle d'équipe NBA.
    Conforme aux règles de droits : uniquement le nom de la ville et une couleur représentative.
    Aucun logo officiel n'est utilisé.
    """
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    city = Column(String(50), unique=True, nullable=False)      # Ex: "Minnesota", "Boston", "Golden State"
    code = Column(String(5), unique=True, nullable=False)       # Ex: "MIN", "BOS", "GSW"
    color = Column(String(10), nullable=False)                  # Couleur principale unie, ex: "#0C2340"
    text_color = Column(String(10), default="#FFFFFF")          # Couleur de texte pour contraste lisible

    def __repr__(self):
        return f"<Team {self.city} ({self.code})>"

class Player(Base):
    """
    Modèle de joueur NBA pour les effectifs (synchronisé via API).
    """
    __tablename__ = "players"

    id = Column(Integer, primary_key=True, index=True)
    api_id = Column(Integer, unique=True, index=True, nullable=True) # ID API-Sports
    name = Column(String(100), nullable=False)
    team_id = Column(Integer, ForeignKey("teams.id"))
    
    team = relationship("Team")

    def __repr__(self):
        return f"<Player {self.name}>"


class User(Base):
    """
    Modèle d'utilisateur/joueur.
    Stocke les identifiants et le score cumulé pour le classement en direct.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(120), unique=True, index=True, nullable=True)
    hashed_password = Column(String(255), nullable=False)
    total_points = Column(Float, default=0.0, nullable=False)
    avatar_url = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    predictions = relationship("Prediction", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User {self.username} ({self.total_points} pts)>"


class Match(Base):
    """
    Modèle de match hebdomadaire avec cotes fictives et heure limite de pronostic.
    """
    __tablename__ = "matches"

    id = Column(Integer, primary_key=True, index=True)
    home_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    away_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    home_odds = Column(Float, nullable=False)                   # Ex: 1.45
    away_odds = Column(Float, nullable=False)                   # Ex: 2.75
    deadline = Column(DateTime, nullable=False)                 # Heure limite pour pronostiquer
    status = Column(String(20), default="upcoming", nullable=False) # "upcoming", "live", "finished"
    season_stage = Column(String(50), default="regular", nullable=False) # "preseason", "regular", "playin", "playoffs"
    winner_team_id = Column(Integer, ForeignKey("teams.id"), nullable=True) # Renseigné quand terminé
    home_score = Column(Integer, nullable=True)                 # Score final domicile (ex: 112)
    away_score = Column(Integer, nullable=True)                 # Score final extérieur (ex: 108)
    week_number = Column(Integer, default=1, index=True, nullable=False) # Semaine NBA (Week 1, Week 2...)

    # Relations
    home_team = relationship("Team", foreign_keys=[home_team_id])
    away_team = relationship("Team", foreign_keys=[away_team_id])
    winner_team = relationship("Team", foreign_keys=[winner_team_id])
    predictions = relationship("Prediction", back_populates="match", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Match {self.home_team_id} vs {self.away_team_id} (W{self.week_number} - Status: {self.status})>"


class Prediction(Base):
    """
    Modèle de pronostic d'un joueur sur un match précis.
    Contrainte d'unicité : 1 seul pronostic par utilisateur et par match (modifiable avant la deadline).
    """
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    match_id = Column(Integer, ForeignKey("matches.id"), nullable=False)
    selected_team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    points_won = Column(Float, default=0.0, nullable=False)
    is_boosted = Column(Boolean, default=False, nullable=False)   # Bonus x2 activé (max 1 par semaine)
    applied_bonus = Column(String(20), nullable=True)             # Nouveau : 'DOUBLE', 'SHIELD', 'ALL_IN', 'UPSET'
    created_at = Column(DateTime, default=utcnow, nullable=False)

    # Relations
    user = relationship("User", back_populates="predictions")
    match = relationship("Match", back_populates="predictions")
    selected_team = relationship("Team")

    __table_args__ = (
        UniqueConstraint("user_id", "match_id", name="uq_user_match_prediction"),
    )

    def __repr__(self):
        return f"<Prediction User {self.user_id} Match {self.match_id} -> Team {self.selected_team_id}>"


class SeasonPrediction(Base):
    """
    Modèle des pronostics d'avant-saison (Chantier 3).
    5 choix définitifs par joueur, verrouillés dès le coup d'envoi du premier match :
    - Champion NBA (ex: Minnesota)
    - Vainqueur du NBA In-Season Tournament (NBA Cup)
    - MVP de la saison régulière (ex: Anthony Edwards)
    - DPOY (Défenseur de l'année)
    - ROY (Rookie de l'année)
    """
    __tablename__ = "season_predictions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    nba_champion = Column(String(100), nullable=True)
    cup_winner = Column(String(100), nullable=True)
    mvp = Column(String(100), nullable=False)
    dpoy = Column(String(100), nullable=False)
    roy = Column(String(100), nullable=False)
    sixth_man = Column(String(100), nullable=True)
    mip = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    user = relationship("User", backref="season_prediction")

    def __repr__(self):
        return f"<SeasonPrediction User {self.user_id}: Champ={self.nba_champion}, MVP={self.mvp}>"


class WeeklyPlayerPrediction(Base):
    """
    Modèle des pronostics hebdomadaires (Chantier 4).
    2 joueurs clés obligatoires par semaine avant de valider ses matchs :
    - Joueur de la semaine - Conférence Est
    - Joueur de la semaine - Conférence Ouest
    """
    __tablename__ = "weekly_player_predictions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    week_number = Column(Integer, nullable=False, index=True)
    east_player = Column(String(100), nullable=False)
    west_player = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    user = relationship("User", backref="weekly_player_predictions")

    __table_args__ = (
        UniqueConstraint("user_id", "week_number", name="uq_user_week_player_prediction"),
    )

    def __repr__(self):
        return f"<WeeklyPlayerPrediction User {self.user_id} W{self.week_number}: East={self.east_player}, West={self.west_player}>"


class League(Base):
    """
    Modèle de ligue privée (Chantier 5).
    Chaque ligue possède un code d'invitation unique à 6 caractères (ex: 'NBA7X9').
    """
    __tablename__ = "leagues"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    code = Column(String(6), unique=True, index=True, nullable=False)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    creator = relationship("User", foreign_keys=[creator_id])
    members = relationship("LeagueMember", back_populates="league", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<League {self.name} ({self.code})>"


class LeagueMember(Base):
    """
    Membre d'une ligue privée.
    Associe un utilisateur à une ligue.
    """
    __tablename__ = "league_members"

    id = Column(Integer, primary_key=True, index=True)
    league_id = Column(Integer, ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    joined_at = Column(DateTime, default=utcnow, nullable=False)

    league = relationship("League", back_populates="members")
    user = relationship("User", backref="league_memberships")

    __table_args__ = (
        UniqueConstraint("league_id", "user_id", name="uq_league_member"),
    )

    def __repr__(self):
        return f"<LeagueMember User {self.user_id} in League {self.league_id}>"


class LeagueMessage(Base):
    """
    Message sur le mur de chambrage (mini-chat) d'une ligue privée (Style MPP).
    """
    __tablename__ = "league_messages"

    id = Column(Integer, primary_key=True, index=True)
    league_id = Column(Integer, ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(String(280), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    league = relationship("League", backref="messages")
    user = relationship("User")

    def __repr__(self):
        return f"<LeagueMessage User {self.user_id} in League {self.league_id}: {self.content[:20]}>"


class PropBet(Base):
    """
    Modèle d'un pari sur la performance individuelle d'un joueur (Prop Bet).
    Ex: LeBron James, Over/Under 25.5 points.
    """
    __tablename__ = "prop_bets"

    id = Column(Integer, primary_key=True, index=True)
    match_id = Column(Integer, ForeignKey("matches.id"), nullable=False, index=True)
    player_name = Column(String(100), nullable=False)
    stat_type = Column(String(50), nullable=False)                 # ex: 'points', 'rebounds', 'assists'
    line = Column(Float, nullable=False)                           # ex: 25.5
    status = Column(String(20), default="pending", nullable=False) # 'pending', 'resolved', 'canceled'
    actual_result = Column(Float, nullable=True)                   # Score réel obtenu (ex: 28)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    
    # Relations
    match = relationship("Match", backref="prop_bets")
    predictions = relationship("PropPrediction", back_populates="prop_bet", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<PropBet {self.player_name} O/U {self.line} {self.stat_type}>"


class PropPrediction(Base):
    """
    Choix d'un utilisateur sur un Prop Bet ('over' ou 'under').
    """
    __tablename__ = "prop_predictions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    prop_id = Column(Integer, ForeignKey("prop_bets.id"), nullable=False, index=True)
    choice = Column(String(10), nullable=False)                    # 'over' ou 'under'
    is_correct = Column(Boolean, nullable=True)                    # True, False, ou Null (en attente)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    # Relations
    user = relationship("User", backref="prop_predictions")
    prop_bet = relationship("PropBet", back_populates="predictions")

    __table_args__ = (
        UniqueConstraint("user_id", "prop_id", name="uq_user_prop_prediction"),
    )

    def __repr__(self):
        return f"<PropPrediction User {self.user_id} Prop {self.prop_id} -> {self.choice}>"


class WeeklyUserBonus(Base):
    """
    Modèle des bonus hebdomadaires aléatoires (Roue des bonus).
    1 bonus max par semaine par utilisateur.
    Types : 'DOUBLE', 'SHIELD', 'ALL_IN', 'UPSET'
    """
    __tablename__ = "weekly_user_bonuses"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    week_number = Column(Integer, nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)
    bonus_type = Column(String(20), nullable=False)
    is_used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    user = relationship("User", backref="weekly_bonuses")

    __table_args__ = (
        UniqueConstraint("user_id", "week_number", "year", name="uq_user_weekly_bonus"),
    )

    def __repr__(self):
        return f"<WeeklyUserBonus User {self.user_id} W{self.week_number}/{self.year} -> {self.bonus_type}>"

class FlashBet(Base):
    """
    Modèle de pronostic flash sur un joueur (Prop Bet). Ex: 'LeBron James + de 25.5 points'.
    """
    __tablename__ = "flash_bets"

    id = Column(Integer, primary_key=True, index=True)
    player_name = Column(String(100), nullable=False)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    stat_type = Column(String(50), nullable=False)              # Ex: "Points", "Rebonds", "Passes"
    threshold = Column(Float, nullable=False)                   # Ex: 25.5
    over_odds = Column(Float, nullable=False)                   # Ex: 1.85
    under_odds = Column(Float, nullable=False)                  # Ex: 1.85
    deadline = Column(DateTime, nullable=False)
    status = Column(String(20), default="upcoming", nullable=False) # "upcoming", "finished"
    result_stat = Column(Float, nullable=True)                  # Stat réelle
    
    team = relationship("Team")

class FlashPrediction(Base):
    __tablename__ = "flash_predictions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    flash_bet_id = Column(Integer, ForeignKey("flash_bets.id"), nullable=False)
    choice = Column(String(10), nullable=False) # "over" ou "under"
    points_won = Column(Float, default=0.0, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    
    user = relationship("User")
    flash_bet = relationship("FlashBet")

    __table_args__ = (
        UniqueConstraint("user_id", "flash_bet_id", name="uq_user_flash_prediction"),
    )
