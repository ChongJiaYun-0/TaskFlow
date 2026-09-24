# TaskFlow

> A modern task and project management web application built with **HTML, CSS, JavaScript, and Supabase**.

TaskFlow helps users manage personal tasks, collaborate on group projects, organize subtasks, track progress, and receive notifications from one responsive workspace.

---

## ✨ Features

### 📊 Dashboard

* Task statistics
* Today's and upcoming tasks
* Task distribution
* Active projects
* Project progress
* Calendar overview

---

## 👤 Personal Features

TaskFlow allows users to manage their own personal tasks independently.

* Create, edit, and delete personal tasks
* Set task priority and due dates
* Add task descriptions
* Update task status
* Mark tasks as completed
* Cancel tasks
* Search, filter, and sort tasks
* View tasks in List or Card mode
* View tasks through the calendar
* Receive notifications for task-related activities

Personal tasks are separate from group projects and are managed by the individual user.

---

## 👥 Group Project Features

TaskFlow uses a three-level structure for group collaboration:

```text
Project
   │
   ├── Task 1
   │      ├── Subtask 1
   │      ├── Subtask 2
   │      └── Subtask 3
   │
   ├── Task 2
   │      ├── Subtask 1
   │      └── Subtask 2
   │
   └── Task 3
          └── Subtask 1
```

### 📁 Project

A **Project** represents the main piece of work being completed by a group.

For example:

```text
Project: Website Development
```

A project can contain multiple tasks.

The person who creates the project becomes the **Project Leader**.

#### Project Leader Permissions

The Project Leader can:

* Add members to the project
* Manage project members
* Set the project status
* Monitor overall project progress
* Create and manage project tasks

Only the **Project Leader** can add members and change the project status.

---

### ✅ Task

A **Task** represents a specific piece of work inside a project.

For example:

```text
Project: Website Development

Task:
Create Login Page
```

A project can contain many tasks.

The person who creates a task becomes the **Task Assignor**.

#### Task Assignor

The Task Assignor can:

* Create the task
* Assign the task to a project member
* Assign the task to themselves
* Edit the task
* Delete the task

A task can only be assigned to:

* A member of the project
* The person who created the task

This prevents tasks from being assigned to users outside the project.

---

### 👤 Task Group Leader & Members

Each task can have people responsible for completing it.

The **Task Group Leader** and assigned **Task Members** can:

* Mark the task as completed
* Mark subtasks as completed
* View task progress
* Work on assigned subtasks
* Add comments
* Add attachments

This allows multiple project members to collaborate on the same task.

---

### 📝 Subtasks

A **Subtask** represents smaller steps or details required to complete a task.

For example:

```text
Task: Create Login Page

Subtasks:
├── Design login interface
├── Create login form
├── Connect Supabase Authentication
├── Test login validation
└── Test logout functionality
```

Subtasks help the team break a large task into smaller steps so that important details are less likely to be missed.

All project members can:

* Add subtasks
* Edit subtasks
* Mark subtasks as completed
* Add attachments
* Follow the progress of subtasks

---

### 💬 Comments

Project members can communicate directly inside tasks.

Members can:

* Add comments
* Edit comments
* Discuss task progress
* Provide updates or additional information
* Attach files when necessary

Comments help keep task-related communication together with the relevant task.

---

### 📎 Attachments

Attachments can be added to tasks, subtasks, and comments.

Subtask attachments can also be used to keep track of different versions of files.

For example:

```text
Subtask: Design Homepage

Attachments:
├── homepage-v1.pdf
├── homepage-v2.pdf
└── homepage-final.pdf
```

This makes it easier for team members to follow file changes and identify the latest version.

Files are stored in **Supabase Storage**, while attachment information is stored in the `task_attachments` table.

---

### 🗑 Task Deletion

When a task is deleted:

```text
Task
 ├── Subtask 1
 ├── Subtask 2
 ├── Subtask 3
 └── Attachments
```

The related subtasks are also deleted.

Attachments associated with the deleted task or its subtasks cannot be recovered through TaskFlow.

> ⚠️ Users should make sure important files are backed up before deleting a task.

---

## 📅 Calendar

* Day view
* Week view
* Month view
* Year view
* Task scheduling
* Task due dates

---

## 🔔 Notifications

TaskFlow provides notifications for:

* Task assignments
* Task updates
* Comments
* Upcoming deadlines
* Project activities
* Completed tasks
* Read/unread status

---

## 🔐 Authentication

* User registration
* Login/logout
* Session management
* Protected pages
* Supabase Authentication

---

## 🎨 UI

* Responsive design
* Light and dark themes
* Modern dashboard interface
* Mobile, tablet, and desktop support

---

## 🛠 Technology Stack

**Frontend**

* HTML5
* CSS3
* JavaScript (ES6+)

**Backend**

* Supabase
* PostgreSQL
* Supabase Authentication
* Supabase Storage

**Deployment**

* Vercel

---

## 📁 Project Structure

```text
TaskFlow/
│
├── index.html
├── login.html
├── register.html
├── dashboard.html
├── personal.html
├── group.html
├── notifications.html
├── profile.html
│
├── app.js
├── dashboard.js
├── personal.js
├── group.js
├── notifications.js
├── profile.js
├── taskModal.js
├── styles.css
│
├── README.md
└── ...
```

---

## 🎨 Design System

TaskFlow uses a soft and professional color palette.

