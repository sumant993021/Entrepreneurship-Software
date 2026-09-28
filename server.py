import os
import json
import uuid
import secrets
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import create_engine, Column, String, Text, Integer, Float, ForeignKey, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker, Session
import hashlib

# ----------------- Database Setup -----------------
# In serverless environments like Vercel, the filesystem is read-only except /tmp
DB_DIR = "/tmp" if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME") else os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(DB_DIR, "edmg_project.db")
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DB_FILE}")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Password hashing
def hash_password(password: str) -> str:
    salt = "EDMG_SALT_2026"
    return hashlib.sha256((salt + password).encode("utf-8")).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return hash_password(plain_password) == hashed_password

# ----------------- Models -----------------
class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="student", nullable=False) # 'student' or 'faculty'
    
    # Student specific fields
    department = Column(String, default="ECS", nullable=True) # 'ECS' or 'Instrumentation'
    student_class = Column(String, default="Third Year", nullable=True) # e.g. 'Third Year', 'Final Year'
    division = Column(String, default="Div A", nullable=True) # 'Div A', 'Div B'
    batch = Column(String, default="Batch 1", nullable=True) # e.g. 'Batch 1', 'Batch 2', 'Batch 3', 'Batch 4'
    
    # Faculty specific assignments: JSON list of dicts
    # e.g. [{"department": "ECS", "student_class": "Third Year", "division": "Div A", "batches": ["Batch 1", "Batch 2"]}, ...]
    faculty_assignments_json = Column(Text, default="[]", nullable=True)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class Group(Base):
    __tablename__ = "groups"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    invite_code = Column(String, unique=True, index=True, nullable=False)
    
    department = Column(String, nullable=False) # 'ECS' or 'Instrumentation'
    student_class = Column(String, default="Third Year", nullable=False)
    division = Column(String, nullable=False) # 'Div A', 'Div B', 'Div 1'
    batch = Column(String, nullable=False) # 'Batch 1', 'Batch 2', etc.

    member_names_json = Column(Text, default="[]", nullable=False)
    member_user_ids_json = Column(Text, default="[]", nullable=False)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    
    # 5 Structured Steps
    step1_problem_statement = Column(Text, default="", nullable=False)
    step2_market_research = Column(Text, default="", nullable=False)
    step3_innovative_solution = Column(Text, default="", nullable=False)
    step4_feasibility_business_model = Column(Text, default="", nullable=False)
    step5_marketing_presentation = Column(Text, default="", nullable=False)

    # Step Verification & Faculty Approval Statuses ('pending', 'approved', 'rejected')
    step1_status = Column(String, default="pending", nullable=False)
    step2_status = Column(String, default="pending", nullable=False)
    step3_status = Column(String, default="pending", nullable=False)
    step4_status = Column(String, default="pending", nullable=False)
    step5_status = Column(String, default="pending", nullable=False)

    # Step-specific Faculty Feedback & Remarks
    step1_remarks = Column(Text, default="", nullable=False)
    step2_remarks = Column(Text, default="", nullable=False)
    step3_remarks = Column(Text, default="", nullable=False)
    step4_remarks = Column(Text, default="", nullable=False)
    step5_remarks = Column(Text, default="", nullable=False)

    # ₹1,00,000 Budget Planner (JSON list of expense items: [{"category", "item", "cost", "notes"}])
    budget_items_json = Column(Text, default="[]", nullable=False)

    # Pitch Strategy Framework (JSON object: {"elevator_pitch", "target_audience", "competitive_advantage", "revenue_stream", "pitch_deck_url"})
    pitch_strategy_json = Column(Text, default="{}", nullable=False)

    # 12-Point Real-Time Curriculum Hubs:
    # Digital Promotion & Acquisition Lab (JSON object: MarTech tools, content calendar, SEO, social channels, paid ads)
    digital_marketing_json = Column(Text, default="{}", nullable=False)

    # Analytics & Professional Employability Portfolio (JSON object: web analytics, team roles, portfolio export)
    employability_portfolio_json = Column(Text, default="{}", nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class Score(Base):
    __tablename__ = "scores"
    id = Column(String, primary_key=True, index=True)
    group_id = Column(String, ForeignKey("groups.id"), unique=True, nullable=False)
    innovation = Column(Integer, default=0, nullable=False)    # 0-15
    feasibility = Column(Integer, default=0, nullable=False)   # 0-10
    solution = Column(Integer, default=0, nullable=False)      # 0-15
    presentation = Column(Integer, default=0, nullable=False)  # 0-10
    total = Column(Integer, default=0, nullable=False)         # 0-50
    remarks = Column(Text, default="", nullable=False)
    scored_by = Column(String, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class MarketingVisit(Base):
    __tablename__ = "marketing_visits"
    id = Column(String, primary_key=True, index=True)
    group_id = Column(String, ForeignKey("groups.id"), nullable=False, index=True)
    channel = Column(String, nullable=False, index=True) # 'whatsapp', 'telegram', 'linkedin', 'direct'
    visitor_id = Column(String, nullable=False, index=True) # visitor unique hash / cookie
    user_agent = Column(String, default="")
    ip_address = Column(String, default="")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

Base.metadata.create_all(bind=engine)

# Helper to automatically ensure new columns exist in existing SQLite databases
def run_sqlite_migrations():
    with engine.connect() as conn:
        from sqlalchemy import text
        cursor = conn.connection.cursor()
        cursor.execute("PRAGMA table_info(groups)")
        columns = [row[1] for row in cursor.fetchall()]
        
        new_cols = [
            ("step1_status", "TEXT DEFAULT 'pending'"),
            ("step2_status", "TEXT DEFAULT 'pending'"),
            ("step3_status", "TEXT DEFAULT 'pending'"),
            ("step4_status", "TEXT DEFAULT 'pending'"),
            ("step5_status", "TEXT DEFAULT 'pending'"),
            ("step1_remarks", "TEXT DEFAULT ''"),
            ("step2_remarks", "TEXT DEFAULT ''"),
            ("step3_remarks", "TEXT DEFAULT ''"),
            ("step4_remarks", "TEXT DEFAULT ''"),
            ("step5_remarks", "TEXT DEFAULT ''"),
            ("budget_items_json", "TEXT DEFAULT '[]'"),
            ("pitch_strategy_json", "TEXT DEFAULT '{}'"),
            ("digital_marketing_json", "TEXT DEFAULT '{}'"),
            ("employability_portfolio_json", "TEXT DEFAULT '{}'")
        ]
        for col_name, col_type in new_cols:
            if col_name not in columns:
                try:
                    cursor.execute(f"ALTER TABLE groups ADD COLUMN {col_name} {col_type}")
                except Exception as e:
                    print(f"Migration note for {col_name}: {e}")
        conn.connection.commit()

run_sqlite_migrations()

SESSIONS: Dict[str, Dict[str, Any]] = {}

# ----------------- WebSocket Connection Manager -----------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

# ----------------- FastAPI App -----------------
app = FastAPI(title="E&DM Group Project Manager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- Schemas -----------------
class FacultyAssignmentItem(BaseModel):
    department: str # e.g. "ECS" or "Instrumentation"
    student_class: str # e.g. "Third Year" or "Final Year"
    division: str # e.g. "Div A" or "Div B"
    batches: List[str] # e.g. ["Batch 1", "Batch 2"]

class FacultyRegisterRequest(BaseModel):
    name: str = Field(..., min_length=1)
    email: EmailStr
    password: str = Field(..., min_length=4)
    assignments: List[FacultyAssignmentItem] = Field(..., min_length=1)

class StudentRegisterRequest(BaseModel):
    name: str = Field(..., min_length=1)
    email: EmailStr
    password: str = Field(..., min_length=4)
    department: str # 'ECS' or 'Instrumentation'
    student_class: str # 'Third Year', etc.
    division: str # 'Div A', 'Div B'
    batch: str # 'Batch 1', 'Batch 2', etc.

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class PromoteRequest(BaseModel):
    target_user_id: str
    role: str # "faculty" or "student"

class CreateGroupRequest(BaseModel):
    name: str = Field(..., min_length=2)
    department: str
    student_class: str
    division: str
    batch: str
    member_names: List[str]

class JoinGroupRequest(BaseModel):
    invite_code: str

class UpdateGroupContentRequest(BaseModel):
    step1_problem_statement: Optional[str] = None
    step2_market_research: Optional[str] = None
    step3_innovative_solution: Optional[str] = None
    step4_feasibility_business_model: Optional[str] = None
    step5_marketing_presentation: Optional[str] = None
    member_names: Optional[List[str]] = None

class VerifyStepRequest(BaseModel):
    step_number: int = Field(..., ge=1, le=5)
    status: str = Field(..., pattern="^(pending|approved|rejected)$")
    remarks: Optional[str] = ""

class BudgetItemModel(BaseModel):
    category: str
    item: str
    cost: float
    notes: Optional[str] = ""

class UpdateBudgetRequest(BaseModel):
    budget_items: List[BudgetItemModel]

class UpdatePitchRequest(BaseModel):
    hook_tagline: Optional[str] = ""
    problem_urgency: Optional[str] = ""
    solution_usp: Optional[str] = ""
    target_market_tam: Optional[str] = ""
    business_model_monetization: Optional[str] = ""
    ask_budget_milestone: Optional[str] = ""
    pitch_deck_url: Optional[str] = ""

class UpdateDigitalMarketingRequest(BaseModel):
    # Points 5, 6, 7, 8, 9, 10
    funnel_tofu_interest: Optional[str] = ""
    funnel_bofu_conversion: Optional[str] = ""
    martech_tools: Optional[List[str]] = []
    landing_page_url: Optional[str] = ""
    content_calendar_json: Optional[str] = "[]"
    buyer_persona: Optional[str] = ""
    seo_meta_title: Optional[str] = ""
    seo_meta_description: Optional[str] = ""
    seo_keywords: Optional[str] = ""
    infographic_url: Optional[str] = ""
    social_linkedin_copy: Optional[str] = ""
    social_instagram_copy: Optional[str] = ""
    ad_headline: Optional[str] = ""
    ad_copy: Optional[str] = ""
    ad_target_audience: Optional[str] = ""
    ad_budget: Optional[float] = 0.0
    ad_cpc_estimate: Optional[float] = 0.0

class UpdateEmployabilityRequest(BaseModel):
    # Points 11, 12
    utm_source: Optional[str] = ""
    utm_medium: Optional[str] = ""
    utm_campaign: Optional[str] = ""
    analytics_visitors: Optional[int] = 0
    analytics_ctr: Optional[float] = 0.0
    analytics_conversions: Optional[int] = 0
    cac_cost: Optional[float] = 0.0
    team_roles_json: Optional[str] = "{}"
    executive_summary: Optional[str] = ""

class ScoreRequest(BaseModel):
    innovation: int
    feasibility: int
    solution: int
    presentation: int
    remarks: Optional[str] = ""

# ----------------- Authentication Dependencies -----------------
from fastapi import Header

def get_current_user(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid authentication token")
    token = authorization.split(" ")[1]
    session_data = SESSIONS.get(token)
    if not session_data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")
    
    user = db.query(User).filter(User.id == session_data["user_id"]).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user

def require_faculty(user: User = Depends(get_current_user)) -> User:
    if user.role != "faculty":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. Faculty privileges required.")
    return user

def user_to_dict(user: User) -> dict:
    assignments = []
    if user.faculty_assignments_json:
        try:
            assignments = json.loads(user.faculty_assignments_json)
        except Exception:
            assignments = []

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "department": user.department,
        "student_class": user.student_class,
        "division": user.division,
        "batch": user.batch,
        "assignments": assignments
    }

# ----------------- Auth Routes -----------------
@app.post("/api/auth/register-faculty")
def register_faculty(req: FacultyRegisterRequest, db: Session = Depends(get_db)):
    email_clean = req.email.strip().lower()
    existing = db.query(User).filter(User.email == email_clean).first()
    if existing:
        raise HTTPException(status_code=400, detail="Account with this email already exists")

    # Serialize assignments
    assignments_data = [item.dict() for item in req.assignments]

    user = User(
        id=str(uuid.uuid4()),
        email=email_clean,
        name=req.name.strip(),
        hashed_password=hash_password(req.password),
        role="faculty",
        faculty_assignments_json=json.dumps(assignments_data)
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = secrets.token_hex(24)
    u_dict = user_to_dict(user)
    SESSIONS[token] = {
        "user_id": user.id,
        "email": user.email,
        "role": user.role,
        "name": user.name
    }
    return {"token": token, "user": u_dict}

@app.post("/api/auth/register-student")
def register_student(req: StudentRegisterRequest, db: Session = Depends(get_db)):
    email_clean = req.email.strip().lower()
    existing = db.query(User).filter(User.email == email_clean).first()
    if existing:
        raise HTTPException(status_code=400, detail="Account with this email already exists")

    user = User(
        id=str(uuid.uuid4()),
        email=email_clean,
        name=req.name.strip(),
        hashed_password=hash_password(req.password),
        role="student",
        department=req.department,
        student_class=req.student_class,
        division=req.division,
        batch=req.batch
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = secrets.token_hex(24)
    u_dict = user_to_dict(user)
    SESSIONS[token] = {
        "user_id": user.id,
        "email": user.email,
        "role": user.role,
        "name": user.name
    }
    return {"token": token, "user": u_dict}

@app.post("/api/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    email_clean = req.email.strip().lower()
    user = db.query(User).filter(User.email == email_clean).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid email or password")

    token = secrets.token_hex(24)
    u_dict = user_to_dict(user)
    SESSIONS[token] = {
        "user_id": user.id,
        "email": user.email,
        "role": user.role,
        "name": user.name
    }
    return {"token": token, "user": u_dict}

@app.get("/api/auth/me")
def get_me(user: User = Depends(get_current_user)):
    return user_to_dict(user)

# ----------------- User Management (Faculty Admin Only) -----------------
@app.get("/api/admin/users")
def get_all_users(admin: User = Depends(require_faculty), db: Session = Depends(get_db)):
    users = db.query(User).all()
    return [user_to_dict(u) for u in users]

@app.post("/api/admin/promote")
def promote_user(req: PromoteRequest, admin: User = Depends(require_faculty), db: Session = Depends(get_db)):
    if req.role not in ["faculty", "student"]:
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'faculty' or 'student'")
    
    target = db.query(User).filter(User.id == req.target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    
    target.role = req.role
    db.commit()

    return {"message": f"User {target.name} role updated to {req.role}", "user": user_to_dict(target)}

# ----------------- Helper Functions -----------------
def generate_invite_code(db: Session) -> str:
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(secrets.choice(chars) for _ in range(6))
        if not db.query(Group).filter(Group.invite_code == code).first():
            return code

def format_group_response(group: Group, score: Optional[Score], current_user: User, db: Session) -> dict:
    member_names = json.loads(group.member_names_json) if group.member_names_json else []
    member_user_ids = json.loads(group.member_user_ids_json) if group.member_user_ids_json else []
    
    creator = db.query(User).filter(User.id == group.created_by).first()
    creator_name = creator.name if creator else "Group Leader"

    score_data = None
    if score:
        score_data = {
            "innovation": score.innovation,
            "feasibility": score.feasibility,
            "solution": score.solution,
            "presentation": score.presentation,
            "total": score.total,
            "remarks": score.remarks,
            "updated_at": score.updated_at.isoformat() if score.updated_at else None
        }

    budget_items = []
    if group.budget_items_json:
        try:
            budget_items = json.loads(group.budget_items_json)
        except Exception:
            budget_items = []

    pitch_strategy = {}
    if group.pitch_strategy_json:
        try:
            pitch_strategy = json.loads(group.pitch_strategy_json)
        except Exception:
            pitch_strategy = {}

    digital_marketing = {}
    if group.digital_marketing_json:
        try:
            digital_marketing = json.loads(group.digital_marketing_json)
        except Exception:
            digital_marketing = {}

    employability_portfolio = {}
    if group.employability_portfolio_json:
        try:
            employability_portfolio = json.loads(group.employability_portfolio_json)
        except Exception:
            employability_portfolio = {}

    # Calculate Real-Time Marketing Performance (Deduplicated Unique Visitors & Channels)
    visits = db.query(MarketingVisit).filter(MarketingVisit.group_id == group.id).all()
    unique_visitors_set = set()
    channel_unique_counts = {"whatsapp": set(), "telegram": set(), "linkedin": set(), "direct": set(), "other": set()}
    total_raw_clicks = len(visits)

    for v in visits:
        unique_visitors_set.add(v.visitor_id)
        ch = (v.channel or "direct").lower()
        if ch in channel_unique_counts:
            channel_unique_counts[ch].add(v.visitor_id)
        else:
            channel_unique_counts["other"].add(v.visitor_id)

    marketing_metrics = {
        "total_unique_views": len(unique_visitors_set),
        "total_raw_clicks": total_raw_clicks,
        "whatsapp_unique": len(channel_unique_counts["whatsapp"]),
        "telegram_unique": len(channel_unique_counts["telegram"]),
        "linkedin_unique": len(channel_unique_counts["linkedin"]),
        "direct_unique": len(channel_unique_counts["direct"]),
        "other_unique": len(channel_unique_counts["other"]),
        "engagement_rate": round((len(unique_visitors_set) / max(1, total_raw_clicks)) * 100, 1)
    }

    return {
        "id": group.id,
        "name": group.name,
        "invite_code": group.invite_code,
        "department": group.department,
        "student_class": group.student_class,
        "division": group.division,
        "batch": group.batch,
        "member_names": member_names,
        "member_user_ids": member_user_ids,
        "created_by": group.created_by,
        "creator_name": creator_name,
        "is_leader": (current_user.id == group.created_by),
        
        # 5 Structured Steps
        "step1_problem_statement": group.step1_problem_statement,
        "step2_market_research": group.step2_market_research,
        "step3_innovative_solution": group.step3_innovative_solution,
        "step4_feasibility_business_model": group.step4_feasibility_business_model,
        "step5_marketing_presentation": group.step5_marketing_presentation,

        # Step Verifications & Faculty Remarks
        "step1_status": group.step1_status or "pending",
        "step2_status": group.step2_status or "pending",
        "step3_status": group.step3_status or "pending",
        "step4_status": group.step4_status or "pending",
        "step5_status": group.step5_status or "pending",

        "step1_remarks": group.step1_remarks or "",
        "step2_remarks": group.step2_remarks or "",
        "step3_remarks": group.step3_remarks or "",
        "step4_remarks": group.step4_remarks or "",
        "step5_remarks": group.step5_remarks or "",

        # 1 Lakh Budget & Pitch Strategy
        "budget_items": budget_items,
        "pitch_strategy": pitch_strategy,

        # 12-Point Curriculum Additions
        "digital_marketing": digital_marketing,
        "employability_portfolio": employability_portfolio,

        # Marketing Analytics & Deduplicated Tracking
        "marketing_metrics": marketing_metrics,

        "created_at": group.created_at.isoformat() if group.created_at else None,
        "score": score_data
    }

# ----------------- Student / Group Routes -----------------
@app.get("/api/groups/my-group")
def get_my_group(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    groups = db.query(Group).all()
    my_group = None
    for g in groups:
        members = json.loads(g.member_user_ids_json or "[]")
        if user.id in members:
            my_group = g
            break

    if not my_group:
        return {"has_group": False, "group": None}

    score = db.query(Score).filter(Score.group_id == my_group.id).first()
    return {
        "has_group": True,
        "group": format_group_response(my_group, score, user, db)
    }

@app.post("/api/groups")
def create_group(req: CreateGroupRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    groups = db.query(Group).all()
    for g in groups:
        members = json.loads(g.member_user_ids_json or "[]")
        if user.id in members:
            raise HTTPException(status_code=400, detail="You are already enrolled in a group.")

    names = [n.strip() for n in req.member_names if n.strip()]
    if user.name not in names:
        names.insert(0, user.name)

    invite_code = generate_invite_code(db)
    new_group = Group(
        id=str(uuid.uuid4()),
        name=req.name.strip(),
        department=req.department,
        student_class=req.student_class,
        division=req.division,
        batch=req.batch,
        invite_code=invite_code,
        member_names_json=json.dumps(names),
        member_user_ids_json=json.dumps([user.id]),
        created_by=user.id,
        step1_problem_statement="",
        step2_market_research="",
        step3_innovative_solution="",
        step4_feasibility_business_model="",
        step5_marketing_presentation=""
    )
    db.add(new_group)
    db.commit()
    db.refresh(new_group)

    return {"message": "Group registered successfully as Leader", "group": format_group_response(new_group, None, user, db)}

@app.post("/api/groups/join")
def join_group(req: JoinGroupRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    code = req.invite_code.strip().upper()
    target_group = db.query(Group).filter(Group.invite_code == code).first()
    if not target_group:
        raise HTTPException(status_code=404, detail="Invalid invite code. No matching group found.")

    all_groups = db.query(Group).all()
    for g in all_groups:
        members = json.loads(g.member_user_ids_json or "[]")
        if user.id in members:
            if g.id == target_group.id:
                raise HTTPException(status_code=400, detail="You are already a member of this group.")
            else:
                raise HTTPException(status_code=400, detail="You are already a member of another group.")

    member_user_ids = json.loads(target_group.member_user_ids_json or "[]")
    member_names = json.loads(target_group.member_names_json or "[]")

    if user.id not in member_user_ids:
        member_user_ids.append(user.id)
    if user.name not in member_names:
        member_names.append(user.name)

    target_group.member_user_ids_json = json.dumps(member_user_ids)
    target_group.member_names_json = json.dumps(member_names)
    db.commit()
    db.refresh(target_group)

    score = db.query(Score).filter(Score.group_id == target_group.id).first()
    return {"message": "Successfully joined group!", "group": format_group_response(target_group, score, user, db)}

@app.put("/api/groups/{group_id}")
async def update_group_content(group_id: str, req: UpdateGroupContentRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    member_user_ids = json.loads(group.member_user_ids_json or "[]")
    if user.role != "faculty" and user.id not in member_user_ids:
        raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to edit this group.")

    # Verify step progression locking for students:
    # A student can only edit Step N if Step N-1 has been verified and marked as 'approved' by faculty
    if user.role != "faculty":
        if req.step2_market_research is not None and req.step2_market_research != group.step2_market_research:
            if group.step1_status != "approved":
                raise HTTPException(status_code=400, detail="Step 1 must be marked and approved by faculty before proceeding with Step 2.")
        if req.step3_innovative_solution is not None and req.step3_innovative_solution != group.step3_innovative_solution:
            if group.step2_status != "approved":
                raise HTTPException(status_code=400, detail="Step 2 must be marked and approved by faculty before proceeding with Step 3.")
        if req.step4_feasibility_business_model is not None and req.step4_feasibility_business_model != group.step4_feasibility_business_model:
            if group.step3_status != "approved":
                raise HTTPException(status_code=400, detail="Step 3 must be marked and approved by faculty before proceeding with Step 4.")
        if req.step5_marketing_presentation is not None and req.step5_marketing_presentation != group.step5_marketing_presentation:
            if group.step4_status != "approved":
                raise HTTPException(status_code=400, detail="Step 4 must be marked and approved by faculty before proceeding with Step 5.")

    if req.step1_problem_statement is not None:
        if group.step1_problem_statement != req.step1_problem_statement:
            group.step1_problem_statement = req.step1_problem_statement
            if user.role != "faculty" and group.step1_status != "approved":
                group.step1_status = "pending"
    if req.step2_market_research is not None:
        if group.step2_market_research != req.step2_market_research:
            group.step2_market_research = req.step2_market_research
            if user.role != "faculty" and group.step2_status != "approved":
                group.step2_status = "pending"
    if req.step3_innovative_solution is not None:
        if group.step3_innovative_solution != req.step3_innovative_solution:
            group.step3_innovative_solution = req.step3_innovative_solution
            if user.role != "faculty" and group.step3_status != "approved":
                group.step3_status = "pending"
    if req.step4_feasibility_business_model is not None:
        if group.step4_feasibility_business_model != req.step4_feasibility_business_model:
            group.step4_feasibility_business_model = req.step4_feasibility_business_model
            if user.role != "faculty" and group.step4_status != "approved":
                group.step4_status = "pending"
    if req.step5_marketing_presentation is not None:
        if group.step5_marketing_presentation != req.step5_marketing_presentation:
            group.step5_marketing_presentation = req.step5_marketing_presentation
            if user.role != "faculty" and group.step5_status != "approved":
                group.step5_status = "pending"

    if req.member_names is not None:
        cleaned_members = [m.strip() for m in req.member_names if m.strip()]
        group.member_names_json = json.dumps(cleaned_members)

    db.commit()
    db.refresh(group)

    await manager.broadcast({
        "event": "GROUP_CONTENT_UPDATED",
        "group_id": group.id,
        "group_name": group.name,
        "department": group.department,
        "division": group.division,
        "batch": group.batch
    })

    score = db.query(Score).filter(Score.group_id == group.id).first()
    return {"message": "Project details updated", "group": format_group_response(group, score, user, db)}

# ----------------- ₹1,00,000 Budget Planner Routes -----------------
@app.put("/api/groups/{group_id}/budget")
async def update_group_budget(group_id: str, req: UpdateBudgetRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    member_user_ids = json.loads(group.member_user_ids_json or "[]")
    if user.role != "faculty" and user.id not in member_user_ids:
        raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to manage this budget.")

    # Validate that total budget does not exceed ₹1,00,000
    total_cost = sum(item.cost for item in req.budget_items)
    if total_cost > 100000.0:
        raise HTTPException(status_code=400, detail=f"Total budget allocation (₹{total_cost:,.2f}) exceeds the ₹1,00,000 course limit.")

    items_data = [item.dict() for item in req.budget_items]
    group.budget_items_json = json.dumps(items_data)
    db.commit()
    db.refresh(group)

    await manager.broadcast({
        "event": "GROUP_CONTENT_UPDATED",
        "group_id": group.id,
        "group_name": group.name
    })

    score = db.query(Score).filter(Score.group_id == group.id).first()
    return {"message": "Budget successfully saved within ₹1,00,000 limit", "group": format_group_response(group, score, user, db)}

# ----------------- Pitching Strategy Routes -----------------
@app.put("/api/groups/{group_id}/pitch")
async def update_group_pitch(group_id: str, req: UpdatePitchRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    member_user_ids = json.loads(group.member_user_ids_json or "[]")
    if user.role != "faculty" and user.id not in member_user_ids:
        raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to manage this pitch strategy.")

    group.pitch_strategy_json = json.dumps(req.dict())
    db.commit()
    db.refresh(group)

    await manager.broadcast({
        "event": "GROUP_CONTENT_UPDATED",
        "group_id": group.id,
        "group_name": group.name
    })

    score = db.query(Score).filter(Score.group_id == group.id).first()
    return {"message": "Pitching strategy saved successfully", "group": format_group_response(group, score, user, db)}

# ----------------- Digital Promotion Lab Routes (Points 5-10) -----------------
@app.put("/api/groups/{group_id}/digital-marketing")
async def update_group_digital_marketing(group_id: str, req: UpdateDigitalMarketingRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    member_user_ids = json.loads(group.member_user_ids_json or "[]")
    if user.role != "faculty" and user.id not in member_user_ids:
        raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to manage digital marketing for this group.")

    group.digital_marketing_json = json.dumps(req.dict())
    db.commit()
    db.refresh(group)

    await manager.broadcast({
        "event": "GROUP_CONTENT_UPDATED",
        "group_id": group.id,
        "group_name": group.name
    })

    score = db.query(Score).filter(Score.group_id == group.id).first()
    return {"message": "Digital promotion strategy saved successfully", "group": format_group_response(group, score, user, db)}

# ----------------- Analytics & Employability Routes (Points 11-12) -----------------
@app.put("/api/groups/{group_id}/employability")
async def update_group_employability(group_id: str, req: UpdateEmployabilityRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    member_user_ids = json.loads(group.member_user_ids_json or "[]")
    if user.role != "faculty" and user.id not in member_user_ids:
        raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to manage this portfolio.")

    group.employability_portfolio_json = json.dumps(req.dict())
    db.commit()
    db.refresh(group)

    await manager.broadcast({
        "event": "GROUP_CONTENT_UPDATED",
        "group_id": group.id,
        "group_name": group.name
    })

    score = db.query(Score).filter(Score.group_id == group.id).first()
    return {"message": "Analytics and team employability portfolio saved successfully", "group": format_group_response(group, score, user, db)}

# ----------------- Real-Time Marketing Link Click Tracking & Deduplication -----------------
@app.get("/track/{channel}/{group_identifier}")
async def track_marketing_click(channel: str, group_identifier: str, request: Request, response: Response, db: Session = Depends(get_db)):
    # Find group by ID or invite code
    group = db.query(Group).filter((Group.id == group_identifier) | (Group.invite_code == group_identifier)).first()
    if not group:
        return HTMLResponse("<h3>Project not found</h3>", status_code=404)

    # Deduplication fingerprinting:
    # 1. First check tracking cookie 'edmg_vid'
    visitor_cookie = request.cookies.get("edmg_vid")
    ip = request.client.host if request.client else "127.0.0.1"
    ua = request.headers.get("user-agent", "")
    
    # 2. If no cookie, construct deterministic browser fingerprint hash (IP + User-Agent)
    if not visitor_cookie:
        fingerprint_raw = f"{ip}_{ua}"
        visitor_id = hashlib.sha256(fingerprint_raw.encode("utf-8")).hexdigest()[:16]
    else:
        visitor_id = visitor_cookie

    clean_channel = channel.lower()
    if clean_channel not in ["whatsapp", "telegram", "linkedin", "direct"]:
        clean_channel = "direct"

    # Record the visit
    visit = MarketingVisit(
        id=str(uuid.uuid4()),
        group_id=group.id,
        channel=clean_channel,
        visitor_id=visitor_id,
        user_agent=ua[:255],
        ip_address=ip
    )
    db.add(visit)
    db.commit()

    # Broadcast live event so both Student and Faculty dashboards update instantly without manual refresh
    await manager.broadcast({
        "event": "MARKETING_CLICK_RECORDED",
        "group_id": group.id,
        "channel": clean_channel,
        "visitor_id": visitor_id
    })

    # Prepare public project showcase response
    redirect_target = f"/p/{group.invite_code}"
    res = RedirectResponse(url=redirect_target, status_code=302)
    # Set persistent cookie for 1 year so repeated clicks by this user never inflate unique views
    res.set_cookie(key="edmg_vid", value=visitor_id, max_age=31536000, httponly=False)
    return res

@app.get("/p/{group_identifier}")
def show_public_project_page(group_identifier: str, db: Session = Depends(get_db)):
    group = db.query(Group).filter((Group.id == group_identifier) | (Group.invite_code == group_identifier)).first()
    if not group:
        return HTMLResponse("<h3>Project not found</h3>", status_code=404)

    pitch = {}
    if group.pitch_strategy_json:
        try:
            pitch = json.loads(group.pitch_strategy_json)
        except Exception:
            pitch = {}

    mkt = {}
    if group.digital_marketing_json:
        try:
            mkt = json.loads(group.digital_marketing_json)
        except Exception:
            mkt = {}

    # Public Showcase Landing Page
    html = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>{group.name} - Project Showcase</title>
      <meta name="description" content="{mkt.get('seo_meta_description', group.step1_problem_statement[:150])}">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
      <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ font-family: 'Plus Jakarta Sans', sans-serif; background: #0f172a; color: #f8fafc; line-height: 1.6; padding: 2rem 1rem; }}
        .container {{ max-width: 760px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; padding: 2.5rem; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }}
        .badge-row {{ display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }}
        .badge {{ background: #3b82f6; color: white; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; }}
        .title {{ font-size: 2rem; font-weight: 800; color: #ffffff; margin-bottom: 0.5rem; }}
        .tagline {{ font-size: 1.15rem; color: #38bdf8; font-weight: 600; margin-bottom: 1.5rem; }}
        .card {{ background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 1.25rem; margin-bottom: 1.25rem; }}
        .card h4 {{ color: #a855f7; margin-bottom: 0.5rem; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.05em; }}
        .card p {{ color: #cbd5e1; font-size: 0.95rem; }}
        .cta-btn {{ display: inline-flex; align-items: center; gap: 0.5rem; background: #10b981; color: white; text-decoration: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 700; margin-top: 1rem; }}
        .footer {{ text-align: center; margin-top: 2rem; font-size: 0.8rem; color: #64748b; }}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="badge-row">
          <span class="badge">{group.department}</span>
          <span class="badge" style="background: #8b5cf6;">{group.student_class}</span>
          <span class="badge" style="background: #10b981;">{group.division} • {group.batch}</span>
        </div>
        <h1 class="title">{group.name}</h1>
        <div class="tagline">"{pitch.get('hook_tagline') or 'Next-Generation Engineering & Digital Entrepreneurship Venture'}"</div>

        <div class="card">
          <h4><i class="fa-solid fa-bullseye"></i> 1. Problem We Solve</h4>
          <p>{group.step1_problem_statement or 'Solving industry friction through precision hardware and telemetry.'}</p>
        </div>

        <div class="card">
          <h4><i class="fa-solid fa-microchip"></i> 2. Technical Prototype &amp; Solution</h4>
          <p>{group.step3_innovative_solution or 'Advanced engineering architecture engineered for maximum efficiency.'}</p>
        </div>

        <div class="card">
          <h4><i class="fa-solid fa-chart-line"></i> 3. Commercial Viability &amp; Business Model</h4>
          <p>{group.step4_feasibility_business_model or 'Sustainable unit economics with high scalability potential.'}</p>
        </div>

        {f'<div class="card"><h4><i class="fa-solid fa-link"></i> Live Prototype / Demo</h4><p><a href="{mkt.get("landing_page_url")}" target="_blank" style="color: #38bdf8; text-decoration: underline;">Open Project Demo Website</a></p></div>' if mkt.get('landing_page_url') else ''}

        <div style="text-align: center; margin-top: 2rem;">
          <a href="/?join={group.invite_code}" class="cta-btn">
            <i class="fa-solid fa-graduation-cap"></i> E&amp;DM Academic Project Showcase
          </a>
        </div>

        <div class="footer">
          E&amp;DM Group Project Manager • Verified Academic Capstone Record
        </div>
      </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html)

# ----------------- Faculty Step Verification Endpoint -----------------
@app.post("/api/admin/groups/{group_id}/verify-step")
async def verify_step(group_id: str, req: VerifyStepRequest, admin: User = Depends(require_faculty), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    step_num = req.step_number
    status_val = req.status # 'approved', 'rejected', or 'pending'
    remarks_val = (req.remarks or "").strip()

    if step_num == 1:
        group.step1_status = status_val
        group.step1_remarks = remarks_val
    elif step_num == 2:
        group.step2_status = status_val
        group.step2_remarks = remarks_val
    elif step_num == 3:
        group.step3_status = status_val
        group.step3_remarks = remarks_val
    elif step_num == 4:
        group.step4_status = status_val
        group.step4_remarks = remarks_val
    elif step_num == 5:
        group.step5_status = status_val
        group.step5_remarks = remarks_val

    db.commit()
    db.refresh(group)

    await manager.broadcast({
        "event": "STEP_VERIFIED",
        "group_id": group.id,
        "step_number": step_num,
        "status": status_val,
        "remarks": remarks_val
    })

    score = db.query(Score).filter(Score.group_id == group.id).first()
    return {
        "message": f"Step {step_num} marked as '{status_val}'.",
        "group": format_group_response(group, score, admin, db)
    }

@app.get("/api/groups/{group_id}")
def get_group_by_id(group_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    member_user_ids = json.loads(group.member_user_ids_json or "[]")
    if user.role != "faculty" and user.id not in member_user_ids:
        raise HTTPException(status_code=403, detail="Forbidden: You cannot access another group's details.")

    score = db.query(Score).filter(Score.group_id == group.id).first()
    return format_group_response(group, score, user, db)

# ----------------- Faculty Routes -----------------
@app.get("/api/admin/groups")
def get_all_groups(
    department: Optional[str] = None,
    student_class: Optional[str] = None,
    division: Optional[str] = None,
    batch: Optional[str] = None,
    admin: User = Depends(require_faculty),
    db: Session = Depends(get_db)
):
    query = db.query(Group)
    if department and department != "All":
        query = query.filter(Group.department == department)
    if student_class and student_class != "All":
        query = query.filter(Group.student_class == student_class)
    if division and division != "All":
        query = query.filter(Group.division == division)
    if batch and batch != "All":
        query = query.filter(Group.batch == batch)
    
    groups = query.order_by(Group.created_at.desc()).all()
    result = []
    for g in groups:
        s = db.query(Score).filter(Score.group_id == g.id).first()
        result.append(format_group_response(g, s, admin, db))
    return result

@app.post("/api/admin/groups/{group_id}/score")
async def score_group(group_id: str, req: ScoreRequest, admin: User = Depends(require_faculty), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    c_innov = max(0, min(15, req.innovation))
    c_feas = max(0, min(10, req.feasibility))
    c_sol = max(0, min(15, req.solution))
    c_pres = max(0, min(10, req.presentation))
    total = c_innov + c_feas + c_sol + c_pres

    score = db.query(Score).filter(Score.group_id == group_id).first()
    if not score:
        score = Score(
            id=str(uuid.uuid4()),
            group_id=group_id,
            innovation=c_innov,
            feasibility=c_feas,
            solution=c_sol,
            presentation=c_pres,
            total=total,
            remarks=req.remarks or "",
            scored_by=admin.id,
            updated_at=datetime.now(timezone.utc)
        )
        db.add(score)
    else:
        score.innovation = c_innov
        score.feasibility = c_feas
        score.solution = c_sol
        score.presentation = c_pres
        score.total = total
        score.remarks = req.remarks or ""
        score.scored_by = admin.id
        score.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(score)

    await manager.broadcast({
        "event": "SCORE_UPDATED",
        "group_id": group.id,
        "group_name": group.name,
        "department": group.department,
        "student_class": group.student_class,
        "division": group.division,
        "batch": group.batch,
        "total": total,
        "score": {
            "innovation": c_innov,
            "feasibility": c_feas,
            "solution": c_sol,
            "presentation": c_pres,
            "total": total,
            "remarks": score.remarks,
            "updated_at": score.updated_at.isoformat()
        }
    })

    return {
        "message": "Group scored successfully",
        "score": {
            "innovation": score.innovation,
            "feasibility": score.feasibility,
            "solution": score.solution,
            "presentation": score.presentation,
            "total": score.total,
            "remarks": score.remarks,
            "updated_at": score.updated_at.isoformat()
        }
    }

@app.delete("/api/admin/groups/{group_id}")
async def delete_group(group_id: str, admin: User = Depends(require_faculty), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    db.query(Score).filter(Score.group_id == group_id).delete()
    db.delete(group)
    db.commit()

    await manager.broadcast({
        "event": "GROUP_DELETED",
        "group_id": group_id
    })

    return {"message": f"Group '{group.name}' and all associated records deleted."}

# ----------------- Leaderboard -----------------
@app.get("/api/leaderboard")
def get_leaderboard(
    department: Optional[str] = None,
    student_class: Optional[str] = None,
    division: Optional[str] = None,
    batch: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Group)
    if department and department != "All":
        query = query.filter(Group.department == department)
    if student_class and student_class != "All":
        query = query.filter(Group.student_class == student_class)
    if division and division != "All":
        query = query.filter(Group.division == division)
    if batch and batch != "All":
        query = query.filter(Group.batch == batch)

    groups = query.all()
    leaderboard = []

    for g in groups:
        s = db.query(Score).filter(Score.group_id == g.id).first()
        member_names = json.loads(g.member_names_json or "[]")
        
        innov = s.innovation if s else 0
        feas = s.feasibility if s else 0
        sol = s.solution if s else 0
        pres = s.presentation if s else 0
        total = innov + feas + sol + pres
        is_marked = (s is not None)

        leaderboard.append({
            "id": g.id,
            "name": g.name,
            "department": g.department,
            "student_class": g.student_class,
            "division": g.division,
            "batch": g.batch,
            "members": member_names,
            "is_marked": is_marked,
            "innovation": innov,
            "feasibility": feas,
            "solution_score": sol,
            "presentation": pres,
            "total": total,
            "remarks": s.remarks if s else "",
            "step1_problem_statement": g.step1_problem_statement,
            "step2_market_research": g.step2_market_research,
            "step3_innovative_solution": g.step3_innovative_solution,
            "step4_feasibility_business_model": g.step4_feasibility_business_model,
            "step5_marketing_presentation": g.step5_marketing_presentation
        })

    leaderboard.sort(key=lambda x: (x["is_marked"], x["total"], x["innovation"], x["solution_score"]), reverse=True)

    ranked = []
    for rank_idx, item in enumerate(leaderboard, start=1):
        item_copy = dict(item)
        item_copy["rank"] = rank_idx
        ranked.append(item_copy)

    top_project = None
    if ranked and ranked[0]["is_marked"]:
        top_project = ranked[0]

    return {
        "leaderboard": ranked,
        "best_project": top_project
    }

# ----------------- WebSocket Endpoint -----------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

# ----------------- Serve Frontend Static Files -----------------
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
    return {"message": "E&DM Group Project Manager API running."}

@app.get("/{full_path:path}")
def catch_all(full_path: str):
    potential_file = os.path.join(STATIC_DIR, full_path)
    if os.path.exists(potential_file) and os.path.isfile(potential_file):
        return FileResponse(potential_file, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
    return {"message": "Not found"}
