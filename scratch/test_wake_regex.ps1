$CASUAL_NIGHT_PATTERN = "(?i)\b(?:good|last|tomorrow|all|late|every|one|that|this|have\s+a|yesterday|through\s+the|in\s+the)\s+nights?\b|\bnights?\s+(?:shift|out|time|long|away|owl|stand|fall)\b"

$WAKE_WORD_PATTERN = "(?i)\b(?:(?:hey|hay|hi|hai|hello|he|ok|okay|okk|oke|k|yo|so|oh)\s+(?:a\s+|uh\s+|um\s+|and\s+|in\s+|the\s+|to\s+)?)?(night|knight|nite|nyte|knite|nx|n\s*x|n\s*\.\s*x|anex|annex|annexe|enex|ennex|enx|anx|an\s+ex|nox|knox|knocks|noks|arden|ardon|ardin|ar\s+den)\b|\b(?:hey|hay|hi|ok|okay)\s+tonight\b"

function Normalize-SpokenText($str) {
    if (-not $str) { return "" }
    $s = $str.ToLower().Trim()
    $s = [System.Text.RegularExpressions.Regex]::Replace($s, "['`´’]", "")
    $s = [System.Text.RegularExpressions.Regex]::Replace($s, "[.,\/#!$%\^&\*;:{}=\-_`~()?'""]", " ")
    $s = [System.Text.RegularExpressions.Regex]::Replace($s, "\s+", " ")
    return $s.Trim()
}

function Extract-WakeWordAndCommand($rawTranscript) {
    if (-not $rawTranscript) { return $null }
    $clean = Normalize-SpokenText $rawTranscript
    if (-not $clean) { return $null }

    $m = [System.Text.RegularExpressions.Regex]::Match($clean, $WAKE_WORD_PATTERN)
    if ($m.Success) {
        $token = $m.Value
        $matchIndex = $m.Index
        $matchLength = $m.Length

        $isCasualNight = $false
        if ($token -match "night|knight|nite") {
            $startContext = [Math]::Max(0, $matchIndex - 15)
            $endContext = [Math]::Min($clean.Length, $matchIndex + $matchLength + 10)
            $len = $endContext - $startContext
            $localContext = $clean.Substring($startContext, $len)
            if ($localContext -match $CASUAL_NIGHT_PATTERN) {
                $isCasualNight = $true
            }
        }

        if (-not $isCasualNight) {
            $afterWake = $clean.Substring($matchIndex + $matchLength).Trim()
            $m2 = [System.Text.RegularExpressions.Regex]::Match($afterWake, $WAKE_WORD_PATTERN)
            if ($m2.Success -and $m2.Index -eq 0) {
                $afterWake = $afterWake.Substring($m2.Length).Trim()
            }
            return @{
                hasWakeWord = $true
                matchedToken = $token
                command = $afterWake
            }
        }
    }
    return $null
}

$testCases = @(
  @{ input = "Night"; shouldMatch = $true },
  @{ input = "night"; shouldMatch = $true },
  @{ input = "Hey Night"; shouldMatch = $true },
  @{ input = "hey night"; shouldMatch = $true },
  @{ input = "Hey a Night"; shouldMatch = $true },
  @{ input = "Hey uh Night"; shouldMatch = $true },
  @{ input = "Ok Night"; shouldMatch = $true },
  @{ input = "Okay Night"; shouldMatch = $true },
  @{ input = "Hi Night"; shouldMatch = $true },
  @{ input = "Night play Blinding Lights"; shouldMatch = $true; expectedCmd = "play blinding lights" },
  @{ input = "Hey Night play Starboy"; shouldMatch = $true; expectedCmd = "play starboy" },
  @{ input = "Hey a Night play Starboy"; shouldMatch = $true; expectedCmd = "play starboy" },
  @{ input = "Nite"; shouldMatch = $true },
  @{ input = "Knight"; shouldMatch = $true },
  @{ input = "Hey Knight"; shouldMatch = $true },
  @{ input = "Hey Nite"; shouldMatch = $true },
  @{ input = "NX"; shouldMatch = $true },
  @{ input = "Hey NX"; shouldMatch = $true },
  @{ input = "Anex"; shouldMatch = $true },
  @{ input = "Nox"; shouldMatch = $true },
  @{ input = "Hey Nox"; shouldMatch = $true },
  @{ input = "Arden"; shouldMatch = $true },
  @{ input = "Hey Arden"; shouldMatch = $true },
  @{ input = "good night"; shouldMatch = $false },
  @{ input = "last night"; shouldMatch = $false },
  @{ input = "all night long"; shouldMatch = $false },
  @{ input = "have a good night"; shouldMatch = $false },
  @{ input = "night out with friends"; shouldMatch = $false },
  @{ input = "Hey A"; shouldMatch = $false },
  @{ input = "Hey"; shouldMatch = $false },
  @{ input = "Hey there"; shouldMatch = $false },
  @{ input = "Hello everyone"; shouldMatch = $false },
  @{ input = "I want a sandwich"; shouldMatch = $false },
  @{ input = "What time is it"; shouldMatch = $false }
)

$failed = 0
foreach ($tc in $testCases) {
    $res = Extract-WakeWordAndCommand $tc.input
    $matched = [bool]($res -and $res.hasWakeWord)
    $cmdMatches = $true
    if ($tc.expectedCmd) {
        $cmdMatches = ($res.command -eq $tc.expectedCmd)
    }
    $pass = ($matched -eq $tc.shouldMatch) -and $cmdMatches
    if (-not $pass) {
        Write-Host "FAILED: '$($tc.input)' -> expected: $($tc.shouldMatch), got: $matched, cmd: '$($res.command)'" -ForegroundColor Red
        $failed++
    } else {
        Write-Host "PASSED: '$($tc.input)' -> matched: $matched ($($res.matchedToken)) cmd: '$($res.command)'" -ForegroundColor Green
    }
}

if ($failed -eq 0) {
    Write-Host "`nALL 34 TEST CASES PASSED PERFECTLY!" -ForegroundColor Cyan
} else {
    Write-Host "`n$failed TESTS FAILED!" -ForegroundColor Red
}

# Test multi-stage rolling buffer chunking
Write-Host "`nTesting Multi-stage Rolling Window Chunks..." -ForegroundColor Yellow
$history = @()
function Add-Chunk($chunk, $isFinal) {
    global:history
    $c = Normalize-SpokenText $chunk
    if (-not $isFinal -and $history.Count -gt 0 -and -not $history[-1].isFinal) {
        $history[-1] = @{ text = $c; isFinal = $false }
    } else {
        $history += @{ text = $c; isFinal = $isFinal }
    }
    return ($history | ForEach-Object { $_.text }) -join " "
}

# Chunk 1: "hey a"
$rolling1 = Add-Chunk "hey a" $false
$match1 = Extract-WakeWordAndCommand $rolling1
Write-Host "After Chunk 1 ('hey a'): matched = $([bool]($match1 -and $match1.hasWakeWord))" -ForegroundColor Cyan

# Chunk 2: "night"
$rolling2 = Add-Chunk "night" $false
$match2 = Extract-WakeWordAndCommand $rolling2
Write-Host "After Chunk 2 ('night' appended -> '$rolling2'): matched = $([bool]($match2 -and $match2.hasWakeWord)), token = '$($match2.matchedToken)'" -ForegroundColor Green

if (-not $match1 -and $match2 -and $match2.hasWakeWord) {
    Write-Host "MULTI-STAGE ROLLING BUFFER TEST PASSED!" -ForegroundColor Green
} else {
    Write-Host "MULTI-STAGE TEST FAILED!" -ForegroundColor Red
}
