from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import secrets

from datetime import datetime, timezone
from database import get_db
from models import User, League, LeagueMember, Match, Prediction, LeagueMessage
from schemas import (
    LeagueCreate,
    LeagueJoin,
    LeagueDetailResponse,
    LeagueSummaryResponse,
    LeagueMemberResponse,
    LeagueMatchVotesResponse,
    LeagueMemberVoteResponse,
    LeagueMessageCreate,
    LeagueMessageResponse
)
from auth import get_current_user

router = APIRouter(prefix="/api/leagues", tags=["Leagues"])

# Caractères clairs et lisibles pour les codes d'invitation à 6 caractères (sans confusion O/0 ou I/1)
LEAGUE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_unique_league_code(db: Session) -> str:
    """Génère un code d'invitation unique à 6 caractères alphanumériques."""
    for _ in range(100):
        code = "".join(secrets.choice(LEAGUE_CODE_CHARS) for _ in range(6))
        if not db.query(League).filter(League.code == code).first():
            return code
    raise HTTPException(status_code=500, detail="Impossible de générer un code de ligue unique.")


def build_league_detail(league: League, current_user: User) -> LeagueDetailResponse:
    """Construit la réponse détaillée d'une ligue avec son classement interne ordonné."""
    # Récupérer tous les membres avec leurs utilisateurs triés par total_points décroissant
    members_data = []
    for m in league.members:
        u = m.user
        preds = u.predictions
        won_count = sum(1 for p in preds if p.points_won > 0)
        members_data.append({
            "member": m,
            "user": u,
            "points": u.total_points,
            "preds_count": len(preds),
            "won_count": won_count
        })

    # Tri par points décroissants, puis par id de membre (ordre d'adhésion)
    members_data.sort(key=lambda x: (x["points"], -x["member"].id), reverse=True)

    ranked_members: List[LeagueMemberResponse] = []
    user_rank = None

    for rank_idx, item in enumerate(members_data, start=1):
        u = item["user"]
        m = item["member"]
        if u.id == current_user.id:
            user_rank = rank_idx

        ranked_members.append(LeagueMemberResponse(
            user_id=u.id,
            username=u.username,
            total_points=u.total_points,
            rank=rank_idx,
            joined_at=m.joined_at,
            is_creator=(u.id == league.creator_id),
            predictions_count=item["preds_count"],
            won_count=item["won_count"]
        ))

    return LeagueDetailResponse(
        id=league.id,
        name=league.name,
        code=league.code,
        creator_id=league.creator_id,
        creator_username=league.creator.username if league.creator else "Inconnu",
        created_at=league.created_at,
        members_count=len(ranked_members),
        user_rank=user_rank,
        members=ranked_members
    )


