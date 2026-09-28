import urllib.request
import urllib.error
import json
import time

BASE = "http://127.0.0.1:8000"

def post(endpoint, payload, token=None):
    url = f"{BASE}{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except:
            return e.code, body

def put(endpoint, payload, token):
    url = f"{BASE}{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="PUT")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except:
            return e.code, body

def get(endpoint, token=None):
    url = f"{BASE}{endpoint}"
    req = urllib.request.Request(url, method="GET")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except:
            return e.code, body

def run_tests():
    print("=== STARTING DEPARTMENT & 5-STEP MULTI-FACULTY ACCEPTANCE TESTS ===")

    # 1. Login Faculty 1 (ECS) and Faculty 2 (Instrumentation)
    status, f1 = post("/api/auth/login", {"email": "faculty.ecs@college.edu", "password": "faculty123"})
    assert status == 200, f"Faculty 1 login failed: {f1}"
    fac1_token = f1["token"]
    print("[PASS] Faculty 1 (ECS): Logged in")

    status, f2 = post("/api/auth/login", {"email": "faculty.inst@college.edu", "password": "faculty123"})
    assert status == 200, f"Faculty 2 login failed: {f2}"
    fac2_token = f2["token"]
    print("[PASS] Faculty 2 (Instrumentation): Logged in")

    # 2. Login ECS Leader and verify their group with 5 steps
    status, lead_ecs = post("/api/auth/login", {"email": "aarav.ecs@college.edu", "password": "student123"})
    assert status == 200, f"Leader login failed: {lead_ecs}"
    lead_token = lead_ecs["token"]
    print("[PASS] Group Leader (Aarav, ECS Div A): Logged in")

    status, my_group = get("/api/groups/my-group", lead_token)
    assert status == 200
    g = my_group["group"]
    assert g["department"] == "ECS"
    assert g["division"] == "Div A"
    assert g["is_leader"] is True
    assert len(g["step1_problem_statement"]) > 10
    print("[PASS] Group Leader verified: ECS Div A with 5 steps loaded")

    # 3. Leader updates every detail of the 5 steps
    status, upd_res = put(f"/api/groups/{g['id']}", {
        "step1_problem_statement": "UPDATED Step 1: Urban EV charging grid congestion during noon tariff peaks.",
        "step2_market_research": "UPDATED Step 2: 92% of fleet couriers want swap stations within 1.5 km.",
        "step3_innovative_solution": "UPDATED Step 3: Dual-bus bidirectional inverter with automated BMS telemetry.",
        "step4_feasibility_business_model": "UPDATED Step 4: Break-even at 120 subscribed vehicles.",
        "step5_marketing_presentation": "UPDATED Step 5: Live campus deployment video & investor deck link."
    }, lead_token)
    assert status == 200
    assert upd_res["group"]["step1_problem_statement"].startswith("UPDATED Step 1")
    print("[PASS] Leader successfully updated all 5 project steps in their dashboard")

    # 4. Faculty inspects full details of every step of that group
    status, fac_groups = get(f"/api/admin/groups?department=ECS&division=Div%20A", fac1_token)
    assert status == 200
    target_group = next(x for x in fac_groups if x["id"] == g["id"])
    assert target_group["step1_problem_statement"].startswith("UPDATED Step 1")
    assert target_group["step2_market_research"].startswith("UPDATED Step 2")
    assert target_group["step3_innovative_solution"].startswith("UPDATED Step 3")
    assert target_group["step4_feasibility_business_model"].startswith("UPDATED Step 4")
    assert target_group["step5_marketing_presentation"].startswith("UPDATED Step 5")
    print("[PASS] Faculty verified: Complete details of every step (1 to 5) visible in faculty review")

    # 5. Faculty evaluates group with 50-point rubric
    status, score_res = post(f"/api/admin/groups/{g['id']}/score", {
        "innovation": 15,
        "feasibility": 10,
        "solution": 14,
        "presentation": 10,
        "remarks": "Exemplary progress across all 5 steps! Market validation and financial modeling are flawless."
    }, fac1_token)
    assert status == 200
    assert score_res["score"]["total"] == 49
    print("[PASS] Faculty scored group: 15+10+14+10 = 49 / 50")

    # 6. Verify Leaderboard filter by Department and Division
    status, lb_ecs_a = get("/api/leaderboard?department=ECS&division=Div%20A", lead_token)
    assert status == 200
    assert len(lb_ecs_a["leaderboard"]) >= 1
    assert lb_ecs_a["leaderboard"][0]["department"] == "ECS"
    assert lb_ecs_a["leaderboard"][0]["division"] == "Div A"
    assert lb_ecs_a["best_project"]["total"] == 49
    print("[PASS] Leaderboard verified for ECS Div A")

    # 7. Security: Another student from Instrumentation cannot edit this ECS group
    status, lead_inst = post("/api/auth/login", {"email": "priya.inst@college.edu", "password": "student123"})
    assert status == 200
    status, rogue_edit = put(f"/api/groups/{g['id']}", {"step1_problem_statement": "Hacked"}, lead_inst["token"])
    assert status == 403
    print("[PASS] Server RBAC: Student from Instrumentation blocked (403 Forbidden)")

    print("\nALL MULTI-FACULTY, 2-DEPARTMENT, AND 5-STEP TESTS PASSED!")

if __name__ == "__main__":
    run_tests()
