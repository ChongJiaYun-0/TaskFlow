# TaskFlow

> A modern task and project management web application built with **HTML, CSS, JavaScript, and Supabase**.

TaskFlow helps users manage personal tasks, group projects, schedules, notifications, and project progress from one responsive workspace.

---

## ✨ Features

### 📊 Dashboard

* Task statistics
* Today's and upcoming tasks
* Task distribution
* Active projects
* Project progress
* Calendar overview

### ✅ Task Management

* Create, edit, and delete tasks
* Complete and cancel tasks
* Search, filter, and sort
* Task priorities
* Due dates and descriptions
* List and card views

### 👥 Group Projects

* Create and manage projects
* Project members
* Project tasks
* Subtasks
* Comments
* Task attachments
* Project progress
* Project timeline

### 📅 Calendar

* Day view
* Week view
* Month view
* Year view
* Task scheduling

### 🔔 Notifications

* Task assignments
* Task updates
* Comments
* Upcoming deadlines
* Project activities
* Read/unread status

### 🔐 Authentication

* User registration
* Login/logout
* Session management
* Protected pages
* Supabase Authentication

### 🎨 UI

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
├── login.html
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
│   ├── tasks
│   ├── projects
│   ├── subtasks
│   ├── comments
│   └── ...
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

Use the **Live Server** extension and open `login.html`.

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

Vercel and Supabase work together directly.

The architecture is:

```text
                    ┌──────────────────┐
                    │      User        │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │      Vercel      │
                    │  TaskFlow Frontend│
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

Therefore:

* Tasks created on Vercel can be stored in Supabase.
* Task updates are saved to Supabase.
* User accounts are handled by Supabase Authentication.
* Comments and subtasks are stored in PostgreSQL.
* Attachments are stored in Supabase Storage.
* Data remains available when users access the application from different devices.

You **do not need a separate backend server just to connect Vercel to Supabase**.

---

## 🔐 Production Configuration

Before deploying, configure your Supabase Authentication settings to include your Vercel production URL.

For example:

```text
Site URL:
https://your-project.vercel.app
```

Also configure any required redirect URLs for authentication.

Make sure your Supabase database has the required tables and RLS policies before allowing users to access production data.

---

## 🧪 Pre-Deployment Checklist

Before publishing TaskFlow, verify:

### Authentication

* [ ] Registration works
* [ ] Login works
* [ ] Logout works
* [ ] Session persists
* [ ] Protected pages redirect correctly

### Tasks

* [ ] Create task
* [ ] Edit task
* [ ] Delete task
* [ ] Complete task
* [ ] Search/filter/sort

### Group Projects

* [ ] Create project
* [ ] Add members
* [ ] Create tasks
* [ ] Create subtasks
* [ ] Add comments
* [ ] Upload attachments
* [ ] View project progress

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

* Google Calendar integration
* Email verification
* Email notifications
* Push notifications
* Recurring tasks
* Real-time collaboration
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

account to login