@router.post("", response_model=LeagueDetailResponse, status_code=status.HTTP_201_CREATED)
def create_league(
    payload: LeagueCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Crée une nouvelle ligue privée et génère un code d'invitation unique à 6 caractères.
    Le créateur est automatiquement inscrit comme premier membre.
    """
    clean_name = payload.name.strip()
    if len(clean_name) < 3:
        raise HTTPException(status_code=400, detail="Le nom de la ligue doit comporter au moins 3 caractères.")

    code = generate_unique_league_code(db)

    new_league = League(
        name=clean_name,
        code=code,
        creator_id=current_user.id
    )
    db.add(new_league)
    db.flush()

    # Inscrire automatiquement le créateur
    membership = LeagueMember(
        league_id=new_league.id,
        user_id=current_user.id
    )
    db.add(membership)
    db.commit()
    db.refresh(new_league)

    return build_league_detail(new_league, current_user)


@router.post("/join", response_model=LeagueDetailResponse)
def join_league(
    payload: LeagueJoin,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Rejoint une ligue privée existante à l'aide de son code d'invitation à 6 caractères.
    """
    clean_code = payload.code.strip().upper()
    if len(clean_code) != 6:
        raise HTTPException(status_code=400, detail="Le code de ligue doit comporter exactement 6 caractères.")

    league = db.query(League).filter(League.code == clean_code).first()
    if not league:
        raise HTTPException(status_code=404, detail="Aucune ligue trouvée avec ce code d'invitation.")

    # Vérifier si l'utilisateur est déjà membre
    existing = db.query(LeagueMember).filter(
        LeagueMember.league_id == league.id,
        LeagueMember.user_id == current_user.id
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Vous êtes déjà membre de cette ligue.")

    new_member = LeagueMember(
        league_id=league.id,
        user_id=current_user.id
    )
    db.add(new_member)
    db.commit()
    db.refresh(league)

    return build_league_detail(league, current_user)


@router.get("/my", response_model=List[LeagueSummaryResponse])
def get_my_leagues(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Renvoie la liste des ligues dont l'utilisateur actuel est membre,
    avec le nombre de participants et son rang dans chacune.
    """
    memberships = db.query(LeagueMember).filter(LeagueMember.user_id == current_user.id).all()
    summaries = []

    for m in memberships:
        league = m.league
        if not league:
            continue

        # Calcul rapide du rang de l'utilisateur dans cette ligue
        all_members = league.members
        sorted_members = sorted(
            all_members,
            key=lambda x: (x.user.total_points if x.user else 0, -x.id),
            reverse=True
        )

        user_rank = None
        for idx, sm in enumerate(sorted_members, start=1):
            if sm.user_id == current_user.id:
                user_rank = idx
                break

        summaries.append(LeagueSummaryResponse(
            id=league.id,
            name=league.name,
            code=league.code,
            creator_id=league.creator_id,
            creator_username=league.creator.username if league.creator else "Inconnu",
            members_count=len(all_members),
            user_rank=user_rank,
            created_at=league.created_at
        ))

    # Tri : ligues les plus récemment rejointes en premier
    summaries.sort(key=lambda x: x.created_at, reverse=True)
    return summaries


@router.get("/{league_id}", response_model=LeagueDetailResponse)
def get_league_detail(
    league_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Renvoie les détails complets d'une ligue et son classement interne actualisé.
    L'utilisateur doit être membre de la ligue pour y accéder.
    """
    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="Ligue introuvable.")

    # Vérifier l'appartenance à la ligue
    membership = db.query(LeagueMember).filter(
        LeagueMember.league_id == league.id,
        LeagueMember.user_id == current_user.id
    ).first()

    if not membership:
        raise HTTPException(status_code=403, detail="Vous devez rejoindre cette ligue pour consulter son classement.")

    return build_league_detail(league, current_user)


@router.post("/{league_id}/leave")
def leave_league(
    league_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Permet à un membre de quitter une ligue privée.
    Si le créateur quitte et qu'il est le seul membre, la ligue est dissoute.
    """
    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="Ligue introuvable.")

    membership = db.query(LeagueMember).filter(
        LeagueMember.league_id == league.id,
        LeagueMember.user_id == current_user.id
    ).first()

    if not membership:
        raise HTTPException(status_code=400, detail="Vous n'êtes pas membre de cette ligue.")

    # Si créateur et d'autres membres existent, transférer au plus ancien membre
    if league.creator_id == current_user.id:
        other_members = [m for m in league.members if m.user_id != current_user.id]
        if other_members:
            # Transférer le créateur au membre suivant
            other_members.sort(key=lambda x: x.joined_at)
            league.creator_id = other_members[0].user_id
        else:
            # Dernier membre restant : suppression de la ligue
            db.delete(league)
            db.commit()
            return {"message": "La ligue a été dissoute car vous étiez le seul membre restant."}

    db.delete(membership)
    db.commit()
    return {"message": f"Vous avez quitté la ligue '{league.name}'."}


@router.get("/{league_id}/matches/{match_id}/predictions", response_model=LeagueMatchVotesResponse)
def get_league_match_predictions(
    league_id: int,
    match_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Transparence des pronostics en ligue privée (Signature MPP) :
    - AVANT le coup d'envoi (match à venir et deadline non dépassée) :
      Mode secret 🔒 -> On sait combien de membres ont voté (ex: 3/4 ont voté) et qui a voté,
      mais les choix d'équipes et les bonus x2 restent cachés pour préserver le suspense.
    - APRÈS le coup d'envoi (deadline passée ou match en cours/terminé) :
      Mode révélé 🔓 -> Jauge de répartition des votes en % et liste détaillée des choix de chaque membre.
    """
    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="Ligue introuvable.")

    # Vérifier l'appartenance à la ligue
    membership = db.query(LeagueMember).filter(
        LeagueMember.league_id == league.id,
        LeagueMember.user_id == current_user.id
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="Vous devez être membre de la ligue pour consulter les pronostics.")

    match = db.query(Match).filter(Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Match introuvable.")

    # Déterminer si le match a démarré
    now = datetime.now(timezone.utc)
    match_deadline = match.deadline
    if match_deadline.tzinfo is None:
        match_deadline = match_deadline.replace(tzinfo=timezone.utc)

    is_revealed = (now >= match_deadline) or (match.status in ["live", "finished"])

    # Membres de la ligue
    members = league.members
    total_members = len(members)
    member_user_ids = [m.user_id for m in members]

    # Pronostics des membres pour ce match
    preds = db.query(Prediction).filter(
        Prediction.match_id == match_id,
        Prediction.user_id.in_(member_user_ids)
    ).all()
    preds_by_user = {p.user_id: p for p in preds}
    voted_count = len(preds_by_user)

    votes: List[LeagueMemberVoteResponse] = []
    home_votes_count = 0
    away_votes_count = 0

    if not is_revealed:
        # Avant le coup d'envoi : on ne révèle pas les équipes choisies
        for m in members:
            u = m.user
            has_voted = u.id in preds_by_user
            votes.append(LeagueMemberVoteResponse(
                user_id=u.id,
                username=u.username,
                has_voted=has_voted,
                selected_team_id=None,
                selected_team_code=None,
                selected_team_city=None,
                is_boosted=False,
                points_won=0.0
            ))
        home_pct = 0.0
        away_pct = 0.0
    else:
        # Coup d'envoi sifflé : révélation complète
        for m in members:
            u = m.user
            p = preds_by_user.get(u.id)
            if p:
                team = p.selected_team
                if p.selected_team_id == match.home_team_id:
                    home_votes_count += 1
                elif p.selected_team_id == match.away_team_id:
                    away_votes_count += 1

                votes.append(LeagueMemberVoteResponse(
                    user_id=u.id,
                    username=u.username,
                    has_voted=True,
                    selected_team_id=p.selected_team_id,
                    selected_team_code=team.code if team else None,
                    selected_team_city=team.city if team else None,
                    is_boosted=p.is_boosted,
                    points_won=p.points_won
                ))
            else:
                votes.append(LeagueMemberVoteResponse(
                    user_id=u.id,
                    username=u.username,
                    has_voted=False,
                    selected_team_id=None,
                    selected_team_code=None,
                    selected_team_city=None,
                    is_boosted=False,
                    points_won=0.0
                ))

        total_revealed_votes = home_votes_count + away_votes_count
        home_pct = round((home_votes_count / total_revealed_votes * 100), 1) if total_revealed_votes > 0 else 0.0
        away_pct = round((away_votes_count / total_revealed_votes * 100), 1) if total_revealed_votes > 0 else 0.0

    return LeagueMatchVotesResponse(
        match_id=match.id,
        league_id=league.id,
        is_revealed=is_revealed,
        total_members=total_members,
        voted_count=voted_count,
        home_team_id=match.home_team_id,
        home_team_city=match.home_team.city if match.home_team else "Domicile",
        away_team_id=match.away_team_id,
        away_team_city=match.away_team.city if match.away_team else "Extérieur",
        home_votes_count=home_votes_count,
        away_votes_count=away_votes_count,
        home_pct=home_pct,
        away_pct=away_pct,
        votes=votes
    )


@router.get("/{league_id}/messages", response_model=List[LeagueMessageResponse])
def get_league_messages(
    league_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Récupère l'historique récent du mur de chambrage (mini-chat) de la ligue.
    """
    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="Ligue introuvable.")

    membership = db.query(LeagueMember).filter(
        LeagueMember.league_id == league.id,
        LeagueMember.user_id == current_user.id
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="Vous devez être membre de la ligue pour voir le mur de chambrage.")

    messages = (
        db.query(LeagueMessage)
        .filter(LeagueMessage.league_id == league_id)
        .order_by(LeagueMessage.created_at.asc())
        .limit(100)
        .all()
    )

    return [
        LeagueMessageResponse(
            id=m.id,
            league_id=m.league_id,
            user_id=m.user_id,
            username=m.user.username if m.user else "Anonyme",
            content=m.content,
            created_at=m.created_at,
            is_me=(m.user_id == current_user.id)
        )
        for m in messages
    ]


@router.post("/{league_id}/messages", response_model=LeagueMessageResponse, status_code=status.HTTP_201_CREATED)
def post_league_message(
    league_id: int,
    payload: LeagueMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Poste un nouveau message sur le mur de chambrage de la ligue.
    """
    clean_content = payload.content.strip()
    if not clean_content:
        raise HTTPException(status_code=400, detail="Le message ne peut pas être vide.")

    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="Ligue introuvable.")

    membership = db.query(LeagueMember).filter(
        LeagueMember.league_id == league.id,
        LeagueMember.user_id == current_user.id
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="Vous devez être membre de la ligue pour écrire sur le mur.")

    msg = LeagueMessage(
        league_id=league_id,
        user_id=current_user.id,
        content=clean_content
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    return LeagueMessageResponse(
        id=msg.id,
        league_id=msg.league_id,
        user_id=msg.user_id,
        username=current_user.username,
        content=msg.content,
        created_at=msg.created_at,
        is_me=True
    )