| Color        | HEX       | Usage                   |
| ------------ | --------- | ----------------------- |
| Cream        | `#FDF4D2` | Main background         |
| Powder Blue  | `#B0CDE6` | Secondary accents       |
| Muted Purple | `#A290B7` | Highlights and progress |
| Dusty Brown  | `#946D6D` | Primary actions         |

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone YOUR_REPOSITORY_URL
cd TaskFlow
```

### 2. Configure Supabase

TaskFlow uses Supabase for authentication, database storage, and file attachments.

The frontend requires:

```text
Supabase Project URL
Supabase Publishable / Anon Key
```

Example:

```javascript
const SUPABASE_URL = "https://your-project.supabase.co";
const SUPABASE_ANON_KEY = "your-publishable-key";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);
```

> ⚠️ Never expose a Supabase `service_role` key, database password, or other secret keys in frontend code.

---

## 🗄 Supabase

TaskFlow stores application data in Supabase PostgreSQL.

Main tables include:

```text
profiles
projects
project_members
tasks
task_assignments
subtasks
comments
notifications
task_attachments
```

TaskFlow also uses **Supabase Storage** for uploaded files.

```text
Supabase
│
├── PostgreSQL
│   ├── profiles
│   ├── projects
│   ├── project_members
│   ├── tasks
│   ├── subtasks
│   ├── comments
│   ├── notifications
│   └── task_attachments
│
└── Storage
    └── task-attachments
```

Row Level Security (RLS) should be enabled to control which users can access application data.

---

## 💻 Local Development

TaskFlow is a static frontend application and does not require a build process.

For local development, use a local HTTP server.

### VS Code

Use the **Live Server** extension and open `index.html`.

### Python

```bash
python -m http.server 5500
```

Then visit:

```text
http://localhost:5500
```

---

## 🌐 Deployment

TaskFlow can be deployed directly to **Vercel**.

### Deploy with Vercel

1. Push the project to GitHub.
2. Import the repository into Vercel.
3. Select **Other** as the framework if required.
4. Deploy the project.

For a static HTML/CSS/JavaScript project:

```text
Framework Preset: Other
Build Command: None
Output Directory: .
Install Command: None
```

After deployment, Vercel will provide a URL such as:

```text
https://your-project.vercel.app
```

---

## 🔗 Vercel + Supabase

Vercel hosts the TaskFlow frontend, while Supabase provides the backend services.

```text
                    ┌──────────────────┐
                    │      User        │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │      Vercel      │
                    │ TaskFlow Frontend│
                    └────────┬─────────┘
                             │
                  Supabase JavaScript API
                             │
                             ▼
                    ┌──────────────────┐
                    │     Supabase     │
                    ├──────────────────┤
                    │ Authentication   │
                    │ PostgreSQL       │
                    │ Storage          │
                    └──────────────────┘
```

This allows TaskFlow to:

* Store tasks and projects in Supabase
* Synchronize application data through Supabase
* Manage user accounts with Supabase Authentication
* Store comments and subtasks in PostgreSQL
* Store uploaded files in Supabase Storage
* Access the same data across different devices

A separate backend server is not required for the current architecture.

---

## 🔐 Production Configuration

Before deploying TaskFlow, configure Supabase Authentication with the Vercel production URL.

For example:

```text
Site URL:
https://your-project.vercel.app
```

Also configure any required authentication redirect URLs.

Make sure:

* Required database tables exist
* RLS policies are enabled
* Storage policies are configured
* The `task-attachments` bucket exists
* Authentication redirects use the correct production URL

---

## ⚠️ Known Limitation

Because TaskFlow connects directly to Supabase, some pages may occasionally take a moment to load while the application establishes the connection and retrieves data.

In some situations, the application may require a page refresh before all Supabase data is displayed correctly.

This is a known limitation of the current implementation and may be improved in a future version through better loading states, connection handling, and error recovery.

---

## 🧪 Pre-Deployment Checklist

### Authentication

* [ ] Registration works
* [ ] Login works
* [ ] Logout works
* [ ] Session persists
* [ ] Protected pages redirect correctly

### Personal Tasks

* [ ] Create task
* [ ] Edit task
* [ ] Delete task
* [ ] Complete task
* [ ] Search/filter/sort

### Group Projects

* [ ] Create project
* [ ] Add project members
* [ ] Create tasks
* [ ] Assign tasks
* [ ] Create subtasks
* [ ] Mark tasks/subtasks as completed
* [ ] Add comments
* [ ] Upload attachments
* [ ] View project progress
* [ ] Delete tasks and related subtasks

### Production

* [ ] Supabase URL configured
* [ ] Publishable/Anon key configured
* [ ] RLS enabled
* [ ] Storage bucket configured
* [ ] Vercel domain added to Supabase Auth
* [ ] Test on desktop and mobile

---

## 🔮 Future Improvements

Potential future features:

* Microsoft Teams integration
* Google Calendar integration
* Email verification
* Email notifications
* Push notifications
* Recurring tasks
* Real-time collaboration improvements
* Drag-and-drop task management
* Advanced project analytics
* Role-based permissions
* Audit logs
* PWA/offline support
* AI task recommendations
* Mobile application

---

## 📜 License

This project is intended for educational, development, and demonstration purposes.

```text
MIT License
```

---

## ❤️ TaskFlow

**Plan. Organize. Collaborate. Complete.**

Built with:

```text
HTML • CSS • JavaScript • Supabase • PostgreSQL • Vercel
```
