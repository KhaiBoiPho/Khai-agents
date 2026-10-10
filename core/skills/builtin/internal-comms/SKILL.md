---
name: internal-comms
description: Write internal company communications in proven formats — 3P updates (progress/plans/problems), status and leadership updates, project updates, company newsletters, FAQ answers, incident reports. Use whenever the user asks for one of these or a similar team/company announcement.
license: Apache-2.0 (adapted from anthropics/skills internal-comms; see LICENSE.txt)
---

# Internal comms

1. **Identify the type** from the request.
2. **Read the matching guide** in `examples/`:
   - `examples/3p-updates.md` — progress / plans / problems team updates
   - `examples/company-newsletter.md` — company-wide newsletters
   - `examples/faq-answers.md` — answering frequently asked questions
   - `examples/general-comms.md` — status reports, leadership or project
     updates, incident reports and anything else
3. **Gather facts** with whatever sources Khai has connected (chat, mail,
   docs, calendar, tracker MCP tools). If none are connected, ask the user
   for the facts and say that connected sources would improve the result.
   Never invent metrics, names or dates.
4. **Write** following the guide's format and tone. Deliver in chat unless the
   user wants a file; for a file use the office-docx skill.

If the type matches no guide and the format is unclear, ask for an example or
the intended audience before writing.
