# Speaks each line of a text file into a 16 kHz mono WAV with Windows' built-in
# voices (alternating between them), for scripts/bench-speech.mjs.
# Usage: bench-speech-tts.ps1 <sentences.txt> <out-dir>
param([string]$Sentences, [string]$OutDir)

Add-Type -AssemblyName System.Speech
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$voices = (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object Enabled | ForEach-Object { $_.VoiceInfo.Name }
New-Item -ItemType Directory -Force $OutDir | Out-Null

$i = 0
foreach ($line in Get-Content -Encoding UTF8 $Sentences) {
  if (-not $line.Trim()) { continue }
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice($voices[$i % $voices.Count])
  $synth.Rate = 1
  $synth.SetOutputToWaveFile((Join-Path $OutDir ('{0:D2}.wav' -f $i)), $format)
  $synth.Speak($line)
  $synth.Dispose()
  $i++
}
Write-Output "$i clips"
