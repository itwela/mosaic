import assert from "node:assert/strict";
import { test } from "node:test";
import { detectScreenState, extractApproval } from "../src/lib/agents.ts";

const CLAUDE_TWO = `Do you want to proceed?
1. Yes
2. No, and tell Claude what to do differently`;

const CLAUDE_THREE = `Do you want to proceed?
1. Yes
2. Yes, and don't ask again
3. No, and tell Claude what to do differently`;

const CODEX_NUMBERED = `Would you like to run the following command?
npm test
1. Yes, proceed
2. No, and tell Codex what to do`;

const CODEX_UPLOAD = `Upload to Vercel blob and replace
  the links in /resources?`;

test("Claude two-option menu: Approve is 1, Deny is the No line", () => {
  assert.equal(detectScreenState(CLAUDE_TWO), "attention");
  const offer = extractApproval(CLAUDE_TWO);
  assert.equal(offer.approve, "1\r");
  assert.equal(offer.deny, "2\r");
  assert.match(offer.prompt, /Do you want to proceed\?/);
});

test("Claude three-option menu: Deny is 3, never 'don't ask again'", () => {
  assert.equal(detectScreenState(CLAUDE_THREE), "attention");
  const offer = extractApproval(CLAUDE_THREE);
  assert.equal(offer.approve, "1\r");
  assert.equal(offer.deny, "3\r");
  assert.notEqual(offer.deny, "2\r");
});

test("Codex numbered menu uses the option numbers; the upload sentence is y/n", () => {
  assert.equal(detectScreenState(CODEX_NUMBERED), "attention");
  const numbered = extractApproval(CODEX_NUMBERED);
  assert.equal(numbered.approve, "1\r");
  assert.equal(numbered.deny, "2\r");

  assert.equal(detectScreenState(CODEX_UPLOAD), "attention");
  const upload = extractApproval(CODEX_UPLOAD);
  assert.equal(upload.approve, "y\r");
  assert.equal(upload.deny, "n\r");
  assert.equal(upload.prompt, "Upload to Vercel blob and replace the links in /resources?");
});

test("a wrapped Allow line is the whole question, and does not guess a number", () => {
  const wrapped = "Allow Bash(\nrm -rf public/old-icons\n)?";
  assert.equal(detectScreenState(wrapped), "attention");
  const offer = extractApproval(wrapped);
  assert.equal(offer.prompt, "Allow Bash(rm -rf public/old-icons)?");
  assert.equal(offer.approve, null);
  assert.equal(offer.deny, null);
});

test("Allow WebFetch? with no parentheses is a permission dialog and waits for rows", () => {
  const screen = "Allow WebFetch?";
  assert.equal(detectScreenState(screen), "attention");
  const offer = extractApproval(screen);
  assert.equal(offer.prompt, "Allow WebFetch?");
  assert.equal(offer.approve, null);
  assert.equal(offer.deny, null);
});

test("prose that mentions do you want to is not a live dialog", () => {
  const prose = "I already asked do you want to proceed? The user said yes yesterday.";
  assert.notEqual(detectScreenState(prose), "attention");
  const buried = `${"Allow Bash(rm -rf public/old-icons)?\n"}${"line\n".repeat(30)}esc to interrupt`;
  assert.equal(detectScreenState(buried), "running");
});

test("(a) generic Yes/No lines do not open the card, including under a handbook header", () => {
  const shipped = "1. Yes we shipped the patch\n2. No issues found in CI";
  assert.notEqual(detectScreenState(shipped), "attention");
  const handbook = "From the handbook:\n1. Yes we shipped the patch\n2. No issues found in CI";
  assert.notEqual(detectScreenState(handbook), "attention");
});

test("(b) a header-only Allow prompt arms the card but sends nothing", () => {
  const header = "Allow Bash(rm -rf public/old-icons)?";
  assert.equal(detectScreenState(header), "attention");
  const offer = extractApproval(header);
  assert.equal(offer.approve, null);
  assert.equal(offer.deny, null);
});

test("(c) a Codex menu with the question scrolled off sends 1 and 2", () => {
  const rows = "1. Yes, proceed\n2. No, and tell Codex what to do";
  assert.equal(detectScreenState(rows), "attention");
  const offer = extractApproval(rows);
  assert.equal(offer.approve, "1\r");
  assert.equal(offer.deny, "2\r");
  assert.equal(offer.prompt, "1. Yes, proceed / 2. No, and tell Codex what to do");
  assert.notEqual(offer.prompt, "Waiting for approval");
});

test("one permission-shaped row is not a dialog", () => {
  assert.notEqual(detectScreenState("1. Yes, proceed to chapter two"), "attention");
  assert.notEqual(detectScreenState("1. No, and tell Claude the migration can wait"), "attention");
});

test("(d) Claude's three-option menu: Approve is 1, Deny is 3", () => {
  assert.equal(detectScreenState(CLAUDE_THREE), "attention");
  const offer = extractApproval(CLAUDE_THREE);
  assert.equal(offer.approve, "1\r");
  assert.equal(offer.deny, "3\r");
});
