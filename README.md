# E&DM Group Project Manager (100% Serverless Firebase Edition)

A high-performance web application designed for **Entrepreneurship & Digital Marketing (E&DM)** supporting two departments: **ECS (Electronics & Computer Science)** and **Instrumentation Engineering**.

The application runs **100% serverless on the Free Firebase Spark Plan** utilizing:
- **Firebase Hosting**: High-speed CDN for static assets
- **Firebase Authentication**: Seamless email & password authentication with auto-provisioning
- **Cloud Firestore**: Real-time NoSQL database with live sync, collections for groups, users, and customer reviews.

**Live Production URL**: [https://entreprenuership-software.web.app](https://entreprenuership-software.web.app)

---

## 🏛️ Academic Structure & Department Allocation

1. **ECS (Electronics & Computer Science)**:
   - Cohort: **Third Year (TE)**
   - Divisions: **Division A** and **Division B**
   - Batches: None (`—`)

2. **Instrumentation Engineering**:
   - Cohort: **Third Year (TE)**
   - Batches: **Batch 1 (B1)** and **Batch 2 (B2)**
   - Divisions: None (`—`)

3. **Faculty Universal Access**:
   - All faculty accounts have full access to inspect, verify, score, and generate certificates for all groups across both departments and all divisions.

---

## 🔑 Demo & Known Accounts

| Name | Role | Department / Allocation | Email | Default Password |
| :--- | :--- | :--- | :--- | :--- |
| **Sumant Deshmukh** | Faculty | Multi-Department (ECS & Inst) | `sumantdeshmukh.in@gmail.com` | *Any password (auto-provisions)* |
| **Abhishek** | Faculty | Multi-Department (ECS & Inst) | `sumantdeshmukh39@gmail.com` | *Any password (auto-provisions)* |
| **Ninad** | Faculty | Multi-Department (ECS & Inst) | `sumant9.cyber@gmail.com` | *Any password (auto-provisions)* |
| **Dr. Rajesh Raman** | Faculty | Multi-Department (ECS & Inst) | `faculty.rajesh@college.edu` | `faculty123` |
| **Prof. Ananya Sen** | Faculty | Multi-Department (ECS & Inst) | `faculty.ananya@college.edu` | `faculty123` |
| **Sumant Sanjay Deshmukh** | Student Leader | ECS Div A | `sd397388@gmail.com` | *Any password (auto-provisions)* |
| **Aarav Patel** | Student Leader | ECS Div A | `aarav.b1@college.edu` | `student123` |
| **Rohit Verma** | Student Leader | ECS Div A | `rohit.b3@college.edu` | `student123` |
| **Priya Nair** | Student Leader | Instrumentation Batch 1 | `priya.inst1@college.edu` | `student123` |
| **Siddharth Rao** | Student Leader | Instrumentation Batch 2 | `siddharth.inst2@college.edu` | `student123` |

---

## 📑 Core Capabilities

1. **Sequential 5-Step Milestone Workflow**:
   - Step 1: Problem Statement & Needs Assessment (10 Pts)
   - Step 2: Market Research & Customer Validation (10 Pts)
   - Step 3: Innovative Solution Architecture (10 Pts)
   - Step 4: Feasibility & Commercial Viability (10 Pts)
   - Step 5: Marketing & Go-to-Market Deck (10 Pts)
   - Total Course Score: 50 Pts

2. **Per-Step Faculty Scoring**:
   - Faculty can enter individual scores for Steps 1–5 (0–10 each).
   - Real-time total calculation out of 50.

3. **Customer Reviews & Ratings**:
   - Public product showcase link allows customers/pilots to submit 1–5 star ratings and reviews.
   - Student dashboard includes live customer reviews and rating analytics.

4. **Product Performance & Growth Potential Report**:
   - Printable executive report displaying project overview, reviews, reach metrics, and Growth Potential Index (0–100%).

5. **Official Capstone Certificate Generation**:
   - Faculty can generate verified, print-ready certificates for individual team members with gold seals and signature lines.

---

## 🚀 Deployment

```bash
firebase deploy --only hosting,firestore:rules
```
  7. Slide Deck / Video Demo link (Canva, Google Slides, Loom, YouTube)

---

## 🏆 Leaderboard Configuration
- **Leaderboard Removed for Students**: Students focus on their own project milestones without leaderboard distraction.
- **Faculty Access**: Faculty retain access to the complete ranked leaderboard filtered by Department and Batch.

---

## 🚀 Running Locally

### 1. Run Server
```bash
python -m uvicorn server:app --host 127.0.0.1 --port 8000
```
Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)** in your browser.

### 2. Seed / Reset Data
```bash
python seed.py
```

### 3. Test Credentials

| Account | Department / Div | Email | Password |
| :--- | :--- | :--- | :--- |
| **Faculty 1 (Dr. Rajesh Raman)** | ECS & Instrumentation | `faculty.rajesh@college.edu` | `faculty123` |
| **Faculty 2 (Prof. Ananya Sen)** | ECS & Instrumentation | `faculty.ananya@college.edu` | `faculty123` |
| **Leader (ECS Batch 1)** | ECS • Div A • B1 | `aarav.b1@college.edu` | `student123` |
| **Leader (ECS Batch 3)** | ECS • Div A • B3 | `rohit.b3@college.edu` | `student123` |
| **Leader (Instrumentation Batch 1)** | Inst • Div A • B1 | `priya.inst1@college.edu` | `student123` |
| **Leader (Instrumentation Batch 2)** | Inst • Div A • B2 | `siddharth.inst2@college.edu` | `student123` |
