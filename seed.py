
"""
Database seeder demonstrating:
- 2 Faculties: Dr. Rajesh Raman & Prof. Ananya Sen
  Both have assigned batches in BOTH ECS and Instrumentation across classes & divisions.
  Example:
    Dr. Rajesh Raman has ECS (Third Year Div A - Batch 1, Batch 2) AND Instrumentation (Third Year Div A - Batch 1)
    Prof. Ananya Sen has ECS (Third Year Div A - Batch 3, Batch 4) AND Instrumentation (Third Year Div A - Batch 2)
- Student groups assigned to matching departments, classes, divisions, and batches.
Usage: python seed.py
"""
import uuid
import json
from datetime import datetime, timezone
from server import SessionLocal, User, Group, Score, hash_password

def seed():
    db = SessionLocal()
    try:
        # Faculty 1: Dr. Rajesh Raman
        # Teaches both ECS and Instrumentation (Batch 1 & Batch 2)
        fac1_assignments = [
            {
                "department": "ECS",
                "student_class": "Third Year",
                "division": "Div A",
                "batches": ["Batch 1", "Batch 2"]
            },
            {
                "department": "Instrumentation",
                "student_class": "Third Year",
                "division": "Div A",
                "batches": ["Batch 1"]
            }
        ]

        fac1 = db.query(User).filter(User.email == "faculty.rajesh@college.edu").first()
        if not fac1:
            fac1 = User(
                id=str(uuid.uuid4()),
                email="faculty.rajesh@college.edu",
                name="Dr. Rajesh Raman",
                hashed_password=hash_password("faculty123"),
                role="faculty",
                faculty_assignments_json=json.dumps(fac1_assignments)
            )
            db.add(fac1)
            print("Created Faculty 1 (Dr. Rajesh Raman): ECS & Instrumentation (Batch 1, 2)")

        # Faculty 2: Prof. Ananya Sen
        # Also teaches both ECS and Instrumentation (Batch 3, 4 & Batch 2)
        fac2_assignments = [
            {
                "department": "ECS",
                "student_class": "Third Year",
                "division": "Div A",
                "batches": ["Batch 3", "Batch 4"]
            },
            {
                "department": "Instrumentation",
                "student_class": "Third Year",
                "division": "Div A",
                "batches": ["Batch 2"]
            }
        ]

        fac2 = db.query(User).filter(User.email == "faculty.ananya@college.edu").first()
        if not fac2:
            fac2 = User(
                id=str(uuid.uuid4()),
                email="faculty.ananya@college.edu",
                name="Prof. Ananya Sen",
                hashed_password=hash_password("faculty123"),
                role="faculty",
                faculty_assignments_json=json.dumps(fac2_assignments)
            )
            db.add(fac2)
            print("Created Faculty 2 (Prof. Ananya Sen): ECS & Instrumentation (Batch 3, 4, 2)")

        # Student 1: Aarav (ECS, Third Year, Div A, Batch 1) -> Under Dr. Rajesh
        s1 = db.query(User).filter(User.email == "aarav.b1@college.edu").first()
        if not s1:
            s1 = User(
                id=str(uuid.uuid4()),
                email="aarav.b1@college.edu",
                name="Aarav Patel (Batch 1 Leader)",
                hashed_password=hash_password("student123"),
                role="student",
                department="ECS",
                student_class="Third Year",
                division="Div A",
                batch="Batch 1"
            )
            db.add(s1)

        # Student 2: Rohit (ECS, Third Year, Div A, Batch 3) -> Under Prof. Ananya
        s2 = db.query(User).filter(User.email == "rohit.b3@college.edu").first()
        if not s2:
            s2 = User(
                id=str(uuid.uuid4()),
                email="rohit.b3@college.edu",
                name="Rohit Verma (Batch 3 Leader)",
                hashed_password=hash_password("student123"),
                role="student",
                department="ECS",
                student_class="Third Year",
                division="Div A",
                batch="Batch 3"
            )
            db.add(s2)

        # Student 3: Priya (Instrumentation, Third Year, Div A, Batch 1) -> Under Dr. Rajesh
        s3 = db.query(User).filter(User.email == "priya.inst1@college.edu").first()
        if not s3:
            s3 = User(
                id=str(uuid.uuid4()),
                email="priya.inst1@college.edu",
                name="Priya Nair (Inst Batch 1 Leader)",
                hashed_password=hash_password("student123"),
                role="student",
                department="Instrumentation",
                student_class="Third Year",
                division="Div A",
                batch="Batch 1"
            )
            db.add(s3)

        # Student 4: Siddharth (Instrumentation, Third Year, Div A, Batch 2) -> Under Prof. Ananya
        s4 = db.query(User).filter(User.email == "siddharth.inst2@college.edu").first()
        if not s4:
            s4 = User(
                id=str(uuid.uuid4()),
                email="siddharth.inst2@college.edu",
                name="Siddharth Rao (Inst Batch 2 Leader)",
                hashed_password=hash_password("student123"),
                role="student",
                department="Instrumentation",
                student_class="Third Year",
                division="Div A",
                batch="Batch 2"
            )
            db.add(s4)

        db.commit()

        # Seed Sample Groups with 5 Steps
        # Group 1: Under Rajesh (ECS Div A, Batch 1)
        g1 = db.query(Group).filter(Group.name == "EcoSmart EV Grid").first()
        if not g1:
            g1_id = str(uuid.uuid4())
            g1 = Group(
                id=g1_id,
                name="EcoSmart EV Grid",
                department="ECS",
                student_class="Third Year",
                division="Div A",
                batch="Batch 1",
                invite_code="ECSB1",
                member_names_json=json.dumps(["Aarav Patel", "Diya Sengupta"]),
                member_user_ids_json=json.dumps([s1.id]),
                created_by=s1.id,
                step1_problem_statement="High power surge penalties during noon delivery vehicle charging peaks.",
                step2_market_research="Surveyed 18 campus food vendors; 80% reported late turnaround times.",
                step3_innovative_solution="Dynamic telemetry-controlled automated battery swap hub.",
                step4_feasibility_business_model="Initial Capex $2,400 with 11-month subscription breakeven.",
                step5_marketing_presentation="Direct B2B partner pitches and interactive route simulator."
            )
            db.add(g1)
            score1 = Score(
                id=str(uuid.uuid4()),
                group_id=g1_id,
                innovation=14, feasibility=9, solution=14, presentation=9, total=46,
                remarks="Excellent problem articulation and battery safety analysis.",
                scored_by=fac1.id
            )
            db.add(score1)

        # Group 2: Under Ananya (ECS Div A, Batch 3)
        g2 = db.query(Group).filter(Group.name == "EdgeVision Drone Guard").first()
        if not g2:
            g2_id = str(uuid.uuid4())
            g2 = Group(
                id=g2_id,
                name="EdgeVision Drone Guard",
                department="ECS",
                student_class="Third Year",
                division="Div A",
                batch="Batch 3",
                invite_code="ECSB3",
                member_names_json=json.dumps(["Rohit Verma", "Neha Joshi"]),
                member_user_ids_json=json.dumps([s2.id]),
                created_by=s2.id,
                step1_problem_statement="Solar farm panel defects are undetected for weeks via slow manual inspection.",
                step2_market_research="4 regional solar plants lose ~$4,500/month due to delayed hotspot triage.",
                step3_innovative_solution="Edge AI vision inference on autonomous drones.",
                step4_feasibility_business_model="SaaS subscription of $75/MW/month with 78% software gross margin.",
                step5_marketing_presentation="Recorded field video demo and certified engineer endorsements."
            )
            db.add(g2)
            score2 = Score(
                id=str(uuid.uuid4()),
                group_id=g2_id,
                innovation=13, feasibility=8, solution=13, presentation=8, total=42,
                remarks="Great neural net inference speed on embedded board.",
                scored_by=fac2.id
            )
            db.add(score2)

        # Group 3: Under Rajesh (Instrumentation Div A, Batch 1)
        g3 = db.query(Group).filter(Group.name == "BioSense IoT Triage").first()
        if not g3:
            g3_id = str(uuid.uuid4())
            g3 = Group(
                id=g3_id,
                name="BioSense IoT Triage",
                department="Instrumentation",
                student_class="Third Year",
                division="Div A",
                batch="Batch 1",
                invite_code="INSTB1",
                member_names_json=json.dumps(["Priya Nair", "Kabir Mehta"]),
                member_user_ids_json=json.dumps([s3.id]),
                created_by=s3.id,
                step1_problem_statement="Rural healthcare centers lack multi-parameter telemetry for emergency sepsis triage.",
                step2_market_research="Interviews at 5 primary health centers indicated ICU transfer delays.",
                step3_innovative_solution="Modular biomedical instrumentation hub with optical PPG and LoRaWAN.",
                step4_feasibility_business_model="BOM capped at $180/unit with recurring sensor probe sales.",
                step5_marketing_presentation="Hospital superintendent validation video and clinical roadmap."
            )
            db.add(g3)
            score3 = Score(
                id=str(uuid.uuid4()),
                group_id=g3_id,
                innovation=14, feasibility=9, solution=14, presentation=8, total=45,
                remarks="Sensor telemetry complies with clinical accuracy tolerance.",
                scored_by=fac1.id
            )
            db.add(score3)

        # Group 4: Under Ananya (Instrumentation Div A, Batch 2)
        g4 = db.query(Group).filter(Group.name == "OptiFlow Industrial Sensor").first()
        if not g4:
            g4_id = str(uuid.uuid4())
            g4 = Group(
                id=g4_id,
                name="OptiFlow Industrial Sensor",
                department="Instrumentation",
                student_class="Third Year",
                division="Div A",
                batch="Batch 2",
                invite_code="INSTB2",
                member_names_json=json.dumps(["Siddharth Rao", "Ananya Deshmukh"]),
                member_user_ids_json=json.dumps([s4.id]),
                created_by=s4.id,
                step1_problem_statement="Chemical micro-leakages in pipelines go undetected by slow mechanical flow meters.",
                step2_market_research="Over 14 pharmaceutical plants face regulatory audits for chemical wastage.",
                step3_innovative_solution="Ultrasonic time-of-flight flow instrumentation sensor with Modbus RTU.",
                step4_feasibility_business_model="Hardware unit sold at $320 with cloud calibration warranty.",
                step5_marketing_presentation="Factory floor deployment recording and sensor calibration test certificate."
            )
            db.add(g4)
            score4 = Score(
                id=str(uuid.uuid4()),
                group_id=g4_id,
                innovation=13, feasibility=9, solution=13, presentation=9, total=44,
                remarks="Very reliable ultrasonic transducer circuit design.",
                scored_by=fac2.id
            )
            db.add(score4)

        db.commit()
        print("\nSeed successfully initialized!")
        print("Faculty 1 (Dr. Rajesh): faculty.rajesh@college.edu / faculty123 (ECS B1, B2 & Inst B1)")
        print("Faculty 2 (Prof. Ananya): faculty.ananya@college.edu / faculty123 (ECS B3, B4 & Inst B2)")
        print("Leader ECS B1:          aarav.b1@college.edu       / student123")
        print("Leader ECS B3:          rohit.b3@college.edu       / student123")
        print("Leader Inst B1:         priya.inst1@college.edu    / student123")
        print("Leader Inst B2:         siddharth.inst2@college.edu/ student123")

    finally:
        db.close()

if __name__ == "__main__":
    seed()
