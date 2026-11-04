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

test("a wrapped Allow line is the whole question, not its last line", () => {
  const wrapped = "Allow Bash(\nrm -rf public/old-icons\n)?";
  assert.equal(detectScreenState(wrapped), "attention");
  assert.equal(extractApproval(wrapped).prompt, "Allow Bash(rm -rf public/old-icons)?");
  assert.equal(extractApproval(wrapped).approve, "1\r");
  assert.equal(extractApproval(wrapped).deny, "2\r");
});

test("Allow WebFetch? with no parentheses is a permission dialog", () => {
  const screen = "Allow WebFetch?";
  assert.equal(detectScreenState(screen), "attention");
  assert.equal(extractApproval(screen).prompt, "Allow WebFetch?");
});

test("prose that mentions do you want to is not a live dialog", () => {
  const prose = "I already asked do you want to proceed? The user said yes yesterday.";
  assert.notEqual(detectScreenState(prose), "attention");
  const buried = `${"Allow Bash(rm -rf public/old-icons)?\n"}${"line\n".repeat(30)}esc to interrupt`;
  assert.equal(detectScreenState(buried), "running");
});

test("option rows still count when the question has scrolled off", () => {
  const rows = "1. Yes, proceed\n2. No, and tell Codex what to do";
  assert.equal(detectScreenState(rows), "attention");
  assert.equal(extractApproval(rows).approve, "1\r");
  assert.equal(extractApproval(rows).deny, "2\r");
});
