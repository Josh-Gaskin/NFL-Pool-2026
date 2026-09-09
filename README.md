# The Pool — NFL Pick 'Em Dashboard

A live-updating, single-page dashboard for a 5-person NFL pool: everyone
drafts 5 teams, 10 points per win, 5 per tie, most points at season's end
wins. It has three tabs:

- **Standings & Teams** — live points, rosters, unused teams, transaction feed
- **Weekly Results** — every week's games, laid out score by score
- **Admin** — PIN-gated: set rosters, record swaps/trades, sync scores

It's a static site (no server) — Firebase Firestore holds the data, GitHub
Pages hosts the files, and scores sync from ESPN's free public scoreboard.

## What you'll set up (about 15 minutes)

1. A Firebase project (free tier is plenty for this)
2. Firestore Database + Firebase Authentication (Email/Password provider — see the PIN note below)
3. This code pushed to a GitHub repo, served via GitHub Pages

---

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → give it a name (e.g. `office-nfl-pool`) → finish the wizard (you can skip Google Analytics).
2. In your new project, click the **`</>`** (web) icon to register a web app. Name it anything. **Don't** check "set up Firebase Hosting" — you're using GitHub Pages instead.
3. Firebase shows you a `firebaseConfig` object. Copy it into `js/firebase-config.js` in this project, replacing the placeholder values.

## 2. Turn on Firestore

1. In the Firebase console sidebar: **Build → Firestore Database → Create database**.
2. Choose **Start in production mode**, pick any region close to you.
3. Once created, go to the **Rules** tab and replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Anyone with the link can read (it's a friends' pool page).
    match /{document=**} {
      allow read: if true;
    }
    // Only the commissioner's PIN-derived login can write.
    allow write: if request.auth != null
      && request.auth.token.email == "commissioner@nflpool.local";
  }
}
```

Click **Publish**. That email string is a fixed constant baked into the code
(`ADMIN_EMAIL` in `js/firebase-config.js`) — it's never shown anywhere in the
UI, it just needs to match exactly between here and that file. You can pick
your own value if you want, just keep the two in sync.

## 3. Turn on Authentication (this is what powers the PIN)

1. **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Email/Password**.

That's it — no user to create by hand. The Admin tab only ever shows a
4-digit PIN box; the first time anyone opens it, it detects there's no PIN
set yet and lets you create one right there in the browser. From then on,
that same tab asks for the PIN to unlock. Under the hood it's really signing
in to the fixed `ADMIN_EMAIL` account with a password derived from your PIN,
which is what lets Firestore's rule (above) tell real writes from anyone
else poking at the database.

**Important:** because it's first-come-first-served, set your PIN the moment
your site goes live — *before* you send the link to anyone. If somebody else
ever seems to grab it first, or you forget your own PIN, go to **Build →
Authentication → Users**, delete the `commissioner@nflpool.local` row, and
set a fresh PIN from the Admin tab.

This is a lightweight home-pool security model, appropriate for a group of
friends — not bank-grade. The upside is nobody needs an email or account of
their own; the whole group just uses the one link, and only your PIN unlocks
edits.

## 4. Push to GitHub and enable Pages

1. Create a new repo on GitHub (public or private — either works with Pages).
2. Push all the files in this project to it:
   ```
   git init
   git add .
   git commit -m "NFL pool dashboard"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
3. On GitHub: repo → **Settings → Pages** → under "Build and deployment", set **Source** to `Deploy from a branch`, branch `main`, folder `/ (root)`. Save.
4. GitHub gives you a URL like `https://YOUR_USERNAME.github.io/YOUR_REPO/`. That's the one link — send it to everyone, including yourself. The Admin tab lives right on the same page.

It can take a minute or two to go live the first time.

## 5. Set up this season's pool

1. Open your live site, click the **Admin** tab, and set your 4-digit PIN (see the note above — do this before sharing the link).
2. **Set up players**: enter your 5 friends' names, save.
3. **Team assignments**: assign each player their 5 teams, one at a time (25 total). The remaining 7 stay in the unused pool automatically. This tool doesn't count against anyone's transaction limit — it's for draft day and for fixing mistakes.
4. **Current week**: set it to 1 (or whatever week you're starting from).
5. You're live. Send the link around.

## Running it week to week

- Each week, once games are done, open the admin page and hit **Sync scores
  for week N from ESPN**. It pulls final results and updates everyone's points.
- Then bump **Current week** up by one for the next slate.
- If someone wants to swap or trade a team, do it from the admin page before
  that week's games start — the tool won't stop you from doing it late, so
  that part's on the honor system, same as verifying trades were agreed to.
- Each player has a hard cap of 5 swaps/trades for the season; the admin
  page tracks usage and warns you if someone's out.

## Notes and limitations worth knowing

- **ESPN's API is free and public but unofficial** — it's not a paid,
  documented product, just the feed espn.com's own site uses. It's reliable
  in practice, but if it ever changes shape, the sync button will just come
  back empty and you can enter results by hand with the **Manual score
  override** box on the admin page.
- **Firestore free tier** covers this comfortably — a 5-person pool checking
  scores a few times a week is a tiny fraction of the free daily quota.
- **The "effective week" you set on a swap/trade determines credit**: points
  a team earned before the swap stay with the original owner, points after
  go to the new owner. Set it to the week the change actually takes effect.
- If you ever need to undo a bad entry, you can delete documents directly in
  the Firestore console (**Build → Firestore Database → Data**) — the
  `assignments`, `transactions`, and `weeklyResults` collections are all
  editable there in a pinch.
