$lines = Select-String -Path 'C:\Users\MARK-1\.gemini\antigravity\brain\ed255567-600d-4168-8454-9fa1bac88fdd\.system_generated\logs\transcript_full.jsonl' -SimpleMatch 'Chrome Microphone Permission Loop'
foreach ($l in $lines) {
    Write-Output $l.LineNumber
}

