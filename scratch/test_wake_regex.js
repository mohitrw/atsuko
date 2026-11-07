const CASUAL_NIGHT_PATTERN =
  /\b(?:good|last|tomorrow|all|late|every|one|that|this|have\s+a|yesterday|through\s+the|in\s+the)\s+nights?\b|\bnights?\s+(?:shift|out|time|long|away|owl|stand|fall)\b/i;

const WAKE_WORD_PATTERN =
  /\b(?:(?:hey|hay|hi|hai|hello|he|ok|okay|okk|oke|k|yo|so|oh)\s+(?:a\s+|uh\s+|um\s+|and\s+|in\s+|the\s+|to\s+)?)?(night|knight|nite|nyte|knite|nx|n\s*x|n\s*\.\s*x|anex|annex|annexe|enex|ennex|enx|anx|an\s+ex|nox|knox|knocks|noks|arden|ardon|ardin|ar\s+den)\b|\b(?:hey|hay|hi|ok|okay)\s+tonight\b/i;

function normalizeSpokenText(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['"`´’]/g, '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'\"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWakeWordAndCommand(rawTranscript) {
  if (!rawTranscript) return null;
  const clean = normalizeSpokenText(rawTranscript);
  if (!clean) return null;

  try {
    const match = clean.match(WAKE_WORD_PATTERN);
    if (match) {
      const matchIndex = match.index;
      const matchLength = match[0].length;
      const token = match[0];

      let isCasualNight = false;
      if (/night|knight|nite/i.test(token)) {
        const startContext = Math.max(0, matchIndex - 15);
        const endContext = Math.min(clean.length, matchIndex + matchLength + 10);
        const localContext = clean.slice(startContext, endContext);
        if (CASUAL_NIGHT_PATTERN.test(localContext)) {
          isCasualNight = true;
        }
      }

      if (!isCasualNight) {
        let afterWake = clean.slice(matchIndex + matchLength).trim();
        const secondMatch = afterWake.match(WAKE_WORD_PATTERN);
        if (secondMatch && secondMatch.index === 0) {
          afterWake = afterWake.slice(secondMatch[0].length).trim();
        }
        return {
          hasWakeWord: true,
          matchedToken: token,
          command: afterWake
        };
      }
    }
  } catch (err) {}

  return null;
}

const testCases = [
  // Positive Night tests
  { input: "Night", shouldMatch: true },
  { input: "night", shouldMatch: true },
  { input: "Hey Night", shouldMatch: true },
  { input: "hey night", shouldMatch: true },
  { input: "Hey a Night", shouldMatch: true },
  { input: "Hey uh Night", shouldMatch: true },
  { input: "Ok Night", shouldMatch: true },
  { input: "Okay Night", shouldMatch: true },
  { input: "Hi Night", shouldMatch: true },
  { input: "Night play Blinding Lights", shouldMatch: true, expectedCmd: "play blinding lights" },
  { input: "Hey Night play Starboy", shouldMatch: true, expectedCmd: "play starboy" },
  { input: "Hey a Night play Starboy", shouldMatch: true, expectedCmd: "play starboy" },
  { input: "Nite", shouldMatch: true },
  { input: "Knight", shouldMatch: true },
  { input: "Hey Knight", shouldMatch: true },
  { input: "Hey Nite", shouldMatch: true },

  // Positive other keywords
  { input: "NX", shouldMatch: true },
  { input: "Hey NX", shouldMatch: true },
  { input: "Anex", shouldMatch: true },
  { input: "Nox", shouldMatch: true },
  { input: "Hey Nox", shouldMatch: true },
  { input: "Arden", shouldMatch: true },
  { input: "Hey Arden", shouldMatch: true },

  // Negative tests (casual / false triggers)
  { input: "good night", shouldMatch: false },
  { input: "last night", shouldMatch: false },
  { input: "all night long", shouldMatch: false },
  { input: "have a good night", shouldMatch: false },
  { input: "night out with friends", shouldMatch: false },
  { input: "Hey A", shouldMatch: false },
  { input: "Hey", shouldMatch: false },
  { input: "Hey there", shouldMatch: false },
  { input: "Hello everyone", shouldMatch: false },
  { input: "I want a sandwich", shouldMatch: false },
  { input: "What time is it", shouldMatch: false }
];

let failed = 0;
for (const tc of testCases) {
  const res = extractWakeWordAndCommand(tc.input);
  const matched = !!res?.hasWakeWord;
  const pass = matched === tc.shouldMatch && (!tc.expectedCmd || res?.command === tc.expectedCmd);
  if (!pass) {
    console.error(`FAILED: "${tc.input}" -> expected match: ${tc.shouldMatch}, got: ${matched}, command: "${res?.command}"`);
    failed++;
  } else {
    console.log(`PASSED: "${tc.input}" -> matched: ${matched} (${res?.matchedToken || 'none'}) ${res?.command ? 'cmd: ' + res.command : ''}`);
  }
}

if (failed === 0) {
  console.log("\nALL TEST CASES PASSED SUCCESSFULLY!");
} else {
  console.error(`\n${failed} TESTS FAILED.`);
  process.exit(1);
}

