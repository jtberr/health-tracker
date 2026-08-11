import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * QA-REVIEWER independent "mechanical decay guard" for the app-wide autofill/password-manager
 * hygiene convention (Phase 8b cross-cutting pass).
 *
 * Written from docs/architecture/food-weight-tracker.md §3.4 ("Autofill / password-manager
 * hygiene -- an app-wide markup convention") and §6's row: *"A mechanical decay guard, not a
 * reviewer's memory: grep src/ for <input>/<select>/<textarea> and assert each occurrence has an
 * explicit autoComplete -- this is what catches the *next* control someone adds without one.
 * Report the count, so a future reviewer can see it move."*
 *
 * SOURCE-level by design (it IS the decay guard); the rendered-attribute assertions live in the
 * Playwright suites. Comments are stripped first, since this codebase's doc comments mention
 * `<select>`/`<form>` constantly.
 *
 * EXPLICIT LIMITATION, per §6: this proves the MARKUP only. Neither this nor the Playwright suite
 * can prove "no password manager prompts" -- the test browser has no extension installed and
 * headless heuristics differ from a real profile. That check belongs to Jeff's manual pass.
 */

const SRC = path.resolve(__dirname, "..", "..");
const CONTROL_TAG = /<(input|select|textarea)(?=[\s/>])/gi;
const FORM_TAG = /<form(?=[\s/>])/gi;

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function sourceFiles(): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      // Application source only -- test files are not user-facing markup.
      else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(p);
    }
  })(SRC);
  return out.sort();
}

/** Strips block and line comments so doc-comment mentions of `<select>` aren't counted as markup. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

type Occurrence = { file: string; line: number; tag: string; autoComplete: string | null };

function findTags(re: RegExp): Occurrence[] {
  const found: Occurrence[] = [];
  for (const file of sourceFiles()) {
    const stripped = stripComments(fs.readFileSync(file, "utf8"));
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      let i = m.index + m[0].length;
      let depth = 0;
      while (i < stripped.length) {
        const c = stripped[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
        i++;
      }
      const tag = stripped.slice(m.index, i + 1);
      const ac = /autoComplete=(?:"([^"]*)"|\{"([^"]*)"\})/.exec(tag);
      found.push({
        file: toPosix(path.relative(SRC, file)),
        line: stripped.slice(0, m.index).split("\n").length,
        tag: tag.replace(/\s+/g, " ").slice(0, 120),
        autoComplete: ac ? (ac[1] ?? ac[2]) : null,
      });
    }
  }
  return found;
}

/**
 * The `/meals` components (`MealForm.tsx`, `MealItemForm.tsx`, `MealsView.tsx`) were previously
 * excluded from Phase 8b's sweep and left unswept through Phase 8c too -- design doc §3.4 always
 * named all three files' controls as in-scope for the convention. Closed as its own fix-up
 * (qa-review N-2) alongside the `MealList.tsx` "Log this meal" surface, which was already covered
 * because it renders `LogMealDialog` (already swept in Phase 8b). This list stays here, now empty,
 * so a future regression shows up as a concrete file added back to it rather than a silent
 * loosening of the assertions below.
 */
const KNOWN_UNSWEPT: string[] = [];

describe("autofill hygiene -- mechanical decay guard over src/", () => {
  const controls = findTags(CONTROL_TAG);
  const forms = findTags(FORM_TAG);

  it("reports the current counts (a future reviewer should see these move)", () => {
    const withAc = controls.filter((c) => c.autoComplete !== null);
    console.log(
      `[autofill guard] controls=${controls.length} withAutoComplete=${withAc.length} ` +
        `forms=${forms.length} formsWithAutoComplete=${forms.filter((f) => f.autoComplete !== null).length}`,
    );
    expect(controls.length).toBeGreaterThan(30);
    expect(forms.length).toBeGreaterThan(5);
  });

  it("every control outside the known-unswept /meals files has an explicit autoComplete", () => {
    const missing = controls
      .filter((c) => c.autoComplete === null)
      .filter((c) => !KNOWN_UNSWEPT.includes(c.file))
      .map((c) => `${c.file}:${c.line} ${c.tag}`);
    expect(missing).toEqual([]);
  });

  it("every <form> outside the known-unswept /meals files carries autoComplete=off (default-deny)", () => {
    const bad = forms
      .filter((f) => !KNOWN_UNSWEPT.includes(f.file))
      .filter((f) => f.autoComplete !== "off")
      .map((f) => `${f.file}:${f.line} autoComplete=${f.autoComplete}`);
    expect(bad).toEqual([]);
  });

  it("the ONLY non-off values are the identity fields on the two auth forms", () => {
    const nonOff = controls
      .filter((c) => c.autoComplete !== null && c.autoComplete !== "off")
      .map((c) => `${c.file} => ${c.autoComplete}`)
      .sort();
    expect(nonOff).toEqual([
      "app/(auth)/login/LoginForm.tsx => current-password",
      "app/(auth)/login/LoginForm.tsx => email",
      "app/(auth)/signup/SignupForm.tsx => email",
      "app/(auth)/signup/SignupForm.tsx => new-password",
      "app/(auth)/signup/SignupForm.tsx => new-password",
    ]);
  });

  it("FIXED (was pinned as a FINDING): the /meals controls §3.4 names are now fully swept", () => {
    const unsweptFiles = controls
      .filter((c) => c.autoComplete === null)
      .map((c) => c.file)
      .filter((f, i, a) => a.indexOf(f) === i)
      .sort();
    const unsweptForms = forms
      .filter((f) => f.autoComplete !== "off")
      .map((f) => f.file)
      .filter((f, i, a) => a.indexOf(f) === i)
      .sort();
    // Regression guard: this must stay empty. If a file shows up here, the /meals autofill fix
    // (qa-review N-2) has regressed.
    expect(unsweptFiles).toEqual([]);
    expect(unsweptForms).toEqual([]);
  });
});
