param([string]$Path, [string]$Pattern)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-Content -Path $Path -Encoding UTF8 |
  Select-String -Pattern $Pattern |
  ForEach-Object { '{0}:{1}' -f $_.LineNumber, $_.Line }
