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
from schemas import UserRegister, UserLogin, UserResponse, TokenResponse
from auth import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["Authentification"])

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(user_data: UserRegister, db: Session = Depends(get_db)):
    """
    Inscription d'un nouveau joueur :
    - Vérifie l'unicité du pseudo
    - Hache le mot de passe de façon sécurisée
    - Crée le compte et renvoie un jeton d'accès immédiat
    """
    clean_username = user_data.username.strip()
    if len(clean_username) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le pseudo doit contenir au moins 3 caractères."
        )

    # Vérification d'existence
    existing_user = db.query(User).filter(User.username.ilike(clean_username)).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Le pseudo '{clean_username}' est déjà pris."
        )

    # Création du nouvel utilisateur
    new_user = User(
        username=clean_username,
        hashed_password=hash_password(user_data.password),
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
    - Valide les identifiants
    - Renvoie le jeton d'accès et les infos du joueur
    """
    clean_username = credentials.username.strip()
    user = db.query(User).filter(User.username.ilike(clean_username)).first()
    
    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Pseudo ou mot de passe incorrect."
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
