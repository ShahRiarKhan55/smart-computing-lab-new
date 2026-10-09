/**
 * Unit checks for the unpublished-people helpers (Phase 27): author-line redaction and the search guard.
 *
 *   tsx scripts/unit-hidden-people.test.ts
 */
import { mayMatchAuthorText, personVisible, redactNames, selfProfileIdIfNeeded, visibleAttribution } from "../src/lib/hiddenPeople.js";

let ok = 0;
const failures: string[] = [];
const eq = (name: string, got: unknown, want: unknown) => (got === want ? ok++ : failures.push(`${name} -- got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

const H = ["Jane Doe"];
eq("no hidden names: unchanged", redactNames("A, Jane Doe, B", []), "A, Jane Doe, B");
eq("name not present: unchanged (same string)", redactNames("A, B", H), "A, B");
eq("middle", redactNames("Ann Lee, Jane Doe, Bob Ray", H), "Ann Lee, Bob Ray");
eq("first", redactNames("Jane Doe, Ann Lee, Bob Ray", H), "Ann Lee, Bob Ray");
eq("last", redactNames("Ann Lee, Bob Ray, Jane Doe", H), "Ann Lee, Bob Ray");
eq("only author", redactNames("Jane Doe", H), "");
eq("'and' list, hidden last", redactNames("Ann Lee, Bob Ray and Jane Doe", H), "Ann Lee, Bob Ray");
eq("'and' list, hidden first", redactNames("Jane Doe and Ann Lee", H), "Ann Lee");
eq("ampersand", redactNames("Ann Lee & Jane Doe", H), "Ann Lee");
eq("semicolons", redactNames("Ann Lee; Jane Doe; Bob Ray", H), "Ann Lee; Bob Ray");
eq("case-insensitive and flexible whitespace", redactNames("Ann Lee, jane   DOE", H), "Ann Lee");
eq("whole-word only (no partial hit)", redactNames("Jane Doezer, Ann Lee", H), "Jane Doezer, Ann Lee");
eq("two hidden names", redactNames("Jane Doe, Ann Lee, Max Roe", ["Jane Doe", "Max Roe"]), "Ann Lee");
eq("regex metacharacters in a name are literal", redactNames("Ann, J. (Doe), Bob", ["J. (Doe)"]), "Ann, Bob");
eq("Japanese list", redactNames("山田太郎、鈴木花子、佐藤次郎", ["鈴木花子"]), "山田太郎、佐藤次郎");

eq("search guard: unrelated term may match the line", mayMatchAuthorText("graphene", H), true);
eq("search guard: term inside a hidden name may not", mayMatchAuthorText("jane", H), false);
eq("search guard: term containing a hidden name may not", mayMatchAuthorText("jane doe paper", H), false);
eq("search guard: no hidden names", mayMatchAuthorText("jane", []), true);

// ---- attributions ---------------------------------------------------------------------------------------------------------------
const guest = null;
const member = { id: "u1", email: "m@example.test", role: "MEMBER" } as never;
const manager = { id: "u2", email: "x@example.test", role: "LAB_MANAGER" } as never;
const admin = { id: "u3", email: "a@example.test", role: "ADMIN" } as never;
const pubP = { id: "t1", name: "Pub", isPublished: true };
const hidP = { id: "t2", name: "Hid", isPublished: false };
eq("published person is shown to a guest", visibleAttribution(guest, pubP, null)?.name, "Pub");
eq("hidden person is not shown to a guest", visibleAttribution(guest, hidP, null), null);
eq("hidden person is not shown to another member", visibleAttribution(member, hidP, "t9"), null);
eq("hidden person is shown to themself", visibleAttribution(member, hidP, "t2")?.id, "t2");
eq("hidden person is shown to a manager", visibleAttribution(manager, hidP, null)?.id, "t2");
eq("hidden person is shown to an admin", visibleAttribution(admin, hidP, null)?.id, "t2");
eq("an attribution never carries more than id and name", JSON.stringify(visibleAttribution(guest, { ...pubP, extra: "x" } as never, null)), '{"id":"t1","name":"Pub"}');
eq("null person -> null", visibleAttribution(guest, null, null), null);
eq("a missing isPublished fails closed (hidden)", personVisible(guest, { id: "t1" } as never, null), false);
eq("no lookup for a guest", await selfProfileIdIfNeeded(guest, [hidP]), null);
eq("no lookup for a manager", await selfProfileIdIfNeeded(manager, [hidP]), null);
eq("no lookup when everyone is published", await selfProfileIdIfNeeded(member, [pubP, null, undefined]), null);

console.log(`${ok} hidden-people unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
