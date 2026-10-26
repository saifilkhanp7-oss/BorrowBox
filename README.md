# BorrowBox

A sharing app for small groups – a hostel block, a college class, an apartment building, an office or a friend group. People borrow from each other instead of buying, and the app keeps track of everything so nothing gets lost and nobody feels awkward to ask.

**Runs on:** Vercel (website + API, free Hobby plan) and Supabase (Postgres database, free plan).
**Built with:** React (Vite) · Node/Express (as one Vercel function) · PostgreSQL.

## What's inside

- **Circles** – private groups with an invite code/link. Nothing is visible outside a circle. The creator is admin.
- **Items** – name, category, condition, condition notes, max days, rules. No photos: each category has its own icon.
- **Video & check reminders** – a message under every "Share" form and on the item page: *take a video before you give it, check the item before you take it*. At handover the owner must tick **"I took a video"** and the borrower must tick **"I checked the item"** before they can confirm.
- **Borrowing** – calendar → request → approve / decline / suggest dates → handover → reminders → extensions → return (*came back fine* / *damaged* + note) → owner updates condition and shares again. While lent out, others see *"Unavailable at this moment"*.
- **My things** – a private list of everything you own, with a counter (total things, different items, how many are shared, count per category). Quick add with a +/− counter, search, and a one-tap "Share in a circle". Items you share are added to the list automatically. Only you can see it.
- **Waitlist, chat per borrow, QR labels, thank-you notes, My Shelf, Wanted board (urgent alerts), Skills & favours, shared circle items.**
- **Giveaways** – free (owner picks) or auction (start price + end time). Payment happens in person, outside the app.
- **Badges** – On-Time Returner, Generous Lender, Helpful Neighbour, Semester Saver, and **💼 Businessperson** (sold 3+ items by auction in the last 6 months; goes away if they stop).
- **Report a problem** – shows the condition record (when shared, at handover with the video/check ticks, at return) to both people; agree on repair / replace / forget it.
- Email-code login with your Apps Script, stays logged in, light/dark mode, works on iPhone and Android.

