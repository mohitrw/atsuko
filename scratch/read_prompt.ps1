$line = (Get-Content 'C:\Users\MARK-1\.gemini\antigravity\brain\ed255567-600d-4168-8454-9fa1bac88fdd\.system_generated\logs\transcript_full.jsonl' -TotalCount 3388)[-1]
$obj = ConvertFrom-Json $line
$idx = $obj.content.IndexOf('4. Fix the Chrome Microphone Permission Loop')
if ($idx -ge 0) {
    Write-Output $obj.content.Substring($idx, [Math]::Min(2500, $obj.content.Length - $idx))
}

