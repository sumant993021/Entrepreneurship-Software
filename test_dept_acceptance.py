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

    # 1. Login Faculty 1 (Dr. Rajesh) and Faculty 2 (Prof. Ananya)
    status, f1 = post("/api/auth/login", {"email": "faculty.rajesh@college.edu", "password": "faculty123"})
    assert status == 200, f"Faculty 1 login failed: {f1}"
    fac1_token = f1["token"]
    print("[PASS] Faculty 1 (Dr. Rajesh Raman): Logged in")

    status, f2 = post("/api/auth/login", {"email": "faculty.ananya@college.edu", "password": "faculty123"})
    assert status == 200, f"Faculty 2 login failed: {f2}"
    fac2_token = f2["token"]
    print("[PASS] Faculty 2 (Prof. Ananya Sen): Logged in")

    # 2. Login ECS Leader and verify their group with 5 steps
    status, lead_ecs = post("/api/auth/login", {"email": "aarav.b1@college.edu", "password": "student123"})
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

    # 3. Leader updates Step 1 initially (since it's step 1 and pending)
    status, upd_res = put(f"/api/groups/{g['id']}", {
        "step1_problem_statement": "UPDATED Step 1: Urban EV charging grid congestion during noon tariff peaks."
    }, lead_token)
    assert status == 200, f"Leader step 1 update failed: {upd_res}"
    assert upd_res["group"]["step1_problem_statement"].startswith("UPDATED Step 1")
    print("[PASS] Leader successfully updated Step 1 in their dashboard")

    # Faculty approves steps 1 through 4 so subsequent steps can be submitted
    for s_idx in range(1, 5):
        st_v, _ = post(f"/api/admin/groups/{g['id']}/verify-step", {
            "step_number": s_idx,
            "status": "approved",
            "remarks": f"Step {s_idx} verified and approved."
        }, fac1_token)
        assert st_v == 200

    # Leader submits step 5
    status, upd_res5 = put(f"/api/groups/{g['id']}", {
        "step5_marketing_presentation": "UPDATED Step 5: Live campus deployment video & investor deck link."
    }, lead_token)
    assert status == 200, f"Leader step 5 update failed: {upd_res5}"
    assert upd_res5["group"]["step5_marketing_presentation"].startswith("UPDATED Step 5")
    print("[PASS] Leader verified progressive step unlocking and successfully submitted Step 5")

    # 4. Faculty inspects full details of every step of that group
    status, fac_groups = get(f"/api/admin/groups?department=ECS&division=Div%20A", fac1_token)
    assert status == 200
    target_group = next(x for x in fac_groups if x["id"] == g["id"])
    assert target_group["step1_problem_statement"].startswith("UPDATED Step 1")
    assert len(target_group["step2_market_research"]) > 5
    assert len(target_group["step3_innovative_solution"]) > 5
    assert len(target_group["step4_feasibility_business_model"]) > 5
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
    status, lead_inst = post("/api/auth/login", {"email": "priya.inst1@college.edu", "password": "student123"})
    assert status == 200
    status, rogue_edit = put(f"/api/groups/{g['id']}", {"step1_problem_statement": "Hacked"}, lead_inst["token"])
    assert status == 403
    print("[PASS] Server RBAC: Student from Instrumentation blocked (403 Forbidden)")

    print("\nALL MULTI-FACULTY, 2-DEPARTMENT, AND 5-STEP TESTS PASSED!")

if __name__ == "__main__":
    run_tests()
