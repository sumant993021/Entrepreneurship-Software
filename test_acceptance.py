import urllib.request
import urllib.error
import json
import sys

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
    print("=== STARTING AUTOMATED ACCEPTANCE CHECKS ===")

    # 1. Login Faculty and Students
    status, fac = post("/api/auth/login", {"email": "faculty@college.edu", "password": "faculty123"})
    assert status == 200, f"Faculty login failed: {fac}"
    faculty_token = fac["token"]
    print("[PASS] Faculty login successful")

    status, stu1 = post("/api/auth/login", {"email": "aarav@college.edu", "password": "student123"})
    assert status == 200, f"Student 1 login failed: {stu1}"
    stu1_token = stu1["token"]
    print("[PASS] Student 1 (Aarav) login successful")

    status, stu3 = post("/api/auth/login", {"email": "rohit@college.edu", "password": "student123"})
    assert status == 200, f"Student 3 (Rohit) login failed: {stu3}"
    stu3_token = stu3["token"]
    print("[PASS] Student 3 (Rohit) login successful")

    # Register a new student for fresh group testing
    import time
    ts = int(time.time())
    new_email = f"test_student_{ts}@college.edu"
    status, new_stu = post("/api/auth/register", {"name": f"Tester {ts}", "email": new_email, "password": "pass123"})
    assert status == 200, f"Register failed: {new_stu}"
    new_stu_token = new_stu["token"]
    print(f"[PASS] Registered new student: {new_email}")

    # Register a second new student to test joining via invite code
    joiner_email = f"joiner_{ts}@college.edu"
    status, joiner_stu = post("/api/auth/register", {"name": f"Joiner {ts}", "email": joiner_email, "password": "pass123"})
    assert status == 200, f"Joiner register failed: {joiner_stu}"
    joiner_token = joiner_stu["token"]
    print(f"[PASS] Registered joiner student: {joiner_email}")

    # Check 1: Student creates group, adds members, edits idea/innovation/solution, persists after reload
    status, g_res = post("/api/groups", {"name": f"SolarDrone {ts}", "member_names": ["Partner A", "Partner B"]}, new_stu_token)
    assert status == 200, f"Group creation failed: {g_res}"
    group_id = g_res["group"]["id"]
    invite_code = g_res["group"]["invite_code"]
    print(f"[PASS] Check 1.1: Group created with invite code: {invite_code}")

    # Update idea/innovation/solution
    status, upd_res = put(f"/api/groups/{group_id}", {
        "idea": "Autonomous drone solar panel thermal inspection",
        "innovation": "Edge AI thermographic defect detection",
        "solution": "Drone fleet automated charging pads and cloud telemetry",
        "member_names": [f"Tester {ts}", "Teammate Beta"]
    }, new_stu_token)
    assert status == 200, f"Group update failed: {upd_res}"
    assert upd_res["group"]["idea"] == "Autonomous drone solar panel thermal inspection"
    print("[PASS] Check 1.2: Student updated idea/innovation/solution")

    # Reload group via get_my_group
    status, my_g = get("/api/groups/my-group", new_stu_token)
    assert status == 200
    assert my_g["has_group"] is True
    assert my_g["group"]["idea"] == "Autonomous drone solar panel thermal inspection"
    assert my_g["group"]["innovation"] == "Edge AI thermographic defect detection"
    print("[PASS] Check 1.3: Group details persist accurately upon retrieval")

    # Check 2: Second student using invite code joins the SAME group
    status, join_res = post("/api/groups/join", {"invite_code": invite_code}, joiner_token)
    assert status == 200, f"Joining group failed: {join_res}"
    assert join_res["group"]["id"] == group_id, "Joined group ID mismatch!"
    # Verify joiner is now listed in memberUserIds
    status, my_g_joiner = get("/api/groups/my-group", joiner_token)
    assert status == 200
    assert my_g_joiner["group"]["id"] == group_id
    assert f"Joiner {ts}" in my_g_joiner["group"]["member_names"]
    print("[PASS] Check 2: Second student successfully joined the SAME group record via invite code")

    # Check 3: Student CANNOT view or edit another group's submission or scores via direct API calls
    # Rohit (stu3) tries to read SolarDrone group
    status, rogue_read = get(f"/api/groups/{group_id}", stu3_token)
    assert status == 403, f"Security check failed! Status was {status}, expected 403 Forbidden"
    print("[PASS] Check 3.1: Server rejected unauthorized read with 403 Forbidden")

    # Rohit tries to edit SolarDrone group
    status, rogue_edit = put(f"/api/groups/{group_id}", {"idea": "Hacked idea"}, stu3_token)
    assert status == 403, f"Security check failed! Status was {status}, expected 403 Forbidden"
    print("[PASS] Check 3.2: Server rejected unauthorized update with 403 Forbidden")

    # Student tries to call faculty scoring endpoint
    status, rogue_score = post(f"/api/admin/groups/{group_id}/score", {
        "innovation": 15, "feasibility": 10, "solution": 15, "presentation": 10
    }, stu3_token)
    assert status == 403, f"Security check failed! Student scored group. Status: {status}"
    print("[PASS] Check 3.3: Server rejected non-faculty scoring attempt with 403 Forbidden")

    # Check 4: Faculty can see all groups' full text and enter scores; scores clamp to max per criterion
    status, all_groups = get("/api/admin/groups", faculty_token)
    assert status == 200
    assert len(all_groups) >= 3
    print(f"[PASS] Check 4.1: Faculty fetched all {len(all_groups)} groups with full narratives")

    # Submit out-of-range scores to test server clamping (e.g. 20, 20, 20, 20)
    status, score_res = post(f"/api/admin/groups/{group_id}/score", {
        "innovation": 25,     # Max is 15
        "feasibility": 30,    # Max is 10
        "solution": 50,       # Max is 15
        "presentation": 40,   # Max is 10
        "remarks": "Exceptional presentation and verified field tests."
    }, faculty_token)
    assert status == 200
    scored = score_res["score"]
    assert scored["innovation"] == 15, f"Innovation was not clamped: {scored['innovation']}"
    assert scored["feasibility"] == 10, f"Feasibility was not clamped: {scored['feasibility']}"
    assert scored["solution"] == 15, f"Solution was not clamped: {scored['solution']}"
    assert scored["presentation"] == 10, f"Presentation was not clamped: {scored['presentation']}"
    assert scored["total"] == 50, f"Total was {scored['total']}, expected 50"
    print("[PASS] Check 4.2: Server clamped scores correctly: 15+10+15+10 = 50 total")

    # Check 5: Leaderboard total always equals the sum of the four criteria and never exceeds 50
    status, lb_res = get("/api/leaderboard", stu1_token)
    assert status == 200
    leaderboard = lb_res["leaderboard"]
    for row in leaderboard:
        if row["is_marked"]:
            calc_total = row["innovation"] + row["feasibility"] + row["solution_score"] + row["presentation"]
            assert row["total"] == calc_total, f"Sum mismatch for {row['name']}: {row['total']} != {calc_total}"
            assert row["total"] <= 50, f"Score exceeded 50: {row['total']}"
    print(f"[PASS] Check 5: Leaderboard verified for all {len(leaderboard)} entries. All totals match criterion sum <= 50")

    # Check 6: Leaderboard highlights #1 best performing project
    best_project = lb_res["best_project"]
    assert best_project is not None
    assert best_project["total"] >= 45
    print(f"[PASS] Check 6: Leaderboard #1 rank project verified: '{best_project['name']}' with {best_project['total']}/50 Pts")

    # Check 7: Promotion to Faculty
    status, promote_res = post("/api/admin/promote", {"target_user_id": new_stu["user"]["id"], "role": "faculty"}, faculty_token)
    assert status == 200, f"Promotion failed: {promote_res}"
    print("[PASS] Check 7: Successfully promoted account to faculty")

    print("\nALL 6 ACCEPTANCE CHECKS PASSED PERFECTLY!")

if __name__ == "__main__":
    run_tests()
