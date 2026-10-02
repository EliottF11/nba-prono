"""
Routeur FastAPI pour l'authentification :
- Inscription (création de compte)
- Connexion (génération du token de session)
- Profil de l'utilisateur connecté (/me)
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models import User
from schemas import UserRegister, UserLogin, UserResponse, TokenResponse, AvatarUpdateRequest
from auth import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["Authentification"])

AVAILABLE_AVATARS = [
    {
        "id": "wembanyama_spurs",
        "title": "Victor Wembanyama",
        "meme": "L'Alien français de San Antonio 👽🏀",
        "url": "/static/avatars/wembanyama_spurs.jpg"
    },
    {
        "id": "curry_warriors",
        "title": "Stephen Curry",
        "meme": "Chef Curry : le sniper légendaire 👨‍🍳🎯",
        "url": "/static/avatars/curry_warriors.jpg"
    },
    {
        "id": "doncic_lakers",
        "title": "Luka Magic Gold",
        "meme": "Le maestro en tenue dorée 🪄🟡",
        "url": "/static/avatars/doncic_lakers.jpg"
    },
    {
        "id": "jokic_nuggets",
        "title": "Nikola Jokic",
        "meme": "Le Joker impassible & génial 🃏🏔️",
        "url": "/static/avatars/jokic_nuggets.jpg"
    },
    {
        "id": "giannis_bucks",
        "title": "Giannis Antetokounmpo",
        "meme": "Greek Freak en mission destruction 🦌⚡",
        "url": "/static/avatars/giannis_bucks.jpg"
    },
    {
        "id": "shai_thunder",
        "title": "Shai Gilgeous-Alexander",
        "meme": "Le sang-froid d'OKC & MVP mode ⚡🧊",
        "url": "/static/avatars/shai_thunder.jpg"
    },
    {
        "id": "edwards_wolves",
        "title": "Anthony Edwards",
        "meme": "Ant-Man : posters & sourires ravageurs 🐺🔥",
        "url": "/static/avatars/edwards_wolves.jpg"
    },
    {
        "id": "brunson_knicks",
        "title": "Jalen Brunson",
        "meme": "Le patron du Madison Square Garden 🗽🔥",
        "url": "/static/avatars/brunson_knicks.jpg"
    },
    {
        "id": "durant_rockets",
        "title": "Kevin Durant",
        "meme": "Le sniper létal à toute distance 🚀🎯",
        "url": "/static/avatars/durant_rockets.jpg"
    },
    {
        "id": "booker_suns",
        "title": "Devin Booker",
        "meme": "Be Legendary dans la Valley 🏜️🔥",
        "url": "/static/avatars/booker_suns.jpg"
    },
    {
        "id": "lillard_bucks",
        "title": "Damian Lillard",
        "meme": "Dame Time : sang glacé dans les veines ⌚❄️",
        "url": "/static/avatars/lillard_bucks.jpg"
    },
    {
        "id": "young_hawks",
        "title": "Trae Young",
        "meme": "Ice Trae : le vilain adoré d'Atlanta 🥶🏹",
        "url": "/static/avatars/young_hawks.jpg"
    },
    {
        "id": "haliburton_pacers",
        "title": "Tyrese Haliburton",
        "meme": "Hali Time & Passes aveugles 🏎️✨",
        "url": "/static/avatars/haliburton_pacers.jpg"
    },
    {
        "id": "banchero_magic",
        "title": "Paolo Banchero",
        "meme": "La puissance d'Orlando 🪄🏰",
        "url": "/static/avatars/banchero_magic.jpg"
    },
    {
        "id": "cunningham_pistons",
        "title": "Cade Cunningham",
        "meme": "Le maestro de Motor City 🚗🎯",
        "url": "/static/avatars/cunningham_pistons.jpg"
    },
    {
        "id": "barnes_raptors",
        "title": "Scottie Barnes",
        "meme": "L'énergie contagieuse de Toronto 🦖😁",
        "url": "/static/avatars/barnes_raptors.jpg"
    },
    {
        "id": "zion_pelicans",
        "title": "Zion Williamson",
        "meme": "Force brute & Grand sourire ⚜️💥",
        "url": "/static/avatars/zion_pelicans.jpg"
    },
    {
        "id": "garland_cavs",
        "title": "Darius Garland",
        "meme": "Le meneur soyeux des Cavs 🎯⚔️",
        "url": "/static/avatars/garland_cavs.jpg"
    },
    {
        "id": "edey_grizzlies",
        "title": "Zach Edey",
        "meme": "La tour de contrôle impériale 🐻🧱",
        "url": "/static/avatars/edey_grizzlies.jpg"
    },
    {
        "id": "podziemski_warriors",
        "title": "Brandin Podziemski",
        "meme": "L'énergie pure de la Baie 🌉⚡",
        "url": "/static/avatars/podziemski_warriors.jpg"
    },
    {
        "id": "randle_wolves",
        "title": "Julius Randle",
        "meme": "Le taureau du Minnesota 🐺💪",
        "url": "/static/avatars/randle_wolves.jpg"
    },
    {
        "id": "george_jazz",
        "title": "Keyonte George",
        "meme": "Le dynamiteur de Salt Lake City 🎷⚡",
        "url": "/static/avatars/george_jazz.jpg"
    },
    {
        "id": "wallace_hawks",
        "title": "Keaton Wallace",
        "meme": "Le grand sourire d'Atlanta 🦅😁",
        "url": "/static/avatars/wallace_hawks.jpg"
    },
    {
        "id": "hornets_smile",
        "title": "Buzz City Smile",
        "meme": "Bonne humeur à Charlotte 🐝✨",
        "url": "/static/avatars/hornets_smile.jpg"
    },
    {
        "id": "kings_smile",
        "title": "Sacramento Spark",
        "meme": "Light the Beam & Garde le sourire 👑🟣",
        "url": "/static/avatars/kings_smile.jpg"
    }
]

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(user_data: UserRegister, db: Session = Depends(get_db)):
    """
    Inscription d'un nouveau joueur :
    - Vérifie l'unicité du pseudo
    - Hache le mot de passe de façon sécurisée
    - Crée le compte et renvoie un jeton d'accès immédiat
    """
    clean_username = user_data.username.strip()
    clean_email = user_data.email.strip().lower()

    if len(clean_username) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le pseudo doit contenir au moins 3 caractères."
        )

    if "@" not in clean_email or "." not in clean_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Veuillez renseigner une adresse email valide."
        )

    # Vérification d'existence du pseudo
    existing_user = db.query(User).filter(User.username.ilike(clean_username)).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Le pseudo '{clean_username}' est déjà pris."
        )

    # Vérification d'existence de l'email
    existing_email = db.query(User).filter(User.email.ilike(clean_email)).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cette adresse email est déjà associée à un compte."
        )

    # Création du nouvel utilisateur avec son avatar de départ (optionnel)
    chosen_avatar = user_data.avatar_url
    if chosen_avatar:
        valid_urls = [a["url"] for a in AVAILABLE_AVATARS]
        if chosen_avatar not in valid_urls:
            chosen_avatar = valid_urls[0] if valid_urls else None

    new_user = User(
        username=clean_username,
        email=clean_email,
        hashed_password=hash_password(user_data.password),
        avatar_url=chosen_avatar,
        total_points=0.0
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Génération du token
    token = create_access_token(user_id=new_user.id, username=new_user.username)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": new_user
    }

@router.post("/login", response_model=TokenResponse)
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    """
    Connexion d'un joueur existant :
    - Accepte soit son pseudo, soit son adresse email
    - Valide les identifiants
    - Renvoie le jeton d'accès et les infos du joueur
    """
    clean_identifier = credentials.username.strip()
    # Recherche par pseudo OU par email
    user = db.query(User).filter(
        (User.username.ilike(clean_identifier)) | (User.email.ilike(clean_identifier))
    ).first()
    
    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiant ou mot de passe incorrect."
        )

    token = create_access_token(user_id=user.id, username=user.username)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """
    Récupère les informations du joueur actuellement connecté via son jeton Bearer.
    """
    return current_user

@router.get("/avatars")
def get_avatars():
    """
    Retourne la liste des avatars Memes NBA cultes disponibles.
    """
    return AVAILABLE_AVATARS

@router.put("/avatar", response_model=UserResponse)
def update_avatar(
    payload: AvatarUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Met à jour l'avatar du joueur connecté.
    """
    current_user.avatar_url = payload.avatar_url
    db.commit()
    db.refresh(current_user)
    return current_user

