$transcriptPath = 'C:\Users\MARK-1\.gemini\antigravity\brain\ed255567-600d-4168-8454-9fa1bac88fdd\.system_generated\logs\transcript_full.jsonl'
$reader = [System.IO.File]::OpenText($transcriptPath)
$lastUser = $null
while (($line = $reader.ReadLine()) -ne $null) {
    if ($line.Contains('"type":"USER_INPUT"')) {
        $lastUser = $line
    }
}
$reader.Close()
if ($lastUser) {
    $obj = ConvertFrom-Json $lastUser
    Write-Output "STEP: $($obj.step_index)"
    Write-Output "CONTENT:"
    Write-Output $obj.content
}
