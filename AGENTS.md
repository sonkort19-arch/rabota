# Codex / contributor instructions — CRM «Работа»

## Project safety boundaries
- `main` and Vercel Production are live. Do not commit, merge, deploy, promote, or roll back Production without explicit, separate owner approval.
- The live Supabase project is `ma-svyaz-2` (`yedzfmibceboncrytbqz`). Never create, update, delete, or backfill live orders, clients, users, roles, messages, or finance data for tests.
- Never point preview or test automation at a writable production database. Existing Vercel Previews may use the live Supabase project.
- Do not create paid Supabase branches or other billable testing resources without separate owner approval.
- Use a separate feature branch and draft pull request. Do not push changes directly to `main`.
- Keep credentials and personal client data out of source files, logs, test snapshots, and PR comments.

## Mandatory checks for every code change
1. Before making changes, identify the relevant existing files and test coverage.
2. Run the affected tests after each change, then run the complete offline suite before proposing a merge:
   ```bash
   for file in *.js api/*.js tests/*.js; do node --check "$file" || exit 1; done
   node --test tests/*.js
   ```
3. Add or update regression tests when changing order handling, calendar, permissions, payments, notifications, or UI controls.
4. If any check fails, report the command, exact error, affected file, and whether it is new or pre-existing. Do not describe a failing or unrun suite as passing.
5. GitHub Actions `CRM safe checks` runs the same offline checks on pushes and pull requests. Treat a failing check as a stop signal; never suggest merging or releasing until it is addressed.

## Test scope and releases
- Existing `tests/` scripts are synthetic, local and should run without network, browser login, secrets or production database access.
- Passing offline tests does NOT certify real browser/mobile layout, role-based Supabase RLS, AI microphone, push delivery, or actual payments.
- Live browser E2E tests that write data require an isolated database containing only synthetic fixtures, explicitly authorized by the owner.
- Do not modify the application's live data, Vercel settings, Supabase schema, deployment configuration, or production secrets as part of an automated code check.
- Summarize changed files, successful/failed checks and remaining manual verification in each pull request.
