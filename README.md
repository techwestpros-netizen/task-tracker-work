# Task Tracker (Firebase Hosting)

This is a **static** Firebase Hosting site (no framework) with:

- **Allow-list login** (Firestore collection `allowedUsers`)
- **Roles**
  - `management`: can add tasks + manage allow-list + delete tasks
  - `user`: can complete tasks + comment
- Tabs: **Open** / **History** / **Management**
- Search bar (filters tasks)

---

## 1) Firebase Console setup

### A) Authentication
In Firebase Console → **Authentication**:
- Enable **Email/Password** sign-in method
- (Optional) Enable **Email link (passwordless)** sign-in method if you want to use the “Sign in by email link” button

### B) Firestore
In Firebase Console → **Firestore Database**:
- Create database (production mode is fine if you add rules)

Create collection:
- `allowedUsers`

Add your own email as the first management user.

**Document ID** should be your email with dots replaced:
- Example email: `weston@example.com`
- Doc ID: `weston@example(dot)com`

Document fields:
```json
{
  "email": "weston@example.com",
  "role": "management"
}
```

### C) Firestore Security Rules (recommended)
In Firestore → Rules, use something like:

- Only allowed users can read tasks
- Only management can create/delete tasks
- Allowed users can update tasks (to complete and comment)
- Only management can write allow-list

**Starter rules** (tight but simple):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function emailDocId(email) {
      return replace(email, '.', '(dot)');
    }

    function isSignedIn() {
      return request.auth != null && request.auth.token.email != null;
    }

    function userAllowed() {
      return isSignedIn() &&
        exists(/databases/$(database)/documents/allowedUsers/$(emailDocId(request.auth.token.email)));
    }

    function isManagement() {
      return userAllowed() &&
        get(/databases/$(database)/documents/allowedUsers/$(emailDocId(request.auth.token.email))).data.role == 'management';
    }

    match /allowedUsers/{id} {
      allow read: if isManagement();
      allow write: if isManagement();
    }

    match /tasks/{taskId} {
      allow read: if userAllowed();
      allow create: if isManagement();
      allow delete: if isManagement();
      allow update: if userAllowed();
    }
  }
}
```

> If you want stricter update rules (e.g., users can only change `status`, `completedBy`, `completedAt`, `comments`), tell me and I’ll lock it down further.

---

## 2) Add your Firebase config

Open `firebase-config.js` and paste your Firebase Web App config values:

Firebase Console → Project settings → Your apps (Web) → Config snippet.

---

## 3) Deploy to Firebase Hosting

Install Firebase CLI if needed:
- `npm i -g firebase-tools`

Login:
- `firebase login`

From this folder, run:
- `firebase init hosting`
  - Use existing project
  - Public directory: `.` (a single dot)
  - Configure as single-page app: **No**
  - Overwrite index.html: **No**

Then deploy:
- `firebase deploy`

Firebase will output your Hosting URL.

---

## Notes

- Allow-list is enforced on every sign-in. If a user is removed from allow-list, they will be blocked next time they sign in.
- Comments are stored on the task document as an array for simplicity.
