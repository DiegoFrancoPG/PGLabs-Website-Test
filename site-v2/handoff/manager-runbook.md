# Running a cohort on PGLearn — the manager's runbook

AC-060 requires that a manager can operate the platform **without database
changes**. This is the document that has to make that true. It describes only
what a manager can do from the screens; nothing here asks anyone to run SQL, and
if a task seems to need it, that is a defect to report rather than a step to
improve on.

Everything below is written in the order a real cohort happens.

---

## 1. Signing in

Go to `/login` and sign in with the address the invitation was sent to. If the
password is unknown, use **Forgot password** on that page — an email arrives
with a link that sets a new one.

After signing in you land on `/learn`, which is your own learning. Your
management area is under **Manage** in the main navigation, at `/manage`. If you
manage one organization it opens straight into it.

## 2. Making a cohort

On the organization page (`/manage/<organization>`), *New cohort*, and give it a
name people will recognise — "Spring intake", not "Cohort 2". Open it to invite
people into it, or to import a roster.

A cohort is just a group of people. Nothing is assigned to them yet.

## 3. Getting people into the cohort

Both ways live on the cohort's own page. That is deliberate: somebody invited
into no cohort is somebody nobody is looking after.

**One person at a time.** On the cohort page, *Invite a learner*: their email
address and their name. They receive an invitation, and they appear in the
organization and the cohort immediately, whether or not they have accepted yet.

**A roster.** On the same page, *Import a CSV*. The file needs an `email` column
and a `name` column; a file exported from a spreadsheet without headers is read
as email first, name second.

The import **previews before it does anything**. It tells you how many rows will
be imported, and names every row it cannot use with the line number and the
reason — a missing address, an address that is not one, a missing name, or a
duplicate of a row earlier in the same file. Nothing has happened at that point.
Pressing **Import** carries out exactly the rows the preview showed.

Importing the same file twice is safe: nobody is invited twice, and nobody is
added to the cohort twice.

Two things the import deliberately does **not** do: it does not assign anybody
any learning (that is the next step, a separate and dated decision), and it cannot
import anybody as a manager. A roster is learners.

## 4. Assigning a programme

On the cohort page, **Assign a programme**. You choose:

- the **programme**, from the ones your organization has access to;
- when it **starts**;
- when it is **due**;
- optionally, when **access ends** — after which the material closes. Leave it
  empty for access that does not expire.

Assigning enrolls everybody who is in the cohort at that moment. People added
later are enrolled when you assign again, and nobody is enrolled twice.

The dates are what the reminder emails are built from, so they should be the
real ones.

## 5. Changing the dates afterwards

On the cohort page, the assignment can be edited: new start, due or access-end
dates apply to everybody on it in one action. Learners see the new dates
immediately and the reminder schedule follows them.

Moving a due date **later** does not un-complete anybody or withdraw a
certificate. Moving it **earlier** can make people overdue, which is visible on
the report before anything is sent.

## 6. Watching how it is going

`/manage/<organization>/reports` shows every learner on every assignment:
whether they have started, their percentage, when they were last active, their
due date, and whether they have completed or are overdue.

**Export CSV** produces the same rows as a file, for a board paper or a funder's
report. It opens correctly in Excel, including names with commas and accents.

The report is **scoped to your organization**. You cannot see another
organization's learners, and there is no screen where they could appear.

## 7. What you will be asked, and the answer

**"I can't see the course."** Check the assignment's start date — the material
opens on the start date, not before. If access-end has passed, the material is
closed and the report says so.

**"I finished but there's no certificate."** A certificate is issued when every
**required** class is complete. The learner's row in the report shows their
percentage; the outline on their own page shows which class is outstanding.

**"I lost my place in a video."** Their position is saved as they watch, on the
device they were watching on. Playing from another device continues from the
furthest point the system recorded.

**"Can you delete my chat with the tutor?"** Tutor conversations are deleted
automatically after thirty days. No manager can read them at any point — not
yours to delete, and not yours to read.

## 8. What a manager cannot do, on purpose

- **Create or edit programmes.** Content belongs to the platform administrator.
- **See tutor conversations, or per-person tutor questions.** Ever.
- **See another organization.** Including one you used to manage.
- **Promote anybody to manager.** Ask the platform administrator.
- **Remove the last manager of an organization** — including yourself. The
  organization would be left with nobody able to run it.

## 9. When to ask for help

Report these to the platform administrator rather than working around them:

- a learner who cannot sign in after using **Forgot password** twice;
- an assignment that will not accept dates you believe are valid;
- a report figure you believe is wrong — with the cohort, the person and what
  you expected, so it can be checked against the record;
- anything that asks you to enter something you do not understand.

**Nothing in this runbook needs the database.** If a task turns out to require
it, that is what AC-060 calls a gate defect, and it is recorded rather than
performed quietly.
