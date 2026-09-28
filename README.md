# E&DM Group Project Manager

A tailored full-stack web application designed for **Entrepreneurship & Digital Marketing (E&DM)** supporting two departments: **ECS (Electronics & Computer Science)** and **Instrumentation Engineering**.

---

## 🏛️ Academic Structure & Roles

### 1. Two Departments & Divisions
- **ECS (Electronics & Computer Science)**: Includes **Division A** and **Division B**.
- **Instrumentation Engineering**: Standard cohort.

### 2. Two Dedicated Faculty Accounts
- **Faculty 1 (ECS)**: `faculty.ecs@college.edu` / `faculty123`
- **Faculty 2 (Instrumentation)**: `faculty.inst@college.edu` / `faculty123`
- *Faculty can filter groups by Department (ECS / Instrumentation) and Division (Div A / Div B), and inspect the complete narrative of every milestone step for every team.*

### 3. Student Registration & Group Leader Flow
- When a student registers, they select their **Department** and **Division**.
- **Leader Registration**: The student who creates the group is automatically recorded as the **Group Leader** with an indicator badge.
- **Teammate Enrollment**: Teammates can join the leader's group using a unique 6-character Invite Code (e.g. `ECSA01`).
- **Student Dashboard ("My Project Dashboard")**:
  The Group Leader and enrolled teammates can collaboratively draft, review, and save all **5 sequential project steps**. Changes sync in real-time across teammates and faculty.

---

## 📑 The 5-Step Entrepreneurial Project Workflow

| Step # | Milestone Phase | Rubric Criteria | Max Marks |
| :---: | :--- | :--- | :---: |
| **Step 1** | **Problem Statement & Market Need** | Innovation | 15 Pts |
| **Step 2** | **Market Research & Customer Validation** | Feasibility + Innovation | 10 Pts |
| **Step 3** | **Innovative Solution & Technical Prototype** | Solution | 15 Pts |
| **Step 4** | **Feasibility Study, Unit Economics & Business Model** | Feasibility | 10 Pts |
| **Step 5** | **Digital Marketing, Go-To-Market & Pitch Presentation** | Presentation | 10 Pts |
| **Total** | **Comprehensive Course Score** | **Clamped & Validated** | **50 Pts** |

---

## 🔒 Per-Step Verification & Progression Gating
- **Faculty Per-Step Review**: In the Faculty Evaluation Dashboard, instructors can review each step submission independently and mark it as **Approved** or **Request Changes** with customized feedback remarks.
- **Strict Step Gating**: Students can only advance and submit **Step N** once **Step N-1** has been marked and **Approved** by the faculty.
- **Locked Indicators**: Step cards dynamically display lock badges and clear explanations when waiting on faculty verification.

---

## 💰 ₹1,00,000 Budget Planner
- **Budgetary Cap**: A strict ₹1,00,000 allocation tool enables student teams to manage prototyping, hardware, software/cloud, testing, and digital marketing expenses.
- **Interactive Planner**: Features a visual utilization bar, category breakdown, cost per item, and remaining balance counter with server-side validation.

---

## 🎙️ High-Impact Pitching Strategy Framework
- **Structured Pitch Deck**: Built directly into the student dashboard covering:
  1. The 10-second Hook & Tagline
  2. Urgent Customer Pain Point
  3. Solution USP & Technical Moat
  4. Target Market (TAM/SAM) & Beachhead Customer
  5. Business Model & Monetization Channels
  6. The Ask & ₹1 Lakh Milestone Allocation
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
