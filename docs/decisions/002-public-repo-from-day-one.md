# 002 · Make the GitHub repo public from the first commit

- **Decision** — The code lives at `github.com/tmoody1973/earmark`, public, with the MIT license from commit one.
- **Why this came up** — The hackathon accepts a public repo with a visible open-source license, or a private one shared with Amazon's reviewers. The Open Source mini-challenge needs the package public anyway.
- **Options**
  1. *Public from day one* — judges can see a real week of commits; the cost is that unfinished work is visible and any leaked secret is public immediately.
  2. *Private until submission* — hides the messy middle; the cost is remembering to flip it and add the license under deadline pressure.
  3. *Radio Milwaukee's GitHub organization* — station branding; the cost is org approvals and tying a personal entry to the employer.
- **What we chose and why** — Option 1 (Tarik). Visible history is evidence the project was built during the hackathon, and the license requirement is met from the start.
- **What we gave up** — Privacy for half-finished work. A leaked key would be public instantly, so secrets stay in `.env.local` and a secret scanner (gitleaks) runs before every commit.
- **How we'll know if this was right** — The license shows in the repo's About section, and gitleaks never blocks a commit for a real secret (a blocked attempt means the guard worked).
- **What actually happened** —